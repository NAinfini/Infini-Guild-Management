import { describe, expect, it, vi } from "vitest";
import { createMemberAbsenceSchema } from "@guild/shared";
import { MemberAbsenceService } from "../MemberAbsenceService";

function createDeps() {
  const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind }));
  return {
    rawDb: { prepare },
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    publishEntityChanged: vi.fn().mockResolvedValue(undefined),
    getAbsencePolicy: vi.fn().mockResolvedValue({
      max_span_days: 366,
      max_entries_per_user: 20,
    }),
  };
}

function targetLookup(row: { role: string; deletedAt: string | null; username: string } | undefined) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(row ? [row] : []),
      })),
    })),
  };
}

const ABSENCE_ROW = {
  id: "abs-1",
  userId: "u-1",
  username: "Alpha",
  startDate: "2026-06-15",
  endDate: "2026-06-20",
  note: null,
  createdAt: "2026-06-11T00:00:00.000Z",
};

describe("createMemberAbsenceSchema", () => {
  it("rejects end_date before start_date", () => {
    const result = createMemberAbsenceSchema.safeParse({ start_date: "2026-06-20", end_date: "2026-06-15" });
    expect(result.success).toBe(false);
  });

  it("rejects non-ISO dates and leaves span enforcement to service policy", () => {
    expect(createMemberAbsenceSchema.safeParse({ start_date: "06/15/2026", end_date: "2026-06-20" }).success).toBe(false);
    expect(createMemberAbsenceSchema.safeParse({ start_date: "2026-06-15", end_date: "2028-06-20" }).success).toBe(true);
  });

  it("accepts a valid range with optional note", () => {
    const result = createMemberAbsenceSchema.safeParse({ start_date: "2026-06-15", end_date: "2026-06-20", note: "trip" });
    expect(result.success).toBe(true);
  });
});

describe("MemberAbsenceService.create", () => {
  it("forbids reporting absences for another member without admin.users.edit", async () => {
    const select = vi.fn().mockReturnValueOnce(targetLookup({ role: "member", deletedAt: null, username: "Beta" }));
    const service = new MemberAbsenceService({ select } as never, createDeps() as never);

    const result = await service.create(
      { id: "u-1", role: "member", permissions: new Set() },
      "u-2",
      { start_date: "2026-06-15", end_date: "2026-06-20" },
    );

    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("creates a self-reported absence with audit log and roster push", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce(targetLookup({ role: "member", deletedAt: null, username: "Alpha" }))
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([ABSENCE_ROW]) })),
          })),
        })),
      });
    const deps = createDeps();
    const service = new MemberAbsenceService({ select } as never, deps as never);

    const result = await service.create(
      { id: "u-1", role: "member", permissions: new Set() },
      "u-1",
      { start_date: "2026-06-15", end_date: "2026-06-20" },
    );

    expect(result.ok).toBe(true);
    expect(deps.rawDb.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO member_absences"));
    expect(deps.rawDb.prepare).toHaveBeenCalledWith(expect.stringContaining("COUNT(*) FROM member_absences"));
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ entityType: "member_absence", action: "create" }));
    expect(deps.publishEntityChanged).toHaveBeenCalledWith(expect.objectContaining({ entityType: "member_profile", hint: "profile_updated" }));
  });

  it("rejects ranges longer than the configured absence policy", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce(targetLookup({ role: "member", deletedAt: null, username: "Alpha" }));
    const deps = createDeps();
    deps.getAbsencePolicy.mockResolvedValueOnce({ max_span_days: 30, max_entries_per_user: 20 });
    const service = new MemberAbsenceService({ select } as never, deps as never);

    const result = await service.create(
      { id: "u-1", role: "member", permissions: new Set() },
      "u-1",
      { start_date: "2026-06-15", end_date: "2026-07-20" },
    );

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects new absences once the configured per-user cap is reached", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce(targetLookup({ role: "member", deletedAt: null, username: "Alpha" }));
    const deps = createDeps();
    deps.getAbsencePolicy.mockResolvedValueOnce({ max_span_days: 366, max_entries_per_user: 2 });
    deps.rawDb.prepare.mockReturnValueOnce({
      bind: vi.fn(() => ({ run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }) })),
    });
    const service = new MemberAbsenceService({ select } as never, deps as never);

    const result = await service.create(
      { id: "u-1", role: "member", permissions: new Set() },
      "u-1",
      { start_date: "2026-06-15", end_date: "2026-06-20" },
    );

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(select).toHaveBeenCalledTimes(1);
  });
});

describe("MemberAbsenceService.remove", () => {
  it("removes an absence only when it belongs to the target user", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce(targetLookup({ role: "member", deletedAt: null, username: "Alpha" }))
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        })),
      });
    const service = new MemberAbsenceService({ select } as never, createDeps() as never);

    const result = await service.remove(
      { id: "u-1", role: "member", permissions: new Set() },
      "u-1",
      "abs-of-someone-else",
    );

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("deletes an owned absence with a durable trail", async () => {
    const whereDelete = vi.fn().mockResolvedValue(undefined);
    const select = vi
      .fn()
      .mockReturnValueOnce(targetLookup({ role: "member", deletedAt: null, username: "Alpha" }))
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ id: "abs-1", startDate: "2026-06-15", endDate: "2026-06-20" }]),
          })),
        })),
      });
    const deps = createDeps();
    const service = new MemberAbsenceService({ select, delete: vi.fn(() => ({ where: whereDelete })) } as never, deps as never);

    const result = await service.remove(
      { id: "u-1", role: "member", permissions: new Set() },
      "u-1",
      "abs-1",
    );

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(whereDelete).toHaveBeenCalledTimes(1);
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ entityType: "member_absence", action: "delete", entityId: "abs-1" }));
  });
});
