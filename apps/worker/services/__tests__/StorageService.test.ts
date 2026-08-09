
import { describe, expect, it, vi } from "vitest";
import type { Permission } from "@guild/shared";
import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { StorageService } from "../StorageService";
import type { MediaService } from "../MediaService";

const MEDIA_ID = "Abcdefghijklmnopqrstu";
const SECOND_MEDIA_ID = "Vbcdefghijklmnopqrstu";

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
  const mediaService = {
    checkQuota: vi.fn().mockResolvedValue(true),
    createImages: vi.fn().mockResolvedValue({
      expiresAt: "2026-08-09T00:00:00.000Z",
      mediaIds: [SECOND_MEDIA_ID],
    }),
    listLinkedMedia: vi.fn().mockResolvedValue(new Map()),
    listLinkedMediaIds: vi.fn().mockResolvedValue([]),
    replace: vi.fn().mockResolvedValue(undefined),
  };
  return {
    statements,
    rawDb,
    deps: {
      rawDb: rawDb as never,
      mediaService: mediaService as typeof mediaService & MediaService,
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

function createListItemsDb(itemRows: unknown[]) {
  const itemLimit = vi.fn().mockResolvedValue(itemRows);
  const itemWhere = vi.fn(() => ({
    orderBy: vi.fn(() => ({ limit: itemLimit })),
  }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({ where: itemWhere })),
  }));
  return { db: { select }, itemLimit, itemWhere };
}

function compileWhere(whereMock: ReturnType<typeof vi.fn>) {
  const whereSql = whereMock.mock.calls[0]?.[0] as SQL;
  return new SQLiteSyncDialect().sqlToQuery(whereSql);
}

function manager() {
  return { id: "admin-1", roleId: "admin", role: "admin", roleName: "Admin", roleColor: "red", roleLevel: 999, permissions: new Set<Permission>(["admin.storage.stock"]) };
}

