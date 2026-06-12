import { describe, expect, it, vi } from "vitest";
import type { Permission } from "@guild/shared";
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
    batch: vi.fn().mockResolvedValue(undefined),
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
        stock_before: 10,
        stock_after: 8,
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

  it("converts admin stock adjustment targets into ledger deltas", async () => {
    const { deps, rawDb } = createDeps();
    const service = new StorageService({ select: selectQueue([[ITEM], [{ ...TX_ROW, type: "adjust", quantityDelta: 5 }]]) } as never, deps);

    const result = await service.applyTransaction(manager(), "item-1", {
      type: "adjust",
      target_quantity: 15,
    });

    expect(result.ok).toBe(true);
    const batch = rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string; binds: unknown[] }>;
    expect(batch[0]?.binds[0]).toBe(5);
    expect(batch[1]?.binds[2]).toBe("adjust");
    expect(batch[1]?.binds[3]).toBe(5);
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

describe("StorageService.intakeBatch", () => {
  it("updates every item, writes every ledger row, and logs the batch intake", async () => {
    const { deps, rawDb } = createDeps();
    const service = new StorageService({ select: selectQueue([[ITEM, { ...ITEM, id: "item-2", name: "Stone" }]]) } as never, deps);

    const result = await service.intakeBatch(manager(), {
      entries: [
        { item_id: "item-1", quantity: 2 },
        { item_id: "item-2", quantity: 5 },
      ],
    });

    expect(result).toEqual({ ok: true, data: { ok: true, count: 2 } });
    const batch = rawDb.batch.mock.calls[0]?.[0] as unknown[];
    expect(batch).toHaveLength(4);
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "storage_transaction",
      action: "batch_intake",
      actorId: "admin-1",
      entityId: "batch",
      diffTitle: "2 items",
      detailText: JSON.stringify({
        count: 2,
        item_ids: ["item-1", "item-2"],
        note: null,
      }),
    }));
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
});
