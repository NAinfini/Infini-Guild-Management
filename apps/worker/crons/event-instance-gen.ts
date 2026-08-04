import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { computeNextOccurrence } from "@guild/shared/utils/recurrence";
import { recurringTemplates } from "../db/schema";
import type { Bindings } from "../index";
import { logger } from "../utils/logger";
import { buildReplaceMediaRefsStatements } from "../services/media-references";
import {
  buildReplaceEventAttachmentStatements,
  loadRecurringTemplateAttachments,
} from "../services/ordered-relations";
import { buildCloneTemplateQuotaStatements } from "../services/events/event-class-quotas";
import type { RawDbLike } from "../services/events/EventCrudService";

type RecurrenceRule = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  endAfter?: number;
  endDate?: string;
};

function parseRecurrenceRule(value: string | null): RecurrenceRule | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const rule = parsed as Record<string, unknown>;
    const frequency = rule.frequency;
    const interval = rule.interval;

    if (
      (frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly") ||
      typeof interval !== "number" ||
      !Number.isFinite(interval) ||
      interval <= 0
    ) {
      return null;
    }

    const daysOfWeek = Array.isArray(rule.daysOfWeek)
      ? (rule.daysOfWeek as unknown[])
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v) && v >= 0 && v <= 6)
      : undefined;
    const dayOfMonth =
      typeof rule.dayOfMonth === "number" && Number.isFinite(rule.dayOfMonth) && rule.dayOfMonth >= 1 && rule.dayOfMonth <= 31
        ? Math.floor(rule.dayOfMonth)
        : undefined;
    const endAfter =
      typeof rule.endAfter === "number" && Number.isFinite(rule.endAfter)
        ? Math.max(1, Math.floor(rule.endAfter))
        : undefined;
    const endDate = typeof rule.endDate === "string" ? rule.endDate : undefined;

    return {
      frequency,
      interval: Math.floor(interval),
      daysOfWeek: daysOfWeek && daysOfWeek.length > 0 ? daysOfWeek : undefined,
      dayOfMonth,
      endAfter,
      endDate,
    };
  } catch (e) {
    logger.warn("Failed to parse recurrence rule", { value, error: String(e) });
    return null;
  }
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// start_time is stored as UTC wall-clock "HH:mm" (the portal converts local→UTC
// before persisting), so this only validates and splits — no timezone math.
function parseStartTime(startTime: string): { utcHour: number; utcMinute: number } | null {
  const match = startTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const utcHour = Number(match[1]);
  const utcMinute = Number(match[2]);
  if (utcHour < 0 || utcHour > 23 || utcMinute < 0 || utcMinute > 59) {
    return null;
  }
  return { utcHour, utcMinute };
}

export function computeHorizon(now: Date, offsetMinutes = 0): Date {
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + 3);
  horizon.setTime(horizon.getTime() + offsetMinutes * 60_000);
  return horizon;
}