function member() {
  return { id: "member-1", roleId: "member", role: "member", roleName: "Member", roleColor: "gray", roleLevel: 100, permissions: new Set<Permission>() };
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
      detail: {
        item_id: "item-1",
        quantity_delta: -2,
        recipient_user_id: "member-1",
        note: null,
      },
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
      detail: {
        item_id: "item-1",
        quantity_delta: 3,
        recipient_user_id: null,
        note: null,
        target_quantity: 15,
      },
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

describe("StorageService.deleteItem", () => {
  it("returns an explicit conflict before touching media when the immutable ledger references the item", async () => {
    const { deps } = createDeps({ present: 1 });
    const service = new StorageService({ select: selectQueue([[ITEM]]) } as never, deps as never);

    const result = await service.deleteItem("admin-1", "item-1");

    expect(result).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(deps.mediaService.replace).not.toHaveBeenCalled();
    expect(deps.writeAuditLog).not.toHaveBeenCalled();
  });

  it("deletes the storage parent and lets lifecycle triggers remove linked media", async () => {
    const { deps, rawDb } = createDeps(null);
    deps.mediaService.listLinkedMediaIds.mockResolvedValueOnce([MEDIA_ID, SECOND_MEDIA_ID]);
    const service = new StorageService({ select: selectQueue([[ITEM]]) } as never, deps as never);

    const result = await service.deleteItem("admin-1", "item-1");

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(deps.mediaService.listLinkedMediaIds).not.toHaveBeenCalled();
    expect(deps.mediaService.replace).not.toHaveBeenCalled();
    const deleteStatement = rawDb.prepare.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes("DELETE FROM storage_items"));
    expect(deleteStatement).toBe("DELETE FROM storage_items WHERE id = ?1");
    expect(deps.writeAuditLog).toHaveBeenCalledOnce();
  });

  it("surfaces unrelated item deletion failures without mutating media links", async () => {
    const failure = new Error("D1 unavailable");
    const { deps, rawDb } = createDeps(null);
    deps.mediaService.listLinkedMediaIds.mockResolvedValueOnce([MEDIA_ID]);
    const originalPrepare = rawDb.prepare.getMockImplementation()!;
    rawDb.prepare.mockImplementation((sql: string) => {
      const statement = originalPrepare(sql);
      if (sql.includes("DELETE FROM storage_items")) {
        statement.bind = vi.fn((...binds: unknown[]) => ({
          sql,
          binds,
          run: vi.fn().mockRejectedValue(failure),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }));
      }
      return statement;
    });
    const service = new StorageService({ select: selectQueue([[ITEM]]) } as never, deps as never);

    await expect(service.deleteItem("admin-1", "item-1")).rejects.toBe(failure);

    expect(deps.mediaService.replace).not.toHaveBeenCalled();
  });

  it("preserves the ledger conflict when a concurrent transaction wins the delete race", async () => {
    const failure = new Error("D1_ERROR: FOREIGN KEY constraint failed");
    const { deps, rawDb } = createDeps(null);
    const originalPrepare = rawDb.prepare.getMockImplementation()!;
    rawDb.prepare.mockImplementation((sql: string) => {
      const statement = originalPrepare(sql);
      if (sql.includes("DELETE FROM storage_items")) {
        statement.bind = vi.fn((...binds: unknown[]) => ({
          sql,
          binds,
          run: vi.fn().mockRejectedValue(failure),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }));
      }
      return statement;
    });
    const service = new StorageService({ select: selectQueue([[ITEM]]) } as never, deps as never);

    await expect(service.deleteItem("admin-1", "item-1")).resolves.toMatchObject({ ok: false, code: "CONFLICT" });

    expect(deps.mediaService.replace).not.toHaveBeenCalled();
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

  it("applies SQL filters and resolves page media through MediaService", async () => {
    const query = createListItemsDb([
      storageItem(1, { id: "item-1" }),
      storageItem(2, { id: "item-2" }),
    ]);
    const created = createDeps();
    created.deps.mediaService.listLinkedMedia.mockResolvedValueOnce(new Map([
      ["item-1", [{ mediaId: MEDIA_ID, slot: "image", sortOrder: 0 }]],
    ]));
    const service = new StorageService(query.db as never, created.deps as never);

    const result = await service.listItems({ storageId: "storage-1", categoryId: "category-1", search: "  50%_\\  ", stock: "available", limit: 1 });

    expect(result).toMatchObject({
      ok: true,
      data: {
        data: [expect.objectContaining({
          id: "item-1",
          images: [{ media_id: MEDIA_ID }],
        })],
      },
    });
    const itemQuery = compileWhere(query.itemWhere);
    expect(itemQuery.sql).toMatch(/storage_id"? = \?/i);
    expect(itemQuery.sql).toMatch(/category_id"? = \?/i);
    expect(itemQuery.sql).toMatch(/lower\("storage_items"\."name"\) LIKE \? ESCAPE '\\'/i);
    expect(itemQuery.sql).toMatch(/quantity"? > \?/i);
    expect(itemQuery.params).toEqual(["storage-1", "category-1", "%50\\%\\_\\\\%", 0]);
    expect(created.deps.mediaService.listLinkedMedia).toHaveBeenCalledWith(
      "storage_item",
      ["item-1"],
      ["image"],
    );
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

describe("StorageService item category ownership", () => {
  it("rejects a category from another storage before creating the item", async () => {
    const insert = vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
    const service = new StorageService({
      insert,
      select: selectQueue([[{ id: "storage-1" }], [{ storageId: "storage-2" }]]),
    } as never, createDeps().deps);

    const result = await service.createItem(manager().id, {
      storage_id: "storage-1",
      category_id: "category-2",
      name: "Moon Blade",
    });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns a missing-category error before updating the item", async () => {
    const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) }));
    const service = new StorageService({
      update,
      select: selectQueue([[ITEM], [{ id: "storage-1" }], []]),
    } as never, createDeps().deps);

    const result = await service.updateItem(manager().id, ITEM.id, {
      category_id: "missing-category",
    });

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(update).not.toHaveBeenCalled();
  });
});

type BatchPreflightRow = {
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

type BatchReplayRow = {
  batchId?: string;
  batchActorId: string;
  batchCreatedAt: string;
  batchPosition: number | null;
  transactionId: string | null;
  itemId: string | null;
  itemName: string | null;
  type: string | null;
  quantityDelta: number | null;
  recipientUserId: string | null;
  recipientUsername: string | null;
  note: string | null;
  actorId: string | null;
  actorUsername: string | null;
  transactionCreatedAt: string | null;
};

function replayRow(
  itemId: string,
  quantityDelta: number,
  position = 0,
  overrides: Partial<BatchReplayRow> = {},
): BatchReplayRow {
  const createdAt = "2026-06-11T00:00:00.000Z";
  return {
    batchActorId: "admin-1",
    batchCreatedAt: createdAt,
    batchPosition: position,
    transactionId: `tx-${position + 1}`,
    itemId,
    itemName: itemId,
    type: quantityDelta > 0 ? "intake" : "distribute",
    quantityDelta,
    recipientUserId: null,
    recipientUsername: null,
    note: null,
    actorId: "admin-1",
    actorUsername: "Admin",
    transactionCreatedAt: createdAt,
    ...overrides,
  };
}

function createBatchDeps(options: {
  replayRounds?: BatchReplayRow[][];
  preflightRounds?: BatchPreflightRow[][];
} = {}) {
  const replayRounds = [...(options.replayRounds ?? [])];
  const preflightRounds = [...(options.preflightRounds ?? [])];
  const statements: Array<{ sql: string; binds: unknown[] }> = [];
  const rawDb = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...binds: unknown[]) => {
        const statement = {
          sql,
          binds,
          all: vi.fn(() => {
            if (sql.includes("FROM storage_batches batch")) {
              const rows = (replayRounds.shift() ?? []).map((row) => ({
                ...row,
                batchId: row.batchId ?? String(binds[0]),
              }));
              return Promise.resolve({ results: rows });
            }
            if (sql.includes("WITH requested(item_id, quantity)")) {
              return Promise.resolve({ results: preflightRounds.shift() ?? [] });
            }
            return Promise.resolve({ results: [] });
          }),
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
      mediaService: {
        listLinkedMedia: vi.fn().mockResolvedValue(new Map()),
        listLinkedMediaIds: vi.fn().mockResolvedValue([]),
        replace: vi.fn().mockResolvedValue(undefined),
      } as never,
      getStoragePolicy: vi.fn().mockResolvedValue({ images_per_item: 5 }),
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
      publishEntityChanged: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("StorageService.applyBatchTransactions", () => {
  it("builds one atomic batch for twenty sorted entries and keeps every ledger delta equal to its stock delta", async () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({ item_id: `item-${String(19 - index).padStart(2, "0")}`, quantity: 1 }));
    const ordered = [...entries].sort((a, b) => a.item_id.localeCompare(b.item_id));
    const { deps, rawDb } = createBatchDeps({
      replayRounds: [[]],
      preflightRounds: [ordered.map((entry) => batchRow(entry.item_id, entry.quantity))],
    });
    const service = new StorageService({} as never, deps);

    const result = await service.applyBatchTransactions(manager(), {
      idempotency_key: "batch-key-123456",
      type: "intake",
      entries,
    });

    expect(result).toMatchObject({ ok: true, data: { replayed: false } });
    const batch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; binds: unknown[] }>;
    expect(batch).toHaveLength(42);
    expect(batch[0]?.sql).toContain("INSERT INTO storage_batches");
    expect(batch[1]?.sql).toContain("UPDATE storage_items");
    expect(batch[2]?.sql).toContain("INSERT INTO storage_transactions");
    expect(batch[1]?.binds[2]).toBe("item-00");
    for (let index = 0; index < 20; index += 1) {
      const update = batch[index * 2 + 1]!;
      const ledger = batch[index * 2 + 2]!;
      expect(ledger.binds[1]).toBe(update.binds[2]);
      expect(ledger.binds[3]).toBe(update.binds[0]);
      expect(ledger.binds[8]).toBe(index);
      expect(ledger.binds[7]).toBe(batch[0]?.binds[0]);
    }
    const audit = batch.at(-1)!;
    expect(audit.sql).toContain("INSERT INTO audit_log");
    expect(audit.binds.slice(1, 6)).toEqual([
      "storage_transaction",
      "intake",
      "admin-1",
      batch[0]?.binds[0],
      "Batch intake (20)",
    ]);
    expect(JSON.parse(String(audit.binds[6]))).toMatchObject({
      batch_id: batch[0]?.binds[0],
      type: "intake",
      entries: ordered,
    });
    expect(audit.binds[7]).toBe(batch[0]?.binds[2]);
    expect(deps.writeAuditLog).not.toHaveBeenCalled();
    expect(deps.publishEntityChanged).toHaveBeenCalledTimes(1);
  });

  it("registers both the storage batch and ordinary audit in the same system-test batch", async () => {
    const { deps, rawDb } = createBatchDeps({
      replayRounds: [[]],
      preflightRounds: [[batchRow("item-1", 2)]],
    });
    const systemTestDeps = { ...deps, systemTestRunId: "run-1" };
    const service = new StorageService({} as never, systemTestDeps);

    const result = await service.applyBatchTransactions(manager(), {
      idempotency_key: "batch-key-123456",
      type: "intake",
      entries: [{ item_id: "item-1", quantity: 2 }],
    });

    expect(result).toMatchObject({ ok: true, data: { replayed: false } });
    const batch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; binds: unknown[] }>;
    expect(batch).toHaveLength(6);
    expect(batch[0]?.sql).toContain("INSERT INTO storage_batches");
    expect(batch[1]?.sql).toContain("INSERT INTO system_test_artifacts");
    expect(batch[1]?.binds).toEqual([
      "run-1",
      "storage_batch",
      expect.stringMatching(/^storage-batch-/),
    ]);
    expect(batch[1]?.sql).toContain("SELECT id FROM system_test_runs");
    expect(batch[2]?.sql).toContain("UPDATE storage_items");
    expect(batch[3]?.sql).toContain("INSERT INTO storage_transactions");
    expect(batch[4]?.sql).toContain("INSERT INTO audit_log");
    expect(batch[5]?.binds).toEqual(["run-1", "audit_log", batch[4]?.binds[0]]);
  });

  it("replays the normalized request and response from relational ledger rows", async () => {
    const { deps, rawDb } = createBatchDeps({
      replayRounds: [[replayRow("item-1", 2, 0, { itemName: "Moon Blade" })]],
    });
    const service = new StorageService({} as never, deps);

    const result = await service.applyBatchTransactions(manager(), {
      idempotency_key: "batch-key-123456",
      type: "intake",
      entries: [{ item_id: "item-1", quantity: 2 }],
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        replayed: true,
        data: [{
          id: "tx-1",
          item_id: "item-1",
          item_name: "Moon Blade",
          quantity_delta: 2,
        }],
      },
    });
    expect(rawDb.batch).not.toHaveBeenCalled();
  });

  it("rejects an idempotency key reused for a different normalized request", async () => {
    const { deps, rawDb } = createBatchDeps({
      replayRounds: [[replayRow("item-1", 1)]],
    });
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
    const { deps, rawDb } = createBatchDeps({
      replayRounds: [[]],
      preflightRounds: [[batchRow("item-1", 2, { actorId: "member-1", actorUsername: "Member", recipientId: "member-1" })]],
    });
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
    const { deps, rawDb } = createBatchDeps({
      replayRounds: [[], []],
      preflightRounds: [
        [batchRow("item-1", 7, { itemQuantity: 10 })],
        [batchRow("item-1", 7, { itemQuantity: 4 })],
      ],
    });
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

  it("returns the committed winner when a concurrent request claims the same batch id", async () => {
    const { deps, rawDb } = createBatchDeps({
      replayRounds: [[], [replayRow("item-1", 2)]],
      preflightRounds: [[batchRow("item-1", 2)]],
    });
    rawDb.batch.mockRejectedValueOnce(new Error("D1_ERROR: UNIQUE constraint failed: storage_batches.id"));
    const service = new StorageService({} as never, deps);

    const result = await service.applyBatchTransactions(manager(), {
      idempotency_key: "batch-key-123456",
      type: "intake",
      entries: [{ item_id: "item-1", quantity: 2 }],
    });

    expect(result).toMatchObject({ ok: true, data: { replayed: true } });
    expect(rawDb.batch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing transaction", [replayRow("item-1", 1, 0, { transactionId: null, batchPosition: null })]],
    ["position gap", [replayRow("item-1", 1, 1)]],
  ] as Array<[string, BatchReplayRow[]]>)("fails closed for a corrupt stored batch with %s", async (_label, replayRows) => {
    const { deps, rawDb } = createBatchDeps({ replayRounds: [replayRows] });
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
    const { deps, rawDb } = createBatchDeps({ replayRounds: [[]], preflightRounds: [[]] });
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
  it("uses entity quota from the storage policy", async () => {
    const { deps } = createDeps();
    deps.mediaService.checkQuota.mockResolvedValueOnce(false);
    const service = new StorageService({ select: selectQueue([[ITEM]]) } as never, deps as never);

    const result = await service.uploadImages(
      manager().id,
      "item-1",
      [{ full: new ArrayBuffer(1), view: new ArrayBuffer(1) }],
      5_000_000,
    );

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(deps.mediaService.checkQuota).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "storage_image",
      scope: { kind: "entity", entityType: "storage_item", entityId: "item-1" },
      limit: 5,
      incomingCount: 1,
    }));
    expect(deps.mediaService.createImages).not.toHaveBeenCalled();
  });

  it("uses the configured per-item image cap", async () => {
    const { deps } = createDeps();
    deps.getStoragePolicy.mockResolvedValueOnce({ images_per_item: 2 });
    deps.mediaService.checkQuota.mockResolvedValueOnce(false);
    const service = new StorageService({ select: selectQueue([[ITEM]]) } as never, deps as never);

    await service.uploadImages(
      manager().id,
      "item-1",
      [{ full: new ArrayBuffer(1), view: new ArrayBuffer(1) }],
      5_000_000,
    );

    expect(deps.mediaService.checkQuota).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
  });

  it("creates canonical assets and appends their media ids to the item", async () => {
    const { deps } = createDeps();
    deps.mediaService.listLinkedMediaIds.mockResolvedValueOnce([MEDIA_ID]);
    const service = new StorageService({ select: selectQueue([[ITEM]]) } as never, deps as never);

    const result = await service.uploadImages(
      manager().id,
      "item-1",
      [{ full: new ArrayBuffer(1), view: new ArrayBuffer(1) }],
      5_000_000,
    );

    expect(result).toEqual({ ok: true, data: [{ media_id: SECOND_MEDIA_ID }] });
    expect(deps.mediaService.createImages).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "storage_image",
      maxBytes: 5_000_000,
    }));
    expect(deps.mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "storage_item",
      entityId: "item-1",
      slot: "image",
      media: [
        { mediaId: MEDIA_ID, sortOrder: 0 },
        { mediaId: SECOND_MEDIA_ID, sortOrder: 1 },
      ],
    }));
  });

  it("deletes an image by media id while preserving link order", async () => {
    const { deps } = createDeps();
    deps.mediaService.listLinkedMediaIds.mockResolvedValueOnce([MEDIA_ID, SECOND_MEDIA_ID]);
    const service = new StorageService({ select: selectQueue([[ITEM]]) } as never, deps as never);

    const result = await service.deleteImage(manager().id, "item-1", MEDIA_ID);

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(deps.mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      media: [{ mediaId: SECOND_MEDIA_ID, sortOrder: 0 }],
    }));
  });
});
