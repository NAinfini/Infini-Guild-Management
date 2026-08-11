import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createAppDatabase } from "../database.js";
import {
  assertSqlBatchStatement,
  assertSqlResultColumns,
  assertSqlStatement,
  type SqlBatchStatement,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "@guild/kernel";
import {
  StorageService,
  type StorageMediaPort,
  type StockCommit,
} from "@guild/server/modules/storage";
import { createAuditMutation } from "@guild/server/modules/audit";
import { createAuthorizationContext, createRequestContext, type RequestContext } from "@guild/kernel";
import { LIMITS } from "@guild/shared/config/limits";
import { SqliteStorageMediaPort, SqliteStorageStore } from "./storage-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const MEMBER_ID = "member-1";
const OTHER_ID = "member-2";
const ADMIN_ID = "admin-1";

const FRESH_MIGRATION = readFileSync(
  fileURLToPath(new URL("../migrations/generated/0000_core.sql", import.meta.url)),
  "utf8",
).replaceAll("--> statement-breakpoint", "");

class TestSqlExecutor implements SqlExecutor {
  readonly executions: SqlStatement[] = [];
  readonly batches: SqlBatchStatement[][] = [];
  beforeNextBatch: (() => void | Promise<void>) | undefined;

  constructor(readonly database: DatabaseSync) {}

  async execute(statement: SqlStatement): Promise<SqlResult> {
    assertSqlStatement(statement);
    this.executions.push(statement);
    return this.run(statement);
  }

  async batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    statements.forEach(assertSqlBatchStatement);
    const beforeBatch = this.beforeNextBatch;
    this.beforeNextBatch = undefined;
    await beforeBatch?.();
    this.batches.push([...statements]);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => this.run(statement));
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private run(statement: SqlStatement): SqlResult {
    const prepared = this.database.prepare(statement.sql);
    const params = [...(statement.params ?? [])] as SQLInputValue[];
    if (statement.method === "run") {
      const result = prepared.run(...params);
      return { rows: [], ...(result.lastInsertRowid === 0 ? {} : { lastInsertRowId: result.lastInsertRowid }) };
    }
    prepared.setReturnArrays(true);
    assertSqlResultColumns(statement, prepared.columns().map(({ name }) => name));
    if (statement.method === "get") {
      return { rows: prepared.get(...params) as unknown as SqlRow | undefined };
    }
    return { rows: prepared.all(...params) as unknown as readonly SqlRow[] };
  }
}

class FakeMedia implements StorageMediaPort {
  readonly byItem = new Map<string, string[]>();

  async listItemMediaIds(itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    return new Map(itemIds.map((id) => [id, this.byItem.get(id) ?? []]));
  }

  async attachItemImages(input: Parameters<StorageMediaPort["attachItemImages"]>[0]): Promise<readonly string[]> {
    const ids = input.uploads.map((_, index) => `${String(index).padStart(20, "a")}b`);
    this.byItem.set(input.itemId, [...(this.byItem.get(input.itemId) ?? []), ...ids]);
    return ids;
  }

  async detachItemImage(input: Parameters<StorageMediaPort["detachItemImage"]>[0]): Promise<boolean> {
    const current = this.byItem.get(input.itemId) ?? [];
    if (!current.includes(input.mediaId)) return false;
    this.byItem.set(input.itemId, current.filter((id) => id !== input.mediaId));
    return true;
  }
}

type Harness = ReturnType<typeof createHarness>;
const databases: DatabaseSync[] = [];
const notifications = { publish: async () => undefined };
const deferred = { defer: (task: () => void | Promise<void>) => { void task(); } };

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createHarness() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(FRESH_MIGRATION);
  const executor = new TestSqlExecutor(database);
  const store = new SqliteStorageStore(createAppDatabase(executor), executor);
  const media = new FakeMedia();
  const published: unknown[] = [];
  let sequence = 0;
  const service = new StorageService(
    store,
    media,
    { publish: async (message) => { published.push(message); } },
    deferred,
    () => `generated-${++sequence}`,
  );
  seed(database);
  return { database, executor, store, media, published, service };
}

