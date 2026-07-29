import { describe, expect, it, vi } from "vitest";
import type { Permission } from "@guild/shared";
import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { StorageService } from "../StorageService";

type StorageItemMock = {
  id: string;
  storageId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  quantity: number;
  allowMemberDeposit: boolean;
  allowMemberWithdraw: boolean;
  createdAt: string;
  updatedAt: string;
};

const ITEM: StorageItemMock = {
  id: "item-1",
  storageId: "storage-1",
  categoryId: null,
  name: "Moon Blade",
  description: null,
  quantity: 10,
  allowMemberDeposit: true,
  allowMemberWithdraw: true,
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z",
};

const TX_ROW = {
  id: "tx-1",
  itemId: "item-1",
  itemName: "Moon Blade",
  type: "distribute",
  quantityDelta: -2,
  recipientUserId: "member-1",
  recipientUsername: "Member",
  note: null,
  actorId: "admin-1",
  actorUsername: "Admin",
  createdAt: "2026-06-11T00:00:00.000Z",
};

function createDeps(firstRow: unknown = TX_ROW) {
  const statements: Array<{ sql: string; binds: unknown[]; run: ReturnType<typeof vi.fn> }> = [];
  const rawDb = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...binds: unknown[]) => {
        const statement = {
          sql,
          binds,
          run: vi.fn().mockResolvedValue(undefined),
          first: vi.fn().mockResolvedValue(firstRow),
          all: vi.fn().mockResolvedValue({ results: [] }),
        };
        statements.push(statement);
        return statement;
      }),
    })),
    batch: vi.fn().mockResolvedValue([
      { meta: { changes: 1 } },
      { meta: { changes: 1 } },
    ]),
  };
  return {
    statements,
    rawDb,
    deps: {
      rawDb: rawDb as never,
      media: {
        put: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue(undefined),
      } as never,
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
      getStoragePolicy: vi.fn().mockResolvedValue({ images_per_item: 5 }),
    },
  };
}

function queryFromRows(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const query = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(rows)),
    offset: vi.fn(() => Promise.resolve(rows)),
    leftJoin: vi.fn(() => query),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return query;
}

function selectQueue(rows: unknown[][]) {
  return vi.fn(() => ({
    from: vi.fn(() => queryFromRows(rows.shift() ?? [])),
  }));
}

function createListItemsDb(itemRows: unknown[], imageRows: unknown[] = []) {
  const itemLimit = vi.fn().mockResolvedValue(itemRows);
  const itemWhere = vi.fn(() => ({
    orderBy: vi.fn(() => ({ limit: itemLimit })),
  }));
  const imageWhere = vi.fn(() => ({
    orderBy: vi.fn().mockResolvedValue(imageRows),
  }));
  let selectIndex = 0;
  const select = vi.fn(() => ({
    from: vi.fn(() => (
      selectIndex++ === 0
        ? { where: itemWhere }
        : { where: imageWhere }
    )),
  }));

  return {
    db: { select },
    itemLimit,
    itemWhere,
    imageWhere,
  };
}

function compileWhere(whereMock: ReturnType<typeof vi.fn>) {
  const whereSql = whereMock.mock.calls[0]?.[0] as SQL;
  return new SQLiteSyncDialect().sqlToQuery(whereSql);
}

function manager() {
  return { id: "admin-1", roleId: "admin", role: "admin", permissions: new Set<Permission>(["admin.storage.manage"]) };
}

function member() {
  return { id: "member-1", roleId: "member", role: "member", permissions: new Set<Permission>() };
}

