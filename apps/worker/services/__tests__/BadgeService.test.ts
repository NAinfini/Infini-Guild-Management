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
  const bind = vi.fn(function bindSelf(this: unknown) { return this; });
  const prepare = vi.fn((sql: string) => ({ sql, bind }));
  const batch = vi.fn().mockResolvedValue([]);
  return {
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    publishEntityChanged: vi.fn().mockResolvedValue(undefined),
    rawDb: { prepare, batch } as unknown as D1Database,
    /* rawDb 被断成 D1Database 之后就看不到 .mock 了，断言走这一份。 */
    mocks: { prepare, bind, batch },
  };
}

/* 建徽章会先问一次「当前最大的 sort_order 是多少」——那一次 select 没有 where，
   直接 await 在 .from() 上，所以这个替身的 from() 既要能续 .where()，本身又要是个
   thenable，返回聚合行。 */
function createBadgeDb(selectResults: unknown[][], maxSortOrder: number | null = null) {
  const limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []));
  const whereSelect = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({
    where: whereSelect,
    then: (resolve: (rows: unknown[]) => unknown) => resolve([{ value: maxSortOrder }]),
  }));
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
    // Disallowed tags are removed and their text survives as escaped content —
    // the same contract as profile titles (one shared sanitizer).
    const sanitizedRow = { ...badgeRow, labelHtml: "<span>Safe</span>alert(1)<br>", color: "#3b82f6" };
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
        labelHtml: "<span>Safe</span>alert(1)<br>",
        color: "#3b82f6",
      }),
    );
  });

  it("drops style values that could smuggle a URL or escape the attribute", async () => {
    const sanitizedRow = { ...badgeRow, labelHtml: "<span>x</span>" };
    const { db, calls } = createBadgeDb([[sanitizedRow]]);
    const service = new BadgeService(db as never, createDeps());

    const result = await service.createBadge("admin-1", {
      name: "Hostile style",
      label_html: '<span style="background-color: url(javascript:alert(1))">x</span>',
    });

    expect(result.ok).toBe(true);
    expect(calls.values).toHaveBeenCalledWith(
      expect.objectContaining({ labelHtml: "<span>x</span>" }),
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
      label_html: '<img src=x onerror="alert(1)">',
    });

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Badge label must contain visible allowed content",
    });
    expect(calls.set).not.toHaveBeenCalled();
  });

  it("appends new badges after the last one instead of stacking them on sort order zero", async () => {
    const { db, calls } = createBadgeDb([[badgeRow]], 40);
    const service = new BadgeService(db as never, createDeps());

    const result = await service.createBadge("admin-1", { name: "Newest", label_html: "<b>New</b>" });

    expect(result.ok).toBe(true);
    /* 不给号就排到末尾：写死 0 的话新徽章会插到队首，跟拖拽发出去的号段撞上。 */
    expect(calls.values).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 50 }));
  });

  it("rewrites every badge's sort order by index and refuses a partial order", async () => {
    const deps = createDeps();
    const rows = [{ id: "badge-1" }, { id: "badge-2" }, { id: "badge-3" }];
    /* reorder 先读全表 id（无 where 的 select），成功后再读一次列表回给调用方。 */
    const listRows = [
      { ...badgeRow, id: "badge-3", sortOrder: 0 },
      { ...badgeRow, id: "badge-1", sortOrder: 10 },
      { ...badgeRow, id: "badge-2", sortOrder: 20 },
    ];
    const results: unknown[][] = [rows, listRows];
    const orderBy = vi.fn(() => Promise.resolve(results.shift() ?? []));
    const from = vi.fn(() => ({
      orderBy,
      then: (resolve: (value: unknown[]) => unknown) => resolve(results.shift() ?? []),
    }));
    const db = { select: vi.fn(() => ({ from })) };
    const service = new BadgeService(db as never, deps);

    const partial = await service.reorderBadges("admin-1", ["badge-3", "badge-1"]);
    expect(partial, "少一个 id 的重排必须拒绝：没提交的那些会停在旧号段上，和新号段交错")
      .toEqual({
        ok: false,
        code: "CONFLICT",
        message: "Badge order must list all 3 badges; received 2",
      });
    expect(deps.mocks.batch).not.toHaveBeenCalled();

    results.unshift(rows);
    const result = await service.reorderBadges("admin-1", ["badge-3", "badge-1", "badge-2"]);

    expect(result.ok).toBe(true);
    const [statements] = deps.mocks.batch.mock.calls[0] as [unknown[]];
    expect(statements).toHaveLength(3);
    expect(deps.mocks.bind.mock.calls, "按下标 * 10 重新发号，中间留出手工插值的空位").toEqual([
      [0, expect.any(String), "badge-3"],
      [10, expect.any(String), "badge-1"],
      [20, expect.any(String), "badge-2"],
    ]);
    expect(deps.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "member_badge",
        action: "batch_update",
        entityId: "batch",
      }),
    );
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
        detail: { user_ids: ["u-1", "u-2"], removed: 2 },
      }),
    );
    expect(deps.publishEntityChanged).toHaveBeenCalledWith({
      entityType: "member_badge",
      entityId: "badge-1",
      hint: "badge_unassigned",
    });
  });
});