function seed(database: DatabaseSync): void {
  const insertUser = database.prepare(`INSERT INTO users (id, username, role_id, revision_token)
    VALUES (?, ?, ?, ?)`);
  insertUser.run(ADMIN_ID, "admin", "admin", "admin-revision-0001");
  insertUser.run(MEMBER_ID, "member", "member", "member-revision-0001");
  insertUser.run(OTHER_ID, "other", "member", "other-revision-0001");
  database.prepare("INSERT INTO storages (id, name, description, created_at) VALUES (?, ?, ?, ?)")
    .run("storage-1", "Guild Vault", null, NOW);
  database.prepare("INSERT INTO storage_categories (id, storage_id, name, created_at) VALUES (?, ?, ?, ?)")
    .run("category-1", "storage-1", "Supplies", NOW);
  const insertItem = database.prepare(`INSERT INTO storage_items (
    id, storage_id, category_id, name, description,
    allow_member_deposit, allow_member_withdraw, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertItem.run("item-open", "storage-1", "category-1", "Open potion", null, 1, 1, NOW, NOW);
  insertItem.run("item-deposit", "storage-1", "category-1", "Deposit only", null, 1, 0, NOW, NOW);
  insertItem.run("item-admin", "storage-1", "category-1", "Admin stock", null, 0, 0, NOW, NOW);
}

function context(userId: string, permissions: readonly string[] = [], requestId = crypto.randomUUID()): RequestContext {
  return createRequestContext({
    requestId,
    authorization: createAuthorizationContext({
      userId,
      sessionId: `session-${userId}`,
      roleId: permissions.length > 0 ? "admin" : "member",
      roleLevel: permissions.length > 0 ? 10 : 100,
      permissions,
    }),
    now: NOW,
  });
}

async function quantity(harness: Harness, itemId: string): Promise<number> {
  return (await harness.store.getItem(itemId))!.quantity;
}

function scalar(database: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
  const row = database.prepare(sql).get(...params) as Record<string, number>;
  return Number(Object.values(row)[0]);
}

describe("storage structure bounds", () => {
  it("accepts the maximum storage and rejects max plus one without audit", async () => {
    const harness = createHarness();
    const insert = harness.database.prepare(
      "INSERT INTO storages (id, name, description, created_at) VALUES (?, ?, NULL, ?)",
    );
    for (let index = 2; index < LIMITS.content.storageStructure.storages.max; index += 1) {
      insert.run(`storage-${index}`, `Storage ${index}`, NOW);
    }
    const structure = context(ADMIN_ID, ["admin.storage.structure"]);
    await expect(harness.service.createStorage(structure, { name: "Last" })).resolves.toBeDefined();
    await expect(harness.service.createStorage(structure, { name: "Overflow" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(scalar(harness.database, "SELECT count(*) FROM storages"))
      .toBe(LIMITS.content.storageStructure.storages.max);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE entity_type = 'storage'"))
      .toBe(1);
  });

  it("accepts the maximum category and rejects max plus one without audit", async () => {
    const harness = createHarness();
    const insert = harness.database.prepare(
      "INSERT INTO storage_categories (id, storage_id, name, created_at) VALUES (?, 'storage-1', ?, ?)",
    );
    for (let index = 2; index < LIMITS.content.storageStructure.categories.max; index += 1) {
      insert.run(`category-${index}`, `Category ${index}`, NOW);
    }
    const structure = context(ADMIN_ID, ["admin.storage.structure"]);
    await expect(harness.service.createCategory(structure, "storage-1", { name: "Last" })).resolves.toBeDefined();
    await expect(harness.service.createCategory(structure, "storage-1", { name: "Overflow" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(scalar(harness.database, "SELECT count(*) FROM storage_categories"))
      .toBe(LIMITS.content.storageStructure.categories.max);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE entity_type = 'storage_category'"))
      .toBe(1);
  });

  it("rechecks the storage cap inside the write transaction after a competing insert", async () => {
    const harness = createHarness();
    const insert = harness.database.prepare(
      "INSERT INTO storages (id, name, description, created_at) VALUES (?, ?, NULL, ?)",
    );
    for (let index = 2; index < LIMITS.content.storageStructure.storages.max; index += 1) {
      insert.run(`storage-${index}`, `Storage ${index}`, NOW);
    }
    harness.executor.beforeNextBatch = () => {
      insert.run("storage-race", "Race", NOW);
    };
    await expect(harness.service.createStorage(
      context(ADMIN_ID, ["admin.storage.structure"]),
      { name: "Blocked" },
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(scalar(harness.database, "SELECT count(*) FROM storages"))
      .toBe(LIMITS.content.storageStructure.storages.max);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE entity_type = 'storage'"))
      .toBe(0);
  });

  it("rolls the storage insert back when the audit write fails", async () => {
    const harness = createHarness();
    harness.database.exec("CREATE TRIGGER reject_structure_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit rejected'); END;");
    const admin = context(ADMIN_ID, ["admin.storage.structure"]);
    await expect(harness.store.createStorage({
      storage: {
        id: "storage-rejected", name: "Rejected", description: null, created_at: NOW, categories: [],
      },
      audit: createAuditMutation(admin, {
        entityType: "storage", entityId: "storage-rejected", action: "create",
      }),
    })).rejects.toThrow(/audit rejected/);
    expect(scalar(harness.database, "SELECT count(*) FROM storages WHERE id = 'storage-rejected'"))
      .toBe(0);
  });

  it("fails explicitly when persisted storages exceed the tree invariant", async () => {
    const harness = createHarness();
    const insert = harness.database.prepare(
      "INSERT INTO storages (id, name, description, created_at) VALUES (?, ?, NULL, ?)",
    );
    for (let index = 2; index <= LIMITS.content.storageStructure.storages.max + 1; index += 1) {
      insert.run(`storage-${index}`, `Storage ${index}`, NOW);
    }
    await expect(harness.store.getTree()).rejects.toMatchObject({ code: "SERVER_ERROR", status: 500 });
  });

  it("fails explicitly when persisted categories exceed the tree invariant", async () => {
    const harness = createHarness();
    const insert = harness.database.prepare(
      "INSERT INTO storage_categories (id, storage_id, name, created_at) VALUES (?, 'storage-1', ?, ?)",
    );
    for (let index = 2; index <= LIMITS.content.storageStructure.categories.max + 1; index += 1) {
      insert.run(`category-${index}`, `Category ${index}`, NOW);
    }
    await expect(harness.store.getTree()).rejects.toMatchObject({ code: "SERVER_ERROR", status: 500 });
  });
});

describe("storage ledger and balances", () => {
  it("uses the same submission path for finite decimal deposits and withdrawals", async () => {
    const harness = createHarness();
    const member = context(MEMBER_ID);

    const deposit = await harness.service.createTransaction(member, "item-open", {
      type: "intake",
      quantity: 2.5,
      recipient_user_id: MEMBER_ID,
    });
    const withdrawal = await harness.service.createTransaction(member, "item-open", {
      type: "distribute",
      quantity: 0.75,
      recipient_user_id: MEMBER_ID,
    });

    expect(deposit.quantity_delta).toBe(2.5);
    expect(withdrawal.quantity_delta).toBe(-0.75);
    expect(harness.published).toHaveLength(2);
    expect(harness.published[1]).toMatchObject({
      type: "entity_changed",
      entity_type: "storage",
      hint: "storage_updated",
    });
    expect(await quantity(harness, "item-open")).toBe(1.75);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_ledger_entries")).toBe(2);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log")).toBe(2);
  });

  it("rolls back the whole SQL batch, including audit and prior item deltas, when one withdrawal goes negative", async () => {
    const harness = createHarness();
    const admin = context(ADMIN_ID, ["admin.storage.stock"]);
    await harness.service.createBatchTransaction(admin, {
      idempotency_key: "initial-stock-0001",
      type: "intake",
      entries: [
        { item_id: "item-open", quantity: 2 },
        { item_id: "item-admin", quantity: 1 },
      ],
    });
    const audit = createAuditMutation(admin, {
      entityType: "storage_transaction",
      entityId: "failing-batch",
      action: "distribute",
    });
    const commit: StockCommit = {
      batchId: "failing-batch",
      actorId: ADMIN_ID,
      idempotencyKey: "failing-stock-001",
      accessMode: "stock_admin",
      request: {
        type: "distribute",
        recipientUserId: MEMBER_ID,
        note: null,
        entries: [
          { itemId: "item-open", quantity: 1 },
          { itemId: "item-admin", quantity: 2 },
        ],
      },
      targetQuantity: null,
      createdAt: NOW,
      transactions: [
        transaction("tx-ok", "item-open", "Open potion", -1, ADMIN_ID, MEMBER_ID),
        transaction("tx-negative", "item-admin", "Admin stock", -2, ADMIN_ID, MEMBER_ID),
      ],
      audit,
    };

    await expect(harness.store.commitStock(commit)).rejects.toMatchObject({
      code: "negative_balance",
    });
    expect(await quantity(harness, "item-open")).toBe(2);
    expect(await quantity(harness, "item-admin")).toBe(1);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_batches WHERE id = 'failing-batch'")).toBe(0);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log")).toBe(1);
  });

  it("makes batch retries idempotent and rejects key reuse with a different request", async () => {
    const harness = createHarness();
    const admin = context(ADMIN_ID, ["admin.storage.stock"]);
    const payload = {
      idempotency_key: "retryable-stock-01",
      type: "intake" as const,
      entries: [
        { item_id: "item-admin", quantity: 1.25 },
        { item_id: "item-open", quantity: 2.5 },
      ],
      recipient_user_id: MEMBER_ID,
    };

    const first = await harness.service.createBatchTransaction(admin, payload);
    const replay = await harness.service.createBatchTransaction(admin, payload);

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ data: first.data, replayed: true });
    expect(scalar(harness.database, "SELECT count(*) FROM storage_ledger_entries")).toBe(2);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log")).toBe(1);
    await expect(harness.service.createBatchTransaction(admin, {
      ...payload,
      entries: [{ item_id: "item-admin", quantity: 9 }],
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("serializes competing withdrawals so exactly one succeeds", async () => {
    const harness = createHarness();
    const admin = context(ADMIN_ID, ["admin.storage.stock"]);
    await harness.service.createTransaction(admin, "item-admin", {
      type: "intake",
      quantity: 1,
      recipient_user_id: MEMBER_ID,
    });

    const outcomes = await Promise.allSettled([
      harness.service.createTransaction(admin, "item-admin", {
        type: "distribute",
        quantity: 1,
        recipient_user_id: MEMBER_ID,
      }),
      harness.service.createTransaction(admin, "item-admin", {
        type: "distribute",
        quantity: 1,
        recipient_user_id: MEMBER_ID,
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(await quantity(harness, "item-admin")).toBe(0);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_ledger_entries")).toBe(2);
  });

  it("sets an adjustment target from the balance inside the atomic commit", async () => {
    const harness = createHarness();
    const admin = context(ADMIN_ID, ["admin.storage.stock"]);
    await harness.service.createTransaction(admin, "item-admin", {
      type: "intake",
      quantity: 10,
      recipient_user_id: MEMBER_ID,
    });
    harness.executor.beforeNextBatch = async () => {
      await harness.service.createTransaction(admin, "item-admin", {
        type: "intake",
        quantity: 5,
        recipient_user_id: MEMBER_ID,
      });
    };

    const adjusted = await harness.service.createTransaction(admin, "item-admin", {
      type: "adjust",
      target_quantity: 12,
    });

    expect(adjusted.quantity_delta).toBe(-3);
    expect(await quantity(harness, "item-admin")).toBe(12);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_ledger_entries WHERE item_id = 'item-admin'")).toBe(3);
  });

  it("rejects a non-zero delta that cannot change an extreme REAL balance", async () => {
    const harness = createHarness();
    harness.database.prepare("UPDATE storage_balances SET quantity = ? WHERE item_id = ?")
      .run(1e20, "item-admin");
    const admin = context(ADMIN_ID, ["admin.storage.stock"]);
    const audit = createAuditMutation(admin, {
      entityType: "storage_transaction",
      entityId: "precision-batch",
      action: "intake",
    });
    const commit: StockCommit = {
      batchId: "precision-batch",
      actorId: ADMIN_ID,
      idempotencyKey: "precision-delta-0001",
      accessMode: "stock_admin",
      request: {
        type: "intake",
        recipientUserId: MEMBER_ID,
        note: null,
        entries: [{ itemId: "item-admin", quantity: 1 }],
      },
      targetQuantity: null,
      createdAt: NOW,
      transactions: [transaction("precision-tx", "item-admin", "Admin stock", 1, ADMIN_ID, MEMBER_ID)],
      audit,
    };

    await expect(harness.store.commitStock(commit)).rejects.toMatchObject({ code: "ineffective_delta" });
    expect(await quantity(harness, "item-admin")).toBe(1e20);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_batches WHERE id = 'precision-batch'")).toBe(0);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_ledger_entries WHERE id = 'precision-tx'")).toBe(0);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE entity_id = 'precision-batch'")).toBe(0);
  });

  it("keeps the ledger immutable at the database boundary", async () => {
    const harness = createHarness();
    await harness.service.createTransaction(context(MEMBER_ID), "item-open", {
      type: "intake",
      quantity: 1,
      recipient_user_id: MEMBER_ID,
    });
    expect(() => harness.database.exec("UPDATE storage_ledger_entries SET quantity_delta = 2"))
      .toThrow(/storage_ledger_immutable/);
    expect(() => harness.database.exec("DELETE FROM storage_ledger_entries"))
      .toThrow(/storage_ledger_immutable/);
  });
});

describe("storage authorization and row visibility", () => {
  it("does not report a category update after a competing delete", async () => {
    const harness = createHarness();
    harness.database.prepare("INSERT INTO storage_categories (id, storage_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run("category-race", "storage-1", "Before", NOW);
    const auditCount = scalar(harness.database, "SELECT count(*) FROM audit_log");
    harness.executor.beforeNextBatch = () => {
      harness.database.prepare("DELETE FROM storage_categories WHERE id = ?").run("category-race");
    };

    await expect(harness.service.updateCategory(
      context(ADMIN_ID, ["admin.storage.structure"]),
      "storage-1",
      "category-race",
      { name: "After" },
    )).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log")).toBe(auditCount);
  });

  it("enforces separate structure, item, and stock permissions", async () => {
    const harness = createHarness();
    const structure = context(ADMIN_ID, ["admin.storage.structure"]);
    const items = context(ADMIN_ID, ["admin.storage.items"]);
    const stock = context(ADMIN_ID, ["admin.storage.stock"]);

    await expect(harness.service.createStorage(structure, { name: "Second" })).resolves.toBeDefined();
    await expect(harness.service.createItem(structure, {
      storage_id: "storage-1",
      name: "Blocked",
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(harness.service.updateItem(items, "item-admin", { name: "Renamed" })).resolves.toBeDefined();
    await expect(harness.service.deleteStorage(items, "storage-1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(harness.service.createTransaction(stock, "item-admin", {
      type: "intake",
      quantity: 1,
      recipient_user_id: OTHER_ID,
    })).resolves.toMatchObject({ recipient_user_id: OTHER_ID });
    await expect(harness.service.updateItem(stock, "item-admin", { name: "No" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("forces ordinary recipients to self and checks the current item self-service flag", async () => {
    const harness = createHarness();
    const member = context(MEMBER_ID);

    await expect(harness.service.createTransaction(member, "item-open", {
      type: "intake",
      quantity: 1,
      recipient_user_id: OTHER_ID,
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(harness.service.createTransaction(member, "item-admin", {
      type: "intake",
      quantity: 1,
      recipient_user_id: MEMBER_ID,
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    const own = await harness.service.createTransaction(member, "item-open", {
      type: "intake",
      quantity: 1,
      recipient_user_id: null,
    });
    expect(own.recipient_user_id).toBe(MEMBER_ID);
  });

  it("applies actor-or-recipient scope in SQL and rejects another recipient filter", async () => {
    const harness = createHarness();
    const actingManager = context(MEMBER_ID, ["admin.storage.stock"]);
    const unrelated = context(OTHER_ID);
    await harness.service.createTransaction(actingManager, "item-admin", {
      type: "intake",
      quantity: 1,
      recipient_user_id: OTHER_ID,
    });
    await harness.service.createTransaction(unrelated, "item-open", {
      type: "intake",
      quantity: 2,
      recipient_user_id: OTHER_ID,
    });

    const visible = await harness.service.listTransactions(context(MEMBER_ID), { page: 1, limit: 50 });
    expect(visible.data).toHaveLength(1);
    expect(visible.data[0]).toMatchObject({ actor_id: MEMBER_ID, recipient_user_id: OTHER_ID });
    await expect(harness.service.listTransactions(context(MEMBER_ID), {
      recipient_user_id: OTHER_ID,
      page: 1,
      limit: 50,
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    const statement = harness.executor.batches.at(-1)?.[1]?.sql ?? "";
    expect(statement).toContain("ledger.actor_id = ?");
    expect(statement).toContain("ledger.recipient_user_id = ?");
  });
});

describe("storage media lifecycle", () => {
  it("links unified media uploads and marks assets deleting in the item-delete batch", async () => {
    const harness = createHarness();
    const mediaId = "storage-image-0000001";
    const uploader: ConstructorParameters<typeof SqliteStorageMediaPort>[1] = {
      uploadImages: async (
        _context: RequestContext,
        purpose,
        uploads,
        maxBytes: number,
      ): Promise<readonly string[]> => {
        expect(purpose).toBe("storage_image");
        expect(uploads).toHaveLength(1);
        expect(maxBytes).toBe(4_000_000);
        harness.database.prepare(`INSERT INTO media_assets (
          id, owner_user_id, purpose, media_type, state, original_name,
          expires_at, delete_claim_token, delete_claim_until, created_at, updated_at
        ) VALUES (?, ?, 'storage_image', 'image', 'staged', NULL, ?, NULL, NULL, ?, ?)`)
          .run(mediaId, ADMIN_ID, "2026-08-10T12:00:00.000Z", NOW, NOW);
        return [mediaId];
      },
    };
    const media = new SqliteStorageMediaPort(harness.executor, uploader, async () => ({
      maxImageBytes: 4_000_000,
      maxImagesPerItem: 4,
    }));
    let sequence = 0;
    const service = new StorageService(
      harness.store,
      media,
      notifications,
      deferred,
      () => `media-operation-${++sequence}`,
    );
    const admin = context(ADMIN_ID, ["admin.storage.items"]);

    await service.uploadImages(admin, "item-admin", [{ full: new Uint8Array(), view: new Uint8Array() }]);
    expect(scalar(harness.database, "SELECT count(*) FROM media_links WHERE media_id = ?", mediaId)).toBe(1);
    expect(harness.database.prepare("SELECT state FROM media_assets WHERE id = ?").get(mediaId))
      .toMatchObject({ state: "attached" });

    await service.deleteItem(admin, "item-admin");

    expect(scalar(harness.database, "SELECT count(*) FROM media_links WHERE media_id = ?", mediaId)).toBe(0);
    expect(harness.database.prepare("SELECT state FROM media_assets WHERE id = ?").get(mediaId))
      .toMatchObject({ state: "deleting" });
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log")).toBe(2);
  });
});

describe("storage performance contracts", () => {
  it("uses keyset item pagination and composite ledger indexes", async () => {
    const harness = createHarness();
    await harness.service.listItems(context(MEMBER_ID), {
      storage_id: "storage-1",
      stock: "all",
      limit: 24,
    });
    const itemStatement = harness.executor.executions.find((statement) => statement.sql.includes("FROM storage_items AS item"));
    expect(itemStatement).toBeDefined();
    const itemPlan = explain(harness.database, itemStatement!);
    expect(itemPlan).toContain("idx_storage_items_storage_name_id");

    await harness.service.listTransactions(context(MEMBER_ID), { page: 1, limit: 50 });
    const ledgerStatement = harness.executor.batches.at(-1)?.[1];
    expect(ledgerStatement).toBeDefined();
    const ledgerPlan = explain(harness.database, ledgerStatement!);
    expect(ledgerPlan).toContain("idx_storage_ledger_actor_created_id");
    expect(ledgerPlan).toContain("idx_storage_ledger_recipient_created_id");
  });

  it("accepts twenty entries with one preflight query and one atomic SQL batch, then rejects twenty-one", async () => {
    const harness = createHarness();
    const insert = harness.database.prepare(`INSERT INTO storage_items (
      id, storage_id, category_id, name, description,
      allow_member_deposit, allow_member_withdraw, created_at, updated_at
    ) VALUES (?, 'storage-1', 'category-1', ?, NULL, 0, 0, ?, ?)`);
    for (let index = 0; index < 20; index += 1) insert.run(`bulk-${index}`, `Bulk ${index}`, NOW, NOW);
    const admin = context(ADMIN_ID, ["admin.storage.stock"]);
    const beforeExecutions = harness.executor.executions.length;
    const beforeBatches = harness.executor.batches.length;

    await harness.service.createBatchTransaction(admin, {
      idempotency_key: "twenty-entry-batch",
      type: "intake",
      entries: Array.from({ length: 20 }, (_, index) => ({ item_id: `bulk-${index}`, quantity: 0.5 })),
    });

    const newExecutions = harness.executor.executions.slice(beforeExecutions);
    const newBatches = harness.executor.batches.slice(beforeBatches);
    expect(newExecutions.filter((statement) => statement.sql.includes("WITH requested"))).toHaveLength(1);
    expect(newBatches).toHaveLength(1);
    expect(newBatches[0]).toHaveLength(22);
    const callsBeforeRejected = harness.executor.executions.length + harness.executor.batches.length;
    await expect(harness.service.createBatchTransaction(admin, {
      idempotency_key: "twenty-one-items",
      type: "intake",
      entries: Array.from({ length: 21 }, (_, index) => ({ item_id: `bulk-${index}`, quantity: 1 })),
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(harness.executor.executions.length + harness.executor.batches.length).toBe(callsBeforeRejected);
  });
});

function transaction(
  id: string,
  itemId: string,
  itemName: string,
  quantityDelta: number,
  actorId: string,
  recipientUserId: string,
) {
  return {
    id,
    item_id: itemId,
    item_name: itemName,
    type: quantityDelta > 0 ? "intake" as const : "distribute" as const,
    quantity_delta: quantityDelta,
    recipient_user_id: recipientUserId,
    recipient_username: "member",
    note: null,
    actor_id: actorId,
    actor_username: "admin",
    created_at: NOW,
  };
}

function explain(database: DatabaseSync, statement: SqlStatement): string {
  const prepared = database.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`);
  const rows = prepared.all(...([...(statement.params ?? [])] as SQLInputValue[])) as Array<{ detail: string }>;
  return rows.map((row) => row.detail).join("\n");
}