describe("StorageService.applyTransaction", () => {
  it("writes stock update, ledger insert, and a storage transaction audit log", async () => {
    const { deps, rawDb } = createDeps();
    const service = new StorageService({ select: selectQueue([[ITEM], [TX_ROW]]) } as never, deps);

    const result = await service.applyTransaction(manager(), "item-1", {
      type: "distribute",
      quantity: 2,
      recipient_user_id: "member-1",
    });

    expect(result.ok).toBe(true);
    expect(rawDb.batch).toHaveBeenCalledTimes(1);
    const batch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; binds: unknown[] }>;
    expect(batch).toHaveLength(2);
    expect(batch[0]?.sql).toContain("UPDATE storage_items");
    expect(batch[0]?.binds[0]).toBe(-2);
    expect(batch[1]?.sql).toContain("INSERT INTO storage_transactions");
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "storage_transaction",
      action: "distribute",
      actorId: "admin-1",
      entityId: expect.any(String),
      diffTitle: "Moon Blade",
      detailText: JSON.stringify({
        item_id: "item-1",
        quantity_delta: -2,
        recipient_user_id: "member-1",
        note: null,
      }),
    }));
    expect(deps.publishEntityChanged).toHaveBeenCalledWith({ entityType: "storage", entityId: "item-1", hint: "storage_updated" });
  });

  it("rejects transactions that would take stock below zero", async () => {
    const { deps, rawDb } = createDeps();
    const service = new StorageService({ select: selectQueue([[ITEM]]) } as never, deps);

    const result = await service.applyTransaction(manager(), "item-1", {
      type: "distribute",
      quantity: 11,
      recipient_user_id: "member-1",
    });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(rawDb.batch).not.toHaveBeenCalled();
  });

  it("returns a conflict without side effects when a concurrent withdrawal exhausts stock", async () => {
    const { deps, rawDb } = createDeps();
    rawDb.batch.mockRejectedValueOnce(
      new Error("D1_ERROR: CHECK constraint failed: storage_items_quantity_nonnegative"),
    );
    const service = new StorageService(
      { select: selectQueue([[ITEM], [{ ...ITEM, quantity: 4 }]]) } as never,
      deps,
    );

    const result = await service.applyTransaction(manager(), "item-1", {
      type: "distribute",
      quantity: 7,
      recipient_user_id: "member-1",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "CONFLICT",
      details: {
        current_quantity: 4,
        requested_quantity: 7,
      },
    });
    expect(deps.writeAuditLog).not.toHaveBeenCalled();
    expect(deps.publishEntityChanged).not.toHaveBeenCalled();
  });

  it("does not disguise unrelated database failures as stock conflicts", async () => {
    const { deps, rawDb } = createDeps();
    rawDb.batch.mockRejectedValueOnce(new Error("D1_ERROR: database unavailable"));
    const service = new StorageService(
      { select: selectQueue([[ITEM], [{ ...ITEM, quantity: 4 }]]) } as never,
      deps,
    );

    await expect(service.applyTransaction(manager(), "item-1", {
      type: "distribute",
      quantity: 7,
      recipient_user_id: "member-1",
    })).rejects.toThrow("database unavailable");

    expect(deps.writeAuditLog).not.toHaveBeenCalled();
    expect(deps.publishEntityChanged).not.toHaveBeenCalled();
  });

  it("converts admin stock adjustment targets into ledger deltas", async () => {
    const { deps, rawDb } = createDeps({ ...TX_ROW, type: "adjust", quantityDelta: 5 });
    const service = new StorageService({ select: selectQueue([[ITEM]]) } as never, deps);

    const result = await service.applyTransaction(manager(), "item-1", {
      type: "adjust",
      target_quantity: 15,
    });

    expect(result.ok).toBe(true);
    const batch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; binds: unknown[] }>;
    expect(batch[0]?.sql).toContain("SELECT");
    expect(batch[0]?.sql).toContain("quantity");
    expect(batch[0]?.binds).toContain(15);
    expect(batch[1]?.sql).toContain("SET quantity =");
    expect(batch[1]?.binds[0]).toBe(15);
  });

  it("computes an adjustment ledger delta from stock at transaction time", async () => {
    const { deps, rawDb } = createDeps({ ...TX_ROW, type: "adjust", quantityDelta: 3 });
    const service = new StorageService({ select: selectQueue([[ITEM]]) } as never, deps);

    const result = await service.applyTransaction(manager(), "item-1", {
      type: "adjust",
      target_quantity: 15,
    });

    expect(result.ok).toBe(true);
    const batch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; binds: unknown[] }>;
    expect(batch[0]?.sql).toMatch(/quantity_delta[\s\S]*SELECT/i);
    expect(batch[0]?.sql).toMatch(/\?\d+\s*-\s*quantity/);
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      detailText: JSON.stringify({
        item_id: "item-1",
        quantity_delta: 3,
        recipient_user_id: null,
        note: null,
        target_quantity: 15,
      }),
    }));
  });

  it("rejects an adjustment that reaches its target before the transaction executes", async () => {
    const { deps, rawDb } = createDeps();
    rawDb.batch.mockResolvedValueOnce([
      { meta: { changes: 0 } },
      { meta: { changes: 0 } },
    ]);
    const service = new StorageService(
      { select: selectQueue([[ITEM], [{ ...ITEM, quantity: 15 }]]) } as never,
      deps,
    );

    const result = await service.applyTransaction(manager(), "item-1", {
      type: "adjust",
      target_quantity: 15,
    });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(deps.writeAuditLog).not.toHaveBeenCalled();
    expect(deps.publishEntityChanged).not.toHaveBeenCalled();
  });

  it("rejects adjustment targets that would not change stock", async () => {
    const { deps, rawDb } = createDeps();
    const service = new StorageService({ select: selectQueue([[ITEM]]) } as never, deps);

    const result = await service.applyTransaction(manager(), "item-1", {
      type: "adjust",
      target_quantity: 10,
    });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(rawDb.batch).not.toHaveBeenCalled();
  });

  it("allows member self-deposit only when the item flag allows it", async () => {
    const { deps, rawDb } = createDeps();
    const service = new StorageService({ select: selectQueue([[{ ...ITEM, allowMemberDeposit: true }], [{ ...TX_ROW, type: "intake", quantityDelta: 3, actorId: "member-1" }]]) } as never, deps);

    const result = await service.applyTransaction(member(), "item-1", { type: "intake", quantity: 3 });

    expect(result.ok).toBe(true);
    const batch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; binds: unknown[] }>;
    expect(batch[1]?.binds[4]).toBe("member-1");
  });

  it("forces member withdraw attribution to the current user", async () => {
    const { deps, rawDb } = createDeps();
    const service = new StorageService({ select: selectQueue([[ITEM], [TX_ROW]]) } as never, deps);

    const result = await service.applyTransaction(member(), "item-1", {
      type: "distribute",
      quantity: 1,
      recipient_user_id: "member-2",
    });

    expect(result.ok).toBe(true);
    const batch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; binds: unknown[] }>;
    expect(batch[1]?.binds[4]).toBe("member-1");
  });
});

