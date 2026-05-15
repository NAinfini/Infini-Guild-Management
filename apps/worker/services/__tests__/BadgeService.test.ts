import { describe, expect, it, vi } from "vitest";
import { BadgeService } from "../BadgeService";

const badgeRow = {
  id: "badge-1",
  name: "MVP",
  labelHtml: "<b>MVP</b>",
  color: "#3b82f6",
  description: null,
  sortOrder: 0,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

function createDeps() {
  return {
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    publishEntityChanged: vi.fn().mockResolvedValue(undefined),
  };
}

function createBadgeDb(selectResults: unknown[][]) {
  const limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []));
  const whereSelect = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: whereSelect }));
  const select = vi.fn(() => ({ from }));
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));

  return {
    db: { select, insert },
    calls: { values },
  };
}

function createUpdateDb(selectResults: unknown[][]) {
  const limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []));
  const whereSelect = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: whereSelect }));
  const select = vi.fn(() => ({ from }));
  const whereUpdate = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where: whereUpdate }));
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, update },
    calls: { set },
  };
}

function createUnassignDb(assignments: { userId: string }[]) {
  let selectCount = 0;
  const limit = vi.fn().mockResolvedValue([badgeRow]);
  const whereBadge = vi.fn(() => ({ limit }));
  const whereAssignments = vi.fn().mockResolvedValue(assignments);
  const from = vi.fn(() => {
    selectCount += 1;
    return { where: selectCount === 1 ? whereBadge : whereAssignments };
  });
  const select = vi.fn(() => ({ from }));
  const whereDelete = vi.fn().mockResolvedValue(undefined);
  const deleteFrom = vi.fn(() => ({ where: whereDelete }));

  return {
    db: { select, delete: deleteFrom },
    calls: { deleteFrom },
  };
}

describe("BadgeService", () => {
  it("sanitizes badge HTML and normalizes color before create", async () => {
    const sanitizedRow = { ...badgeRow, labelHtml: "<span>Safe</span><br>", color: "#3b82f6" };
    const { db, calls } = createBadgeDb([[sanitizedRow]]);
    const service = new BadgeService(db as never, createDeps());

    const result = await service.createBadge("admin-1", {
      name: "Safe",
      label_html: '<span onclick="alert(1)">Safe</span><script>alert(1)</script><br>',
      color: "not-a-color",
    });

    expect(result.ok).toBe(true);
    expect(calls.values).toHaveBeenCalledWith(
      expect.objectContaining({
        labelHtml: "<span>Safe</span><br>",
        color: "#3b82f6",
      }),
    );
  });

  it("preserves style attribute on allowed tags while stripping other attributes", async () => {
    const sanitizedRow = { ...badgeRow, labelHtml: '<span style="color:red">Red</span>' };
    const { db, calls } = createBadgeDb([[sanitizedRow]]);
    const service = new BadgeService(db as never, createDeps());

    const result = await service.createBadge("admin-1", {
      name: "Red Badge",
      label_html: '<span style="color:red" onclick="alert(1)">Red</span>',
    });

    expect(result.ok).toBe(true);
    expect(calls.values).toHaveBeenCalledWith(
      expect.objectContaining({
        labelHtml: '<span style="color:red">Red</span>',
      }),
    );
  });

  it("rejects update when sanitized badge HTML is empty", async () => {
    const { db, calls } = createUpdateDb([[badgeRow]]);
    const service = new BadgeService(db as never, createDeps());

    const result = await service.updateBadge("admin-1", "badge-1", {
      label_html: "<script>alert(1)</script>",
    });

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Badge label must contain visible allowed content",
    });
    expect(calls.set).not.toHaveBeenCalled();
  });

  it("counts unassigned badge rows from selected assignments instead of delete metadata", async () => {
    const deps = createDeps();
    const { db, calls } = createUnassignDb([{ userId: "u-1" }, { userId: "u-2" }]);
    const service = new BadgeService(db as never, deps);

    const result = await service.unassignBadge("admin-1", "badge-1", ["u-1", "u-2", "u-3"]);

    expect(result).toEqual({ ok: true, data: { removed: 2 } });
    expect(calls.deleteFrom).toHaveBeenCalledTimes(1);
    expect(deps.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "unassign",
        detailText: JSON.stringify({ user_ids: ["u-1", "u-2"], removed: 2 }),
      }),
    );
    expect(deps.publishEntityChanged).toHaveBeenCalledWith({
      entityType: "member_badge",
      entityId: "badge-1",
      hint: "badge_unassigned",
    });
  });
});