export async function runEventInstanceGenerationCron(
  env: Bindings,
  options: { templateId?: string; systemTestRunId?: string } = {},
): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();
  const MAX_CATCHUP = 10;

  const templates = await db
    .select({
      id: recurringTemplates.id,
      type: recurringTemplates.type,
      title: recurringTemplates.title,
      description: recurringTemplates.description,
      startTime: recurringTemplates.startTime,
      durationMinutes: recurringTemplates.durationMinutes,
      capacity: recurringTemplates.capacity,
      createdBy: recurringTemplates.createdBy,
      recurrenceRule: recurringTemplates.recurrenceRule,
      lastGeneratedDate: recurringTemplates.lastGeneratedDate,
      generationCount: recurringTemplates.generationCount,
      visibilityOffsetMinutes: recurringTemplates.visibilityOffsetMinutes,
      autoArchive: recurringTemplates.autoArchive,
      createdAt: recurringTemplates.createdAt,
    })
    .from(recurringTemplates)
    .where(
      and(
        eq(recurringTemplates.paused, false),
        ...(options.templateId ? [eq(recurringTemplates.id, options.templateId)] : []),
      ),
    );

  const attachmentsByTemplate = await loadRecurringTemplateAttachments(env.DB, templates.map((template) => template.id));

  for (const template of templates) {
    const rule = parseRecurrenceRule(template.recurrenceRule);
    if (!rule) {
      continue;
    }

    const utcTime = parseStartTime(template.startTime);
    if (!utcTime) {
      continue;
    }

    // Use createdAt as the reference date for recurrence anchoring
    const referenceDate = new Date(template.createdAt);
    if (!isValidDate(referenceDate)) {
      continue;
    }

    if (rule.endAfter && template.generationCount >= rule.endAfter) {
      continue;
    }
    if (rule.endDate) {
      const endDate = new Date(rule.endDate);
      if (isValidDate(endDate) && now > endDate) {
        continue;
      }
    }

    // When lastGeneratedDate is null (new template or schedule reset), anchor to
    // now so we only generate future events — never backfill past occurrences.
    let anchor: Date;
    if (template.lastGeneratedDate) {
      const lastGenDate = new Date(`${template.lastGeneratedDate}T00:00:00Z`);
      if (isValidDate(lastGenDate)) {
        lastGenDate.setUTCHours(utcTime.utcHour, utcTime.utcMinute, 0, 0);
        anchor = lastGenDate;
      } else {
        anchor = new Date(now);
        anchor.setUTCDate(anchor.getUTCDate() - 1);
        anchor.setUTCHours(utcTime.utcHour, utcTime.utcMinute, 0, 0);
      }
    } else {
      anchor = new Date(now);
      anchor.setUTCDate(anchor.getUTCDate() - 1);
      anchor.setUTCHours(utcTime.utcHour, utcTime.utcMinute, 0, 0);
    }

    // Bug 1 fix: extend horizon by visibilityOffsetMinutes so events needing early creation are included
    const horizon = computeHorizon(now, template.visibilityOffsetMinutes);
    let currentAnchor = anchor;
    let generationCount = template.generationCount;
    let catchupCount = 0;

    // Collect per-template insert statements so they can be batched with the
    // template UPDATE in a single D1 round-trip instead of N+1 separate awaits.
    const templateAttachments = attachmentsByTemplate.get(template.id) ?? [];
    const pendingInserts: Array<{
      dateKey: string;
      eventId: string;
      startAt: string;
      endAt: string | null;
    }> = [];

    while (catchupCount < MAX_CATCHUP) {
      const nextOccurrence = computeNextOccurrence(currentAnchor, utcTime.utcHour, utcTime.utcMinute, rule, referenceDate);
      if (!nextOccurrence) {
        break;
      }

      if (nextOccurrence > horizon) {
        break;
      }

      if (template.visibilityOffsetMinutes > 0) {
        const createAt = new Date(nextOccurrence.getTime() - template.visibilityOffsetMinutes * 60_000);
        if (now < createAt) {
          break;
        }
      }

      if (rule.endDate) {
        const endDate = new Date(rule.endDate);
        if (isValidDate(endDate) && nextOccurrence > endDate) {
          break;
        }
      }

      const nextStartIso = nextOccurrence.toISOString();
      const nextDateKey = toDateKey(nextOccurrence);
      const nextEndAt = template.durationMinutes != null
        ? new Date(nextOccurrence.getTime() + template.durationMinutes * 60_000).toISOString()
        : null;

      const eventId = nanoid();
      pendingInserts.push({ dateKey: nextDateKey, eventId, startAt: nextStartIso, endAt: nextEndAt });

      currentAnchor = nextOccurrence;
      catchupCount += 1;

      if (rule.endAfter && generationCount + pendingInserts.length >= rule.endAfter) {
        break;
      }
    }

    if (pendingInserts.length === 0) {
      continue;
    }

    const datePlaceholders = pendingInserts.map(() => "?").join(", ");
    const existing = await env.DB.prepare(
      `SELECT instance_date FROM events WHERE series_id = ? AND instance_date IN (${datePlaceholders})`,
    ).bind(template.id, ...pendingInserts.map((entry) => entry.dateKey)).all<{ instance_date: string }>();
    const existingDates = new Set((existing.results ?? []).map((row) => row.instance_date));
    const newInserts = pendingInserts.filter((entry) => !existingDates.has(entry.dateKey));
    if (newInserts.length === 0) {
      continue;
    }

    const lastDateKey = newInserts[newInserts.length - 1]!.dateKey;
    const nextGenerationCount = generationCount + newInserts.length;
    const nowIso = now.toISOString();
    const rawDb = env.DB as never as RawDbLike;
    const runGuard = options.systemTestRunId
      ? " AND EXISTS (SELECT 1 FROM system_test_runs WHERE id = ?6 AND status = 'running')"
      : "";
    const updateBindings: unknown[] = [
      lastDateKey,
      nextGenerationCount,
      nowIso,
      template.id,
      generationCount,
      ...(options.systemTestRunId ? [options.systemTestRunId] : []),
    ];
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `UPDATE recurring_templates
         SET last_generated_date = ?1, generation_count = ?2, updated_at = ?3
         WHERE id = ?4 AND paused = 0 AND generation_count = ?5${runGuard}`,
      ).bind(...updateBindings),
    ];

    for (const entry of newInserts) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO events
             (id, type, title, description, start_at, end_at, capacity, auto_archive,
              created_by, series_id, instance_date, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
           WHERE EXISTS (
             SELECT 1 FROM recurring_templates
             WHERE id = ?10 AND paused = 0 AND generation_count = ?13 AND last_generated_date = ?14
           )`,
        ).bind(
          entry.eventId,
          template.type,
          template.title,
          template.description,
          entry.startAt,
          entry.endAt,
          template.capacity,
          template.autoArchive ? 1 : 0,
          template.createdBy,
          template.id,
          entry.dateKey,
          nowIso,
          nextGenerationCount,
          lastDateKey,
        ),
        ...buildReplaceEventAttachmentStatements(env.DB, entry.eventId, templateAttachments),
        ...buildReplaceMediaRefsStatements(env.DB, "event", entry.eventId, templateAttachments),
      );
    }

    /* 活动、附件、媒体引用、配额、测试登记和模板进度必须同生共死。
       D1 batch 是单事务；任何一条失败都会回滚整批，不会留下裸活动。 */
    statements.push(
      ...await buildCloneTemplateQuotaStatements(
        rawDb,
        template.id,
        newInserts.map((entry) => entry.eventId),
        () => nanoid(),
      ) as unknown as D1PreparedStatement[],
    );
    if (options.systemTestRunId) {
      for (const entry of newInserts) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO system_test_artifacts (run_id, artifact_type, artifact_key)
             SELECT ?1, 'event', ?2 FROM system_test_runs
             WHERE id = ?1 AND status = 'running'
               AND EXISTS (SELECT 1 FROM events WHERE id = ?2)
             ON CONFLICT(run_id, artifact_type, artifact_key)
             DO UPDATE SET artifact_key = excluded.artifact_key`,
          ).bind(options.systemTestRunId, entry.eventId),
        );
      }
    }
    await env.DB.batch(statements);
  }
}