describe("StorageService.listItems", () => {
  function storageItem(index: number, overrides: Partial<StorageItemMock> = {}): StorageItemMock {
    return {
      ...ITEM,
      id: `item-${String(index).padStart(2, "0")}`,
      name: `Item ${String(index).padStart(2, "0")}`,
      ...overrides,
    };
  }

  it("returns 24 of 25 rows and derives the cursor from the actual page end", async () => {
    const items = Array.from({ length: 25 }, (_, index) => storageItem(index + 1));
    const query = createListItemsDb(items);
    const service = new StorageService(query.db as never, createDeps().deps);

    const result = await service.listItems({ limit: 24, stock: "all" });

    expect(result).toMatchObject({ ok: true, data: { data: expect.any(Array) } });
    if (!result.ok) throw new Error("expected success");
    expect(result.data.data).toHaveLength(24);
    expect(result.data.next_cursor).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(result.data.next_cursor!, "base64url").toString("utf8"));
    expect(decoded).toEqual({ name: "Item 24", id: "item-24" });
    expect(query.itemLimit).toHaveBeenCalledWith(25);
  });

  it("uses name and id together to continue across same-name rows", async () => {
    const firstPage = [
      storageItem(1, { name: "Amber", id: "a" }),
      storageItem(2, { name: "Amber", id: "b" }),
      storageItem(3, { name: "Amber", id: "c" }),
    ];
    const firstService = new StorageService(
      createListItemsDb(firstPage).db as never,
      createDeps().deps,
    );
    const firstResult = await firstService.listItems({ limit: 2, stock: "all" });
    if (!firstResult.ok || !firstResult.data.next_cursor) throw new Error("expected first-page cursor");

    const continuationQuery = createListItemsDb([
      storageItem(3, { name: "Amber", id: "c" }),
    ]);
    const service = new StorageService(continuationQuery.db as never, createDeps().deps);
    const result = await service.listItems({
      limit: 2,
      cursor: firstResult.data.next_cursor,
      stock: "all",
    });

    expect(result).toMatchObject({
      ok: true,
      data: { data: [expect.objectContaining({ id: "c" })], next_cursor: null },
    });
    const compiled = compileWhere(continuationQuery.itemWhere);
    expect(compiled.sql).toMatch(
      /name"? > \? or \("storage_items"\."name" = \? and "storage_items"\."id" > \?\)/i,
    );
    expect(compiled.params).toEqual(["Amber", "Amber", "b"]);
  });

  it("applies SQL filters and only queries images for the current page", async () => {
    const query = createListItemsDb(
      [storageItem(1, { id: "item-1" }), storageItem(2, { id: "item-2" })],
      [{ id: "image-1", itemId: "item-1", r2Key: "one", createdAt: "now" }],
    );
    const service = new StorageService(query.db as never, createDeps().deps);

    const result = await service.listItems({ storageId: "storage-1", categoryId: "category-1", search: "  50%_\\  ", stock: "available", limit: 1 });

    expect(result).toMatchObject({
      ok: true,
      data: {
        data: [
          expect.objectContaining({
            id: "item-1",
            images: [expect.objectContaining({ id: "image-1" })],
          }),
        ],
      },
    });
    const itemQuery = compileWhere(query.itemWhere);
    expect(itemQuery.sql).toMatch(/storage_id"? = \?/i);
    expect(itemQuery.sql).toMatch(/category_id"? = \?/i);
    expect(itemQuery.sql).toMatch(/lower\("storage_items"\."name"\) LIKE \? ESCAPE '\\'/i);
    expect(itemQuery.sql).toMatch(/quantity"? > \?/i);
    expect(itemQuery.params).toEqual([
      "storage-1",
      "category-1",
      "%50\\%\\_\\\\%",
      0,
    ]);
    const imageQuery = compileWhere(query.imageWhere);
    expect(imageQuery.sql).toMatch(/item_id"? in \(\?\)/i);
    expect(imageQuery.params).toEqual(["item-1"]);
  });

  it.each([
    ["available", /quantity"? > \?/i, 0],
    ["empty", /quantity"? = \?/i, 0],
    ["deposit", /allow_member_deposit"? = \?/i, 1],
    ["withdraw", /allow_member_withdraw"? = \?/i, 1],
  ] as const)("applies the %s stock filter before pagination", async (stock, sqlPattern, parameter) => {
    const query = createListItemsDb([]);
    const service = new StorageService(query.db as never, createDeps().deps);

    await service.listItems({ stock, limit: 24 });

    const compiled = compileWhere(query.itemWhere);
    expect(compiled.sql).toMatch(sqlPattern);
    expect(compiled.params).toContain(parameter);
  });

  it("rejects malformed cursors", async () => {
    const service = new StorageService({ select: selectQueue([]) } as never, createDeps().deps);

    await expect(service.listItems({ cursor: "not a cursor", limit: 24, stock: "all" })).resolves.toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });
});

type BatchPreflightRow = {
  markerId: string | null;
  markerDetailText: string | null;
  requestedItemId: string;
  requestedQuantity: number;
  itemId: string | null;
  itemName: string | null;
  itemQuantity: number | null;
  allowMemberDeposit: boolean;
  allowMemberWithdraw: boolean;
  actorId: string | null;
  actorUsername: string | null;
  recipientId: string | null;
  recipientUsername: string | null;
};

function batchRow(itemId: string, quantity: number, overrides: Partial<BatchPreflightRow> = {}): BatchPreflightRow {
  return {
    markerId: null,
    markerDetailText: null,
    requestedItemId: itemId,
    requestedQuantity: quantity,
    itemId,
    itemName: itemId,
    itemQuantity: 100,
    allowMemberDeposit: true,
    allowMemberWithdraw: true,
    actorId: "admin-1",
    actorUsername: "Admin",
    recipientId: "member-1",
    recipientUsername: "Member",
    ...overrides,
  };
}

function createBatchDeps(preflightRounds: BatchPreflightRow[][]) {
  const statements: Array<{ sql: string; binds: unknown[] }> = [];
  const rawDb = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...binds: unknown[]) => {
        const statement = {
          sql,
          binds,
          all: vi.fn(() => Promise.resolve({ results: preflightRounds.shift() ?? [] })),
          first: vi.fn().mockResolvedValue(null),
        };
        statements.push(statement);
        return statement;
      }),
    })),
    batch: vi.fn().mockResolvedValue([]),
  };
  return {
    statements,
    rawDb,
    deps: {
      rawDb: rawDb as never,
      media: { put: vi.fn().mockResolvedValue({}) } as never,
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("StorageService.applyBatchTransactions", () => {
  it("builds a forty-one statement atomic batch for twenty sorted entries", async () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({ item_id: `item-${String(19 - index).padStart(2, "0")}`, quantity: 1 }));
    const ordered = [...entries].sort((a, b) => a.item_id.localeCompare(b.item_id));
    const { deps, rawDb } = createBatchDeps([ordered.map((entry) => batchRow(entry.item_id, entry.quantity))]);
    const service = new StorageService({} as never, deps);

    const result = await service.applyBatchTransactions(manager(), {
      idempotency_key: "batch-key-123456",
      type: "intake",
      entries,
    });

    expect(result).toMatchObject({ ok: true, data: { replayed: false } });
    const batch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; binds: unknown[] }>;
    expect(batch).toHaveLength(41);
    expect(batch[0]?.sql).toContain("INSERT INTO audit_log");
    expect(batch[1]?.sql).toContain("UPDATE storage_items");
    expect(batch[2]?.sql).toContain("INSERT INTO storage_transactions");
    expect(batch[1]?.binds[2]).toBe("item-00");
    expect(deps.writeAuditLog).not.toHaveBeenCalled();
    expect(deps.publishEntityChanged).toHaveBeenCalledTimes(1);
  });

  it("registers the idempotency marker audit in the same system-test batch", async () => {
    const { deps, rawDb } = createBatchDeps([[batchRow("item-1", 2)]]);
    const systemTestDeps = { ...deps, systemTestRunId: "run-1" };
    const service = new StorageService({} as never, systemTestDeps);

    const result = await service.applyBatchTransactions(manager(), {
      idempotency_key: "batch-key-123456",
      type: "intake",
      entries: [{ item_id: "item-1", quantity: 2 }],
    });

    expect(result).toMatchObject({ ok: true, data: { replayed: false } });
    const batch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; binds: unknown[] }>;
    expect(batch).toHaveLength(4);
    expect(batch[0]?.sql).toContain("INSERT INTO audit_log");
    expect(batch[1]?.sql).toContain("INSERT INTO system_test_artifacts");
    expect(batch[1]?.binds).toEqual([
      "run-1",
      expect.stringMatching(/^storage-batch-/),
    ]);
    expect(batch[1]?.sql).toContain("SELECT id FROM system_test_runs");
    expect(batch[2]?.sql).toContain("UPDATE storage_items");
    expect(batch[3]?.sql).toContain("INSERT INTO storage_transactions");
  });

  it("replays the stored response without a second batch", async () => {
    const request = {
      idempotency_key: "batch-key-123456",
      type: "intake",
      entries: [{ item_id: "item-1", quantity: 2 }],
      recipient_user_id: null,
      note: null,
    };
    const stored = {
      data: [{
        id: "tx-1",
        item_id: "item-1",
        item_name: "Moon Blade",
        type: "intake",
        quantity_delta: 2,
        recipient_user_id: null,
        recipient_username: null,
        note: null,
        actor_id: "admin-1",
        actor_username: "Admin",
        created_at: "2026-06-11T00:00:00.000Z",
      }],
      replayed: false,
    };
    const { deps, rawDb } = createBatchDeps([[batchRow("item-1", 2, {
      markerId: "marker",
      markerDetailText: JSON.stringify({
        kind: "storage_batch",
        version: 1,
        request,
        response: stored,
      }),
    })]]);
    const service = new StorageService({} as never, deps);

    const result = await service.applyBatchTransactions(manager(), {
      idempotency_key: "batch-key-123456",
      type: "intake",
      entries: [{ item_id: "item-1", quantity: 2 }],
    });

    expect(result).toMatchObject({ ok: true, data: { replayed: true, data: stored.data } });
    expect(rawDb.batch).not.toHaveBeenCalled();
  });

  it("rejects an idempotency key reused for a different normalized request", async () => {
    const storedRequest = {
      idempotency_key: "batch-key-123456",
      type: "intake",
      entries: [{ item_id: "item-1", quantity: 1 }],
      recipient_user_id: null,
      note: null,
    };
    const { deps, rawDb } = createBatchDeps([[batchRow("item-1", 2, {
      markerId: "marker",
      markerDetailText: JSON.stringify({
        kind: "storage_batch",
        version: 1,
        request: storedRequest,
        response: { data: [], replayed: false },
      }),
    })]]);
    const service = new StorageService({} as never, deps);

    const result = await service.applyBatchTransactions(manager(), {
      idempotency_key: "batch-key-123456",
      type: "intake",
      entries: [{ item_id: "item-1", quantity: 2 }],
    });

    expect(result).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(rawDb.batch).not.toHaveBeenCalled();
  });

  it("forces member attribution and rechecks member permission in the update SQL", async () => {
    const { deps, rawDb } = createBatchDeps([[batchRow("item-1", 2, { actorId: "member-1", actorUsername: "Member", recipientId: "member-1" })]]);
    const service = new StorageService({} as never, deps);

    const result = await service.applyBatchTransactions(member(), {
      idempotency_key: "batch-key-123456",
      type: "distribute",
      entries: [{ item_id: "item-1", quantity: 2 }],
      recipient_user_id: "member-2",
    });

    expect(result.ok).toBe(true);
    const batch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; binds: unknown[] }>;
    expect(batch[1]?.sql).toMatch(
      /CASE\s+WHEN allow_member_withdraw = 1 THEN quantity \+ \?1\s+ELSE -1\s+END/,
    );
    expect(batch[2]?.binds[4]).toBe("member-1");
  });

  it("returns a stock conflict from the failure re-preflight", async () => {
    const { deps, rawDb } = createBatchDeps([
      [batchRow("item-1", 7, { itemQuantity: 10 })],
      [batchRow("item-1", 7, { itemQuantity: 4 })],
    ]);
    rawDb.batch.mockRejectedValueOnce(new Error("D1_ERROR: CHECK constraint failed: storage_items_quantity_nonnegative"));
    const service = new StorageService({} as never, deps);

    const result = await service.applyBatchTransactions(manager(), {
      idempotency_key: "batch-key-123456",
      type: "distribute",
      recipient_user_id: "member-1",
      entries: [{ item_id: "item-1", quantity: 7 }],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "CONFLICT",
      details: { current_quantity: 4, requested_quantity: 7 },
    });
  });

  it("fails closed when an existing idempotency marker is corrupt", async () => {
    const { deps, rawDb } = createBatchDeps([[
      batchRow("item-1", 1, {
        markerId: "marker",
        markerDetailText: "{\"kind\":\"storage_batch\"}",
      }),
    ]]);
    const service = new StorageService({} as never, deps);

    const result = await service.applyBatchTransactions(manager(), {
      idempotency_key: "batch-key-123456",
      type: "intake",
      entries: [{ item_id: "item-1", quantity: 1 }],
    });

    expect(result).toMatchObject({ ok: false, code: "SERVER_ERROR" });
    expect(rawDb.batch).not.toHaveBeenCalled();
  });

  it("does not write when the preflight result is incomplete", async () => {
    const { deps, rawDb } = createBatchDeps([[]]);
    const service = new StorageService({} as never, deps);

    const result = await service.applyBatchTransactions(manager(), {
      idempotency_key: "batch-key-123456",
      type: "intake",
      entries: [{ item_id: "item-1", quantity: 1 }],
    });

    expect(result).toMatchObject({ ok: false, code: "SERVER_ERROR" });
    expect(rawDb.batch).not.toHaveBeenCalled();
  });
});

