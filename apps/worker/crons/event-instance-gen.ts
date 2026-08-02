import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { computeNextOccurrence } from "@guild/shared/utils/recurrence";
import { events, recurringTemplates } from "../db/schema";
import type { Bindings } from "../index";
import { logger } from "../utils/logger";
import { replaceMediaRefs, extractAttachmentKeys } from "../services/media-references";
import { SystemTestService } from "../services/SystemTestService";

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
      attachments: recurringTemplates.attachments,
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
    type InsertStmt = ReturnType<ReturnType<ReturnType<typeof db.insert>["values"]>["onConflictDoNothing"]>;
    const pendingInserts: Array<{ stmt: InsertStmt; dateKey: string; eventId: string; attachments: string }> = [];

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
      pendingInserts.push({
        stmt: db.insert(events).values({
          id: eventId,
          type: template.type,
          title: template.title,
          description: template.description,
          startAt: nextStartIso,
          endAt: nextEndAt,
          capacity: template.capacity,
          pinned: false,
          signupLocked: false,
          autoArchive: template.autoArchive,
          autoArchived: false,
          archivedAt: null,
          createdBy: template.createdBy,
          attachments: template.attachments,
          seriesId: template.id,
          instanceDate: nextDateKey,
          updatedAt: now.toISOString(),
        }).onConflictDoNothing({ target: [events.seriesId, events.instanceDate] }),
        dateKey: nextDateKey,
        eventId,
        attachments: template.attachments,
      });

      currentAnchor = nextOccurrence;
      catchupCount += 1;

      if (rule.endAfter && generationCount >= rule.endAfter) {
        break;
      }
    }

    if (pendingInserts.length === 0) {
      continue;
    }

    // Batch all insert statements for this template in one D1 round-trip.
    // D1 Drizzle .batch() accepts an array at runtime even though the TypeScript
    // overload requires a tuple. Cast via unknown to bypass the tuple constraint.
    const insertStmts = pendingInserts.map((p) => p.stmt) as unknown as Parameters<typeof db.batch>[0];
    const batchResults = await db.batch(insertStmts);

    let lastDateKey: string | null = null;
    const insertedEventIds: string[] = [];
    const mediaRefPromises: Promise<void>[] = [];
    for (let i = 0; i < pendingInserts.length; i++) {
      const result = batchResults[i] as D1Result;
      if (result.meta.changes > 0) {
        generationCount += 1;
        lastDateKey = pendingInserts[i]!.dateKey;
        insertedEventIds.push(pendingInserts[i]!.eventId);
        const keys = extractAttachmentKeys(pendingInserts[i]!.attachments);
        if (keys.length > 0) {
          mediaRefPromises.push(replaceMediaRefs(env.DB, "event", pendingInserts[i]!.eventId, keys));
        }
      }
    }
    const templateStillActive = await env.DB.prepare(
      "SELECT id FROM recurring_templates WHERE id = ? AND paused = 0",
    ).bind(template.id).first<{ id: string }>();
    if (!templateStillActive) {
      await new SystemTestService(env).cleanupExactArtifacts(
        insertedEventIds.map((key) => ({ type: "event", key })),
      );
      continue;
    }
    if (options.systemTestRunId && insertedEventIds.length > 0) {
      const systemTests = new SystemTestService(env);
      const artifacts = insertedEventIds.map((key) => ({ type: "event" as const, key }));
      try {
        await systemTests.registerArtifacts(options.systemTestRunId, artifacts);
      } catch (error) {
        await systemTests.cleanupExactArtifacts(artifacts);
        throw error;
      }
    }
    /*
     * 模板的职业配额要跟着复制到新生成的这批活动上，否则周期活动永远是空配额。
     * 用 INSERT ... SELECT 而不是先读进内存再写：模板没配额时它就是条 0 行的空语句，
     * 省掉一次「有没有配额」的探测查询。只覆盖本轮真正插进去的活动，已存在的实例
     * 不回改——跟标题、人数上限一样，模板改动只影响之后生成的活动。
     */
    if (insertedEventIds.length > 0) {
      await env.DB.batch(insertedEventIds.map((eventId) =>
        env.DB.prepare(
          `INSERT INTO event_class_quotas (event_id, class_id, required)
           SELECT ?1, class_id, required FROM recurring_template_class_quotas WHERE template_id = ?2`,
        ).bind(eventId, template.id),
      ));
    }

    await Promise.all(mediaRefPromises);

    if (lastDateKey) {
      await db
        .update(recurringTemplates)
        .set({
          lastGeneratedDate: lastDateKey,
          generationCount,
          updatedAt: now.toISOString(),
        })
        .where(eq(recurringTemplates.id, template.id));
    }
  }
}
