import { createMemberAbsenceSchema, memberAbsenceSchema, type Role, type SiteAbsencePolicy } from "@guild/shared";
import type { AuditEntityType, AuditAction } from "@guild/shared/constants/audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { memberAbsences, users } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";

type DrizzleDb = ReturnType<typeof drizzle>;

type SessionUser = { id: string; role: Role; permissions: ReadonlySet<string> };

export type MemberAbsenceServiceDeps = {
  writeAuditLog: (input: {
    entityType: AuditEntityType;
    action: AuditAction;
    actorId: string;
    entityId: string;
    diffTitle?: string | null;
    detailText?: string | null;
  }) => Promise<void>;
  publishEntityChanged: (input: { entityType: PushEntityType; entityId: string; hint: PushHint }) => Promise<void>;
  getAbsencePolicy?: () => Promise<SiteAbsencePolicy>;
};

const DEFAULT_ABSENCE_POLICY: SiteAbsencePolicy = {
  max_span_days: 366,
  max_entries_per_user: 20,
};

function daysInclusive(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

function toAbsencePayload(row: {
  id: string;
  userId: string;
  username: string | null;
  startDate: string;
  endDate: string;
  note: string | null;
  createdAt: string;
}) {
  const result = memberAbsenceSchema.safeParse({
    id: row.id,
    user_id: row.userId,
    username: row.username,
    start_date: row.startDate,
    end_date: row.endDate,
    note: row.note,
    created_at: row.createdAt,
  });
  if (!result.success) {
    throw new Error(`Invalid absence data for id=${row.id}: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
  }
  return result.data;
}

export class MemberAbsenceService {
  constructor(
    private db: DrizzleDb,
    private deps: MemberAbsenceServiceDeps,
  ) {}

  private async canEditTarget(sessionUser: SessionUser, targetUserId: string): Promise<{ status: "allowed"; username: string } | { status: "forbidden" | "not_found"; username: null }> {
    const target = (
      await this.db.select({ role: users.role, deletedAt: users.deletedAt, username: users.username }).from(users).where(eq(users.id, targetUserId)).limit(1)
    )[0];
    if (!target || target.deletedAt !== null) return { status: "not_found", username: null };
    if (sessionUser.id === targetUserId) return { status: "allowed", username: target.username };
    if (!sessionUser.permissions.has("admin.users.edit")) return { status: "forbidden", username: null };
    if (target.role === "admin" && sessionUser.role !== "admin") return { status: "forbidden", username: null };
    return { status: "allowed", username: target.username };
  }

  /** Absences overlapping [from, to] (inclusive YYYY-MM-DD bounds), visible to all members. */
  async listWindow(from: string, to: string): Promise<ServiceResult<{ data: unknown[] }>> {
    const rows = await this.db
      .select({
        id: memberAbsences.id,
        userId: memberAbsences.userId,
        username: users.username,
        startDate: memberAbsences.startDate,
        endDate: memberAbsences.endDate,
        note: memberAbsences.note,
        createdAt: memberAbsences.createdAt,
      })
      .from(memberAbsences)
      .innerJoin(users, eq(users.id, memberAbsences.userId))
      .where(and(gte(memberAbsences.endDate, from), lte(memberAbsences.startDate, to)))
      .orderBy(memberAbsences.startDate, memberAbsences.id);
    return ok({ data: rows.map(toAbsencePayload) });
  }

  async listForUser(targetUserId: string): Promise<ServiceResult<{ data: unknown[] }>> {
    const rows = await this.db
      .select({
        id: memberAbsences.id,
        userId: memberAbsences.userId,
        username: users.username,
        startDate: memberAbsences.startDate,
        endDate: memberAbsences.endDate,
        note: memberAbsences.note,
        createdAt: memberAbsences.createdAt,
      })
      .from(memberAbsences)
      .innerJoin(users, eq(users.id, memberAbsences.userId))
      .where(eq(memberAbsences.userId, targetUserId))
      .orderBy(sql`${memberAbsences.startDate} DESC`, memberAbsences.id);
    return ok({ data: rows.map(toAbsencePayload) });
  }

  async create(sessionUser: SessionUser, targetUserId: string, body: unknown): Promise<ServiceResult<unknown>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot report absences for this member");

    const parsed = createMemberAbsenceSchema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid absence payload", parsed.error.flatten());

    const policy = await (this.deps.getAbsencePolicy?.() ?? Promise.resolve(DEFAULT_ABSENCE_POLICY));
    const spanDays = daysInclusive(parsed.data.start_date, parsed.data.end_date);
    if (spanDays > policy.max_span_days) {
      return err("VALIDATION_ERROR", `Absence cannot span more than ${policy.max_span_days} days`);
    }

    const countRow = (
      await this.db.select({ count: sql<number>`count(*)` }).from(memberAbsences).where(eq(memberAbsences.userId, targetUserId))
    )[0];
    if (Number(countRow?.count ?? 0) >= policy.max_entries_per_user) {
      return err("VALIDATION_ERROR", `Absence limit reached (max ${policy.max_entries_per_user}); delete old entries first`);
    }

    const id = nanoid();
    await this.db.insert(memberAbsences).values({
      id,
      userId: targetUserId,
      startDate: parsed.data.start_date,
      endDate: parsed.data.end_date,
      note: parsed.data.note ? parsed.data.note : null,
    });

    await this.deps.writeAuditLog({
      entityType: "member_absence", action: "create", actorId: sessionUser.id,
      entityId: id, diffTitle: access.username,
      detailText: JSON.stringify({ user_id: targetUserId, start_date: parsed.data.start_date, end_date: parsed.data.end_date }),
    });
    const hint = sessionUser.id === targetUserId ? "profile_updated" : "profile_moderated";
    await this.deps.publishEntityChanged({ entityType: "member_profile", entityId: targetUserId, hint });

    const created = (
      await this.db
        .select({
          id: memberAbsences.id,
          userId: memberAbsences.userId,
          username: users.username,
          startDate: memberAbsences.startDate,
          endDate: memberAbsences.endDate,
          note: memberAbsences.note,
          createdAt: memberAbsences.createdAt,
        })
        .from(memberAbsences)
        .innerJoin(users, eq(users.id, memberAbsences.userId))
        .where(eq(memberAbsences.id, id))
        .limit(1)
    )[0];
    if (!created) return err("SERVER_ERROR", "Failed to load created absence");
    return ok(toAbsencePayload(created));
  }

  async remove(sessionUser: SessionUser, targetUserId: string, absenceId: string): Promise<ServiceResult<{ ok: true }>> {
    const access = await this.canEditTarget(sessionUser, targetUserId);
    if (access.status === "not_found") return err("NOT_FOUND", "User not found");
    if (access.status === "forbidden") return err("FORBIDDEN", "You cannot manage absences for this member");

    const existing = (
      await this.db
        .select({ id: memberAbsences.id, startDate: memberAbsences.startDate, endDate: memberAbsences.endDate })
        .from(memberAbsences)
        .where(and(eq(memberAbsences.id, absenceId), eq(memberAbsences.userId, targetUserId)))
        .limit(1)
    )[0];
    if (!existing) return err("NOT_FOUND", "Absence not found");

    await this.db.delete(memberAbsences).where(eq(memberAbsences.id, absenceId));

    await this.deps.writeAuditLog({
      entityType: "member_absence", action: "delete", actorId: sessionUser.id,
      entityId: absenceId, diffTitle: access.username,
      detailText: JSON.stringify({ user_id: targetUserId, start_date: existing.startDate, end_date: existing.endDate }),
    });
    const hint = sessionUser.id === targetUserId ? "profile_updated" : "profile_moderated";
    await this.deps.publishEntityChanged({ entityType: "member_profile", entityId: targetUserId, hint });
    return ok({ ok: true });
  }
}