describe("StorageService structural audits", () => {
  it("logs storage changes as storage entities", async () => {
    const { deps } = createDeps();
    const storageRow = {
      id: "storage-1",
      name: "Vault",
      description: null,
      createdAt: "2026-06-11T00:00:00.000Z",
    };
    const insert = vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
    const service = new StorageService({ insert, select: selectQueue([[storageRow]]) } as never, deps);

    const result = await service.createStorage(manager().id, { name: "Vault" });

    expect(result.ok).toBe(true);
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ entityType: "storage", action: "create" }));
  });

  it("logs category changes as storage_category entities", async () => {
    const { deps } = createDeps();
    const insert = vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
    const service = new StorageService({ insert } as never, deps);

    const result = await service.createCategory(manager().id, "storage-1", { name: "Materials" });

    expect(result.ok).toBe(true);
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ entityType: "storage_category", action: "create" }));
  });
});

describe("StorageService.deleteStorage", () => {
  it("rejects deleting a storage that still contains items", async () => {
    const { deps } = createDeps();
    const service = new StorageService({ select: selectQueue([[{ count: 1 }]]) } as never, deps);

    const result = await service.deleteStorage(manager().id, "storage-1");

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
  });
});

describe("StorageService.uploadImages", () => {
  it("rejects uploads past the per-item image cap", async () => {
    const { deps } = createDeps();
    const existingImages = Array.from({ length: 5 }, (_, i) => ({ id: `img-${i}`, r2Key: `k-${i}`, createdAt: "now" }));
    const service = new StorageService({ select: selectQueue([[ITEM], existingImages]) } as never, deps);

    const result = await service.uploadImages(manager().id, "item-1", [
      { data: new ArrayBuffer(1), contentType: "image/png", name: "extra.png" },
    ]);

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("uses the configured per-item image cap", async () => {
    const { deps } = createDeps();
    deps.getStoragePolicy.mockResolvedValueOnce({ images_per_item: 2 });
    const existingImages = [{ id: "img-1", itemId: "item-1", r2Key: "k-1", createdAt: "now" }];
    const service = new StorageService({ select: selectQueue([[ITEM], existingImages]) } as never, deps);

    const result = await service.uploadImages(manager().id, "item-1", [
      { data: new ArrayBuffer(1), contentType: "image/png", name: "one.png" },
      { data: new ArrayBuffer(1), contentType: "image/png", name: "two.png" },
    ]);

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("removes every attempted R2 key and image UUID when a later upload fails", async () => {
    const failure = new Error("second R2 upload failed");
    const { deps, rawDb } = createDeps();
    const put = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(failure);
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    deps.media = { put, delete: deleteObject } as never;
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const service = new StorageService({
      select: selectQueue([[ITEM], []]),
      insert: vi.fn(() => ({ values: insertValues })),
    } as never, deps);

    await expect(service.uploadImages(manager().id, "item-1", [
      { data: new ArrayBuffer(1), contentType: "image/png", name: "one.png" },
      { data: new ArrayBuffer(1), contentType: "image/png", name: "two.png" },
    ])).rejects.toBe(failure);

    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(rawDb.prepare).toHaveBeenCalledWith("DELETE FROM storage_item_images WHERE id = ?1");
    expect(rawDb.batch).toHaveBeenCalled();
  });
});
