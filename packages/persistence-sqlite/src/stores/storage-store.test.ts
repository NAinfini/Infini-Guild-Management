import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createAppDatabase } from "../database.js";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlStatement } from "@guild/kernel";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import {
  StorageService,
  type StorageMediaPort,
  type StockCommit,
} from "@guild/server/modules/storage";
import { createAuditEvent } from "@guild/server/modules/audit";
import { createAuthorizationContext, createRequestContext, type RequestContext } from "@guild/kernel";
import { LIMITS } from "@guild/shared/config/limits";
import { auditPayloadV2Schema } from "@guild/shared";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteStorageMediaPort, SqliteStorageStore } from "./storage-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const MEMBER_ID = "member-1";
const OTHER_ID = "member-2";
const ADMIN_ID = "admin-1";


class FakeMedia implements StorageMediaPort {
  readonly byItem = new Map<string, string[]>();

  async listItemMediaIds(itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    return new Map(itemIds.map((id) => [id, this.byItem.get(id) ?? []]));
  }

  async attachItemImages(input: Parameters<StorageMediaPort["attachItemImages"]>[0]) {
    const ids = input.uploads.map((_, index) => `${String(index).padStart(20, "a")}b`);
    this.byItem.set(input.itemId, [...(this.byItem.get(input.itemId) ?? []), ...ids]);
    return { status: "updated" as const, mediaIds: ids, updatedAt: input.updatedAt };
  }

  async detachItemImage(input: Parameters<StorageMediaPort["detachItemImage"]>[0]) {
    const current = this.byItem.get(input.itemId) ?? [];
    if (!current.includes(input.mediaId)) return { status: "image_not_found" as const };
    this.byItem.set(input.itemId, current.filter((id) => id !== input.mediaId));
    return { status: "updated" as const, mediaIds: [], updatedAt: input.updatedAt };
  }
}

class RejectAfterItemCommitMedia extends FakeMedia {
  database: DatabaseSync | undefined;

  override async listItemMediaIds(itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    const updatedAt = this.database?.prepare("SELECT updated_at FROM storage_items WHERE id = 'item-admin'").get() as
      | { updated_at: string }
      | undefined;
    if (updatedAt?.updated_at !== NOW) {
      throw new Error("post-commit item media read failed");
    }
    return super.listItemMediaIds(itemIds);
  }
}

class RejectSnapshotExecutor implements SqlExecutor {
  constructor(
    private readonly delegate: SqliteTestExecutor,
    private readonly rejects: (statement: SqlBatchStatement) => boolean,
  ) {}

  async execute(statement: SqlStatement): Promise<SqlResult> {
    return this.delegate.execute(statement);
  }

  async batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    return this.delegate.batch(statements.map((statement): SqlBatchStatement => this.rejects(statement)
      ? {
          method: "all",
          columns: ["snapshot_failure"],
          sql: "SELECT missing_storage_snapshot_column",
          params: [],
        }
      : statement));
  }
}

type Harness = ReturnType<typeof createHarness>;
const databases: DatabaseSync[] = [];
const notifications = { publish: async () => undefined };
const deferred = { defer: (task: () => void | Promise<void>) => { void task(); } };

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createHarness(media: StorageMediaPort = new FakeMedia()) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  applyAppMigrations(database);
  const executor = new SqliteTestExecutor(database);
  const store = new SqliteStorageStore(createAppDatabase(executor), executor);
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
  const insertUser = database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token)
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

function context(
  userId: string,
  permissions: readonly string[] = [],
  requestId: string = crypto.randomUUID(),
  now = NOW,
): RequestContext {
  return createRequestContext({
    requestId,
    authorization: createAuthorizationContext({
      userId,
      sessionId: `session-${userId}`,
      roleId: permissions.length > 0 ? "admin" : "member",
      roleLevel: permissions.length > 0 ? 10 : 100,
      permissions,
    }),
    now,
  });
}

async function quantity(harness: Harness, itemId: string): Promise<number> {
  return (await harness.store.getItem(itemId))!.quantity;
}

function scalar(database: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
  const row = database.prepare(sql).get(...params) as Record<string, number>;
  return Number(Object.values(row)[0]);
}

function insertStagedStorageImage(database: DatabaseSync, mediaId: string): void {
  database.prepare(`INSERT INTO media_assets (
    id, owner_user_id, purpose, media_type, state, original_name,
    expires_at, delete_claim_token, delete_claim_until, created_at, updated_at
  ) VALUES (?, ?, 'storage_image', 'image', 'staged', NULL, ?, NULL, NULL, ?, ?)`).run(
    mediaId,
    ADMIN_ID,
    "2026-08-10T12:00:00.000Z",
    NOW,
    NOW,
  );
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
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE subject_type = 'storage'"))
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
    await expect(harness.service.createCategory(structure, "storage-1", {
      name: "Last",
      expected_structure_revision: 0,
    })).resolves.toBeDefined();
    await expect(harness.service.createCategory(structure, "storage-1", {
      name: "Overflow",
      expected_structure_revision: 1,
    }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(scalar(harness.database, "SELECT count(*) FROM storage_categories"))
      .toBe(LIMITS.content.storageStructure.categories.max);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE subject_type = 'storage_category'"))
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
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE subject_type = 'storage'"))
      .toBe(0);
  });

  it("rolls the storage insert back when the audit write fails", async () => {
    const harness = createHarness();
    harness.database.exec("CREATE TRIGGER reject_structure_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit rejected'); END;");
    const admin = context(ADMIN_ID, ["admin.storage.structure"]);
    await expect(harness.store.createStorage({
      storage: {
        id: "storage-rejected", name: "Rejected", description: null, created_at: NOW, structure_revision: 0, categories: [],
      },
      audit: createAuditEvent(admin, {
        subjectType: "storage", subjectId: "storage-rejected", action: "create",
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
      idempotency_key: "single-decimal-001",
      type: "intake",
      quantity: 2.5,
      recipient_user_id: MEMBER_ID,
    });
    const withdrawal = await harness.service.createTransaction(member, "item-open", {
      idempotency_key: "single-decimal-002",
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
    const auditRow = harness.database.prepare(`SELECT payload_json
      FROM audit_log WHERE action = 'distribute'`).get() as { payload_json: string };
    expect(auditPayloadV2Schema.parse(JSON.parse(auditRow.payload_json)).context).toEqual([
      { field: "transaction_count", value: { type: "number", value: 1 } },
      { field: "type", value: { type: "code", value: "distribute" } },
      {
        field: "item_ids",
        value: {
          type: "list",
          value: [{ type: "reference", value: { id: "item-open", label: "Open potion" } }],
        },
      },
      { field: "quantity", value: { type: "list", value: [{ type: "number", value: -0.75 }] } },
      {
        field: "user_ids",
        value: {
          type: "list",
          value: [{ type: "reference", value: { id: MEMBER_ID, label: "member" } }],
        },
      },
    ]);
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
    const audit = createAuditEvent(admin, {
      subjectType: "storage_transaction",
      subjectId: "failing-batch",
      action: "distribute",
    });
    const commit: StockCommit = {
      batchId: "failing-batch",
      actorId: ADMIN_ID,
      idempotencyKey: "failing-stock-001",
      requestFingerprint: "a".repeat(64),
      accessMode: "stock_admin",
      request: {
        type: "distribute",
        recipientUserId: MEMBER_ID,
        note: null,
        targetQuantity: null,
        entries: [
          { itemId: "item-open", quantity: 1 },
          { itemId: "item-admin", quantity: 2 },
        ],
      },
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

  it("makes single retries idempotent and binds an adjustment key to its target", async () => {
    const harness = createHarness();
    const admin = context(ADMIN_ID, ["admin.storage.stock"]);
    const intake = {
      idempotency_key: "single-retry-intake-01",
      type: "intake" as const,
      quantity: 2,
      recipient_user_id: MEMBER_ID,
    };

    const first = await harness.service.createTransaction(admin, "item-admin", intake);
    const replay = await harness.service.createTransaction(admin, "item-admin", intake);

    expect(replay).toEqual(first);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_ledger_entries")).toBe(1);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log")).toBe(1);
    await expect(harness.service.createTransaction(admin, "item-admin", {
      ...intake,
      quantity: 3,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    const adjustment = {
      idempotency_key: "single-retry-adjust-01",
      type: "adjust" as const,
      target_quantity: 5,
    };
    const adjusted = await harness.service.createTransaction(admin, "item-admin", adjustment);
    const adjustmentReplay = await harness.service.createTransaction(admin, "item-admin", adjustment);

    expect(adjustmentReplay).toEqual(adjusted);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_ledger_entries")).toBe(2);
    await expect(harness.service.createTransaction(admin, "item-admin", {
      ...adjustment,
      target_quantity: 6,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("replays a concurrent single submission after the unique-key race", async () => {
    const harness = createHarness();
    const admin = context(ADMIN_ID, ["admin.storage.stock"]);
    const payload = {
      idempotency_key: "single-race-replay-01",
      type: "intake" as const,
      quantity: 2,
      recipient_user_id: MEMBER_ID,
    };
    let competing: Awaited<ReturnType<typeof harness.service.createTransaction>> | null = null;
    harness.executor.beforeNextBatch = async () => {
      competing = await harness.service.createTransaction(admin, "item-admin", payload);
    };

    const replayed = await harness.service.createTransaction(admin, "item-admin", payload);

    expect(replayed).toEqual(competing);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_ledger_entries")).toBe(1);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log")).toBe(1);
  });

  it("serializes competing withdrawals so exactly one succeeds", async () => {
    const harness = createHarness();
    const admin = context(ADMIN_ID, ["admin.storage.stock"]);
    await harness.service.createTransaction(admin, "item-admin", {
      idempotency_key: "concurrency-seed-01",
      type: "intake",
      quantity: 1,
      recipient_user_id: MEMBER_ID,
    });

    const outcomes = await Promise.allSettled([
      harness.service.createTransaction(admin, "item-admin", {
        idempotency_key: "concurrency-draw-01",
        type: "distribute",
        quantity: 1,
        recipient_user_id: MEMBER_ID,
      }),
      harness.service.createTransaction(admin, "item-admin", {
        idempotency_key: "concurrency-draw-02",
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
      idempotency_key: "adjust-seed-stock-01",
      type: "intake",
      quantity: 10,
      recipient_user_id: MEMBER_ID,
    });
    harness.executor.beforeNextBatch = async () => {
      await harness.service.createTransaction(admin, "item-admin", {
        idempotency_key: "adjust-race-stock-01",
        type: "intake",
        quantity: 5,
        recipient_user_id: MEMBER_ID,
      });
    };

    const adjusted = await harness.service.createTransaction(admin, "item-admin", {
      idempotency_key: "adjust-target-stock-01",
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
    const audit = createAuditEvent(admin, {
      subjectType: "storage_transaction",
      subjectId: "precision-batch",
      action: "intake",
    });
    const commit: StockCommit = {
      batchId: "precision-batch",
      actorId: ADMIN_ID,
      idempotencyKey: "precision-delta-0001",
      requestFingerprint: "b".repeat(64),
      accessMode: "stock_admin",
      request: {
        type: "intake",
        recipientUserId: MEMBER_ID,
        note: null,
        targetQuantity: null,
        entries: [{ itemId: "item-admin", quantity: 1 }],
      },
      createdAt: NOW,
      transactions: [transaction("precision-tx", "item-admin", "Admin stock", 1, ADMIN_ID, MEMBER_ID)],
      audit,
    };

    await expect(harness.store.commitStock(commit)).rejects.toMatchObject({ code: "ineffective_delta" });
    expect(await quantity(harness, "item-admin")).toBe(1e20);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_batches WHERE id = 'precision-batch'")).toBe(0);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_ledger_entries WHERE id = 'precision-tx'")).toBe(0);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'precision-batch'")).toBe(0);
  });

  it("keeps the ledger immutable at the database boundary", async () => {
    const harness = createHarness();
    await harness.service.createTransaction(context(MEMBER_ID), "item-open", {
      idempotency_key: "immutable-ledger-01",
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
  it("rolls the item metadata and audit back when its in-batch snapshot fails", async () => {
    const harness = createHarness();
    const failingExecutor = new RejectSnapshotExecutor(
      harness.executor,
      (statement) => statement.columns?.includes("quantity") === true
        && statement.sql.includes("FROM storage_items AS item"),
    );
    const store = new SqliteStorageStore(createAppDatabase(failingExecutor), failingExecutor);
    const admin = context(ADMIN_ID, ["admin.storage.items"], "storage-snapshot-failure");

    await expect(store.updateItem({
      id: "item-admin",
      patch: { name: "Should roll back" },
      expectedUpdatedAt: NOW,
      updatedAt: "2026-08-09T12:00:00.001Z",
      audit: createAuditEvent(admin, {
        subjectType: "storage_item",
        subjectId: "item-admin",
        subjectLabel: "Admin stock",
        action: "update",
      }),
    })).rejects.toMatchObject({ code: "constraint" });

    expect(harness.database.prepare("SELECT name, updated_at FROM storage_items WHERE id = 'item-admin'").get())
      .toEqual({ name: "Admin stock", updated_at: NOW });
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE subject_id = 'item-admin'")).toBe(0);
  });

  it("uses the pre-commit image snapshot when an item update commits", async () => {
    const media = new RejectAfterItemCommitMedia();
    const harness = createHarness(media);
    media.database = harness.database;
    const admin = context(ADMIN_ID, ["admin.storage.items"]);

    await expect(harness.service.updateItem(admin, "item-admin", {
      name: "Updated stock",
      expected_updated_at: NOW,
    })).resolves.toMatchObject({ id: "item-admin", name: "Updated stock", images: [] });
  });

  it("round-trips item rarity and unit through list/detail reads and audit changes", async () => {
    const harness = createHarness();
    const admin = context(ADMIN_ID, ["admin.storage.items"]);

    const created = await harness.service.createItem(admin, {
      storage_id: "storage-1",
      name: "Rare crate",
      rarity: "rare",
      unit: "box",
      allow_member_deposit: false,
      allow_member_withdraw: false,
    });
    expect(created).toMatchObject({ rarity: "rare", unit: "box" });
    await expect(harness.service.listItems(admin, {
      storage_id: "storage-1",
      stock: "all",
      limit: 24,
    })).resolves.toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ id: created.id, rarity: "rare", unit: "box" }),
      ]),
    });

    const updated = await harness.service.updateItem(admin, created.id, {
      rarity: "epic",
      unit: null,
      expected_updated_at: created.updated_at,
    });
    expect(updated).toMatchObject({ rarity: "epic", unit: null });
    await expect(harness.service.getItem(admin, created.id))
      .resolves.toMatchObject({ rarity: "epic", unit: null });

    const auditRows = harness.database.prepare(`SELECT action, payload_json
      FROM audit_log WHERE subject_id = ?`).all(created.id) as Array<{
        action: string;
        payload_json: string;
      }>;
    expect(auditRows).toHaveLength(2);
    const createAudit = auditRows.find(({ action }) => action === "create");
    const updateAudit = auditRows.find(({ action }) => action === "update");
    expect(createAudit).toBeDefined();
    expect(updateAudit).toBeDefined();
    expect(auditPayloadV2Schema.parse(JSON.parse(createAudit!.payload_json)).context).toEqual([
      { field: "storage_id", value: { type: "reference", value: { id: "storage-1", label: "Guild Vault" } } },
      { field: "rarity", value: { type: "text", value: "rare" } },
      { field: "unit", value: { type: "text", value: "box" } },
    ]);
    expect(auditPayloadV2Schema.parse(JSON.parse(updateAudit!.payload_json)).changes).toEqual([
      { field: "rarity", before: { type: "text", value: "rare" }, after: { type: "text", value: "epic" } },
      { field: "unit", before: { type: "text", value: "box" }, after: { type: "null", value: null } },
    ]);
  });

  it("normalizes structure no-ops before persistence or notification", async () => {
    const harness = createHarness();
    const admin = context(ADMIN_ID, ["admin.storage.structure"]);

    await expect(harness.service.updateStorage(admin, "storage-1", {
      name: "  Guild Vault  ", description: null,
      expected_name: "Guild Vault", expected_description: null,
      expected_structure_revision: 0,
    })).resolves.toMatchObject({ name: "Guild Vault", description: null });
    await expect(harness.service.updateCategory(admin, "storage-1", "category-1", {
      name: "  Supplies  ", expected_name: "Supplies",
      expected_structure_revision: 0,
    })).resolves.toEqual({ category: { id: "category-1", name: "Supplies" }, structure_revision: 0 });

    expect(harness.executor.batches).toHaveLength(0);
    expect(harness.published).toHaveLength(0);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });

  it("guards storage and category audit rows with null-safe database differences", async () => {
    const harness = createHarness();
    const admin = context(ADMIN_ID, ["admin.storage.structure"]);

    await harness.store.updateStorage({
      id: "storage-1", patch: { name: "Guild Vault", description: null },
      expected: { name: "Guild Vault", description: null, structureRevision: 0 },
      audit: createAuditEvent(admin, {
        subjectType: "storage", subjectId: "storage-1", subjectLabel: "Guild Vault", action: "update", context: [],
      }),
    });
    await harness.store.updateCategory({
      storageId: "storage-1", categoryId: "category-1", name: "Supplies", expectedName: "Supplies", expectedStructureRevision: 0,
      audit: createAuditEvent(admin, {
        subjectType: "storage_category", subjectId: "category-1", subjectLabel: "Supplies", action: "update", context: [],
      }),
    });
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log")).toBe(0);

    await expect(harness.service.updateStorage(admin, "storage-1", {
      description: "Shared supplies", expected_name: "Guild Vault", expected_description: null,
      expected_structure_revision: 0,
    }))
      .resolves.toMatchObject({ description: "Shared supplies" });
    await expect(harness.service.updateCategory(admin, "storage-1", "category-1", {
      name: "Consumables", expected_name: "Supplies",
      expected_structure_revision: 1,
    }))
      .resolves.toEqual({ category: { id: "category-1", name: "Consumables" }, structure_revision: 2 });
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log")).toBe(2);
    expect(harness.database.prepare("SELECT json_array_length(payload_json, '$.changes') AS count FROM audit_log ORDER BY occurred_at, id").all())
      .toEqual([{ count: 1 }, { count: 1 }]);
  });

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
      { name: "After", expected_name: "Before", expected_structure_revision: 0 },
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
    await expect(harness.service.updateItem(items, "item-admin", {
      name: "Renamed", expected_updated_at: NOW,
    })).resolves.toBeDefined();
    await expect(harness.service.deleteStorage(items, "storage-1", { expected_structure_revision: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(harness.service.createTransaction(stock, "item-admin", {
      idempotency_key: "stock-permission-01",
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
      idempotency_key: "member-other-0001",
      type: "intake",
      quantity: 1,
      recipient_user_id: OTHER_ID,
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(harness.service.createTransaction(member, "item-admin", {
      idempotency_key: "member-blocked-001",
      type: "intake",
      quantity: 1,
      recipient_user_id: MEMBER_ID,
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    const own = await harness.service.createTransaction(member, "item-open", {
      idempotency_key: "member-own-stock-01",
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
    harness.database.prepare("INSERT INTO storages (id, name, description, created_at) VALUES (?, ?, NULL, ?)")
      .run("storage-2", "Secondary Vault", NOW);
    harness.database.prepare(`INSERT INTO storage_items (
      id, storage_id, category_id, name, description,
      allow_member_deposit, allow_member_withdraw, created_at, updated_at, rarity, unit
    ) VALUES (?, ?, NULL, ?, NULL, 1, 1, ?, ?, ?, ?)`)
      .run("item-other-storage", "storage-2", "Other vault potion", NOW, NOW, "common", null);
    await harness.service.createTransaction(actingManager, "item-admin", {
      idempotency_key: "scope-manager-stock-01",
      type: "intake",
      quantity: 1,
      recipient_user_id: OTHER_ID,
    });
    await harness.service.createTransaction(unrelated, "item-open", {
      idempotency_key: "scope-unrelated-001",
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

    await harness.service.createTransaction(actingManager, "item-other-storage", {
      idempotency_key: "scope-other-store-01",
      type: "intake",
      quantity: 3,
      recipient_user_id: OTHER_ID,
    });
    const storageScoped = await harness.service.listTransactions(actingManager, {
      storage_id: "storage-1",
      page: 1,
      limit: 50,
    });
    expect(storageScoped.data).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ item_id: "item-other-storage" }),
    ]));
  });

  it("rejects stale storage, category, and item editors without side effects", async () => {
    const harness = createHarness();
    const structureA = context(ADMIN_ID, ["admin.storage.structure"], "structure-a");
    const structureB = context(ADMIN_ID, ["admin.storage.structure"], "structure-b");
    const itemsA = context(
      ADMIN_ID,
      ["admin.storage.items"],
      "items-a",
      "2026-08-09T12:00:01.000Z",
    );
    const itemsB = context(
      ADMIN_ID,
      ["admin.storage.items"],
      "items-b",
      "2026-08-09T12:00:02.000Z",
    );

    await harness.service.updateStorage(structureA, "storage-1", {
      name: "Vault A",
      expected_name: "Guild Vault",
      expected_description: null,
      expected_structure_revision: 0,
    });
    await expect(harness.service.updateStorage(structureB, "storage-1", {
      description: "stale overwrite",
      expected_name: "Guild Vault",
      expected_description: null,
      expected_structure_revision: 0,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    await harness.service.updateCategory(structureA, "storage-1", "category-1", {
      name: "Supplies A",
      expected_name: "Supplies",
      expected_structure_revision: 1,
    });
    await expect(harness.service.updateCategory(structureB, "storage-1", "category-1", {
      name: "Supplies B",
      expected_name: "Supplies",
      expected_structure_revision: 1,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    const itemA = await harness.service.updateItem(itemsA, "item-admin", {
      rarity: "epic",
      expected_updated_at: NOW,
    });
    await expect(harness.service.updateItem(itemsB, "item-admin", {
      unit: "crate",
      expected_updated_at: NOW,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    await expect(harness.service.getTree(structureA)).resolves.toMatchObject({
      data: [expect.objectContaining({
        name: "Vault A",
        description: null,
        categories: [expect.objectContaining({ name: "Supplies A" })],
      })],
    });
    await expect(harness.service.getItem(itemsA, "item-admin")).resolves.toMatchObject({
      rarity: "epic",
      unit: null,
      updated_at: itemA.updated_at,
    });
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE action = 'update'")).toBe(3);
    expect(harness.published).toHaveLength(3);
  });

  it("rechecks editor baselines inside the atomic storage writes", async () => {
    const harness = createHarness();
    const structure = context(ADMIN_ID, ["admin.storage.structure"]);
    harness.executor.beforeNextBatch = () => {
      harness.database.prepare("UPDATE storages SET name = ? WHERE id = ?")
        .run("Competing vault", "storage-1");
    };

    await expect(harness.service.updateStorage(structure, "storage-1", {
      description: "must not land",
      expected_name: "Guild Vault",
      expected_description: null,
      expected_structure_revision: 0,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(harness.database.prepare("SELECT name, description FROM storages WHERE id = ?")
      .get("storage-1")).toEqual({ name: "Competing vault", description: null });
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log")).toBe(0);

    const item = await harness.store.getItem("item-admin");
    harness.executor.beforeNextBatch = () => {
      harness.database.prepare("UPDATE storage_items SET name = ?, updated_at = ? WHERE id = ?")
        .run("Competing item", "2026-08-09T12:00:05.000Z", "item-admin");
    };
    await expect(harness.service.updateItem(
      context(ADMIN_ID, ["admin.storage.items"], "item-race", "2026-08-09T12:00:06.000Z"),
      "item-admin",
      { rarity: "rare", expected_updated_at: item!.updated_at },
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(harness.store.getItem("item-admin")).resolves.toMatchObject({
      name: "Competing item",
      rarity: "common",
    });
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log")).toBe(0);
  });
});

describe("storage destructive aggregate revisions", () => {
  it("rejects a confirmed storage deletion when a category is added before the atomic write", async () => {
    const harness = createHarness();
    const structure = context(ADMIN_ID, ["admin.storage.structure"]);
    harness.database.prepare("INSERT INTO storages (id, name, description, created_at) VALUES (?, ?, NULL, ?)")
      .run("storage-confirm-race", "Confirmation race", NOW);
    harness.executor.beforeNextBatch = () => {
      harness.database.prepare("INSERT INTO storage_categories (id, storage_id, name, created_at) VALUES (?, ?, ?, ?)")
        .run("category-added-during-confirm", "storage-confirm-race", "Added during confirmation", NOW);
      harness.database.prepare("UPDATE storages SET structure_revision = structure_revision + 1 WHERE id = ?")
        .run("storage-confirm-race");
    };

    await expect(harness.service.deleteStorage(structure, "storage-confirm-race", {
      expected_structure_revision: 0,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(scalar(harness.database, "SELECT count(*) FROM storages WHERE id = ?", "storage-confirm-race")).toBe(1);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_categories WHERE id = ?", "category-added-during-confirm")).toBe(1);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE subject_id = ?", "storage-confirm-race")).toBe(0);
    expect(harness.published).toHaveLength(0);
  });

  it("rejects a confirmed category deletion when the category is renamed before the atomic write", async () => {
    const harness = createHarness();
    const structure = context(ADMIN_ID, ["admin.storage.structure"]);
    harness.database.prepare("INSERT INTO storage_categories (id, storage_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run("category-confirm-race", "storage-1", "Original", NOW);
    harness.executor.beforeNextBatch = () => {
      harness.database.prepare("UPDATE storage_categories SET name = ? WHERE id = ?")
        .run("Renamed remotely", "category-confirm-race");
      harness.database.prepare("UPDATE storages SET structure_revision = structure_revision + 1 WHERE id = ?")
        .run("storage-1");
    };

    await expect(harness.service.deleteCategory(structure, "storage-1", "category-confirm-race", {
      expected_structure_revision: 0,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(harness.database.prepare("SELECT name FROM storage_categories WHERE id = ?").get("category-confirm-race"))
      .toEqual({ name: "Renamed remotely" });
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE subject_id = ?", "category-confirm-race")).toBe(0);
    expect(harness.published).toHaveLength(0);
  });

  it("rejects a confirmed item deletion when metadata changes before the atomic write", async () => {
    const harness = createHarness();
    const items = context(ADMIN_ID, ["admin.storage.items"]);
    const before = await harness.store.getItem("item-admin");
    harness.executor.beforeNextBatch = () => {
      harness.database.prepare("UPDATE storage_items SET name = ?, updated_at = ? WHERE id = ?")
        .run("Renamed remotely", "2026-08-09T12:00:03.000Z", "item-admin");
    };

    await expect(harness.service.deleteItem(items, "item-admin", {
      expected_updated_at: before!.updated_at,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(harness.database.prepare("SELECT name FROM storage_items WHERE id = ?").get("item-admin"))
      .toEqual({ name: "Renamed remotely" });
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE subject_id = ?", "item-admin")).toBe(0);
    expect(harness.published).toHaveLength(0);
  });

  it("rejects a confirmed item deletion when media changes before the atomic write", async () => {
    const harness = createHarness();
    const items = context(ADMIN_ID, ["admin.storage.items"]);
    const before = await harness.store.getItem("item-admin");
    const remoteMediaId = "b".repeat(21);
    harness.executor.beforeNextBatch = () => {
      insertStagedStorageImage(harness.database, remoteMediaId);
      harness.database.prepare(`INSERT INTO media_links (
        media_id, entity_type, entity_id, slot, audience, sort_order, attached_at
      ) VALUES (?, 'storage_item', 'item-admin', 'image', 'authenticated', 0, ?)`)
        .run(remoteMediaId, NOW);
      harness.database.prepare("UPDATE storage_items SET updated_at = ? WHERE id = ?")
        .run("2026-08-09T12:00:04.000Z", "item-admin");
    };

    await expect(harness.service.deleteItem(items, "item-admin", {
      expected_updated_at: before!.updated_at,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(scalar(harness.database, "SELECT count(*) FROM media_links WHERE media_id = ?", remoteMediaId)).toBe(1);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_items WHERE id = 'item-admin'")).toBe(1);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE subject_id = ?", "item-admin")).toBe(0);
    expect(harness.published).toHaveLength(0);
  });

  it("rejects a stale uploader without replacing the competing image or writing an audit row", async () => {
    const harness = createHarness();
    const staleMediaId = "a".repeat(21);
    const remoteMediaId = "b".repeat(21);
    const uploader: ConstructorParameters<typeof SqliteStorageMediaPort>[1] = {
      uploadImages: async () => {
        insertStagedStorageImage(harness.database, staleMediaId);
        return [staleMediaId];
      },
    };
    const service = new StorageService(
      harness.store,
      new SqliteStorageMediaPort(harness.executor, uploader, async () => ({
        maxImageBytes: 4_000_000,
        maxImagesPerItem: 4,
      })),
      notifications,
      deferred,
      () => "stale-upload-operation",
    );
    const items = context(ADMIN_ID, ["admin.storage.items"]);
    const before = await harness.store.getItem("item-admin");
    harness.executor.beforeNextBatch = () => {
      insertStagedStorageImage(harness.database, remoteMediaId);
      harness.database.prepare(`INSERT INTO media_links (
        media_id, entity_type, entity_id, slot, audience, sort_order, attached_at
      ) VALUES (?, 'storage_item', 'item-admin', 'image', 'authenticated', 0, ?)`)
        .run(remoteMediaId, NOW);
      harness.database.prepare("UPDATE storage_items SET updated_at = ? WHERE id = ?")
        .run("2026-08-09T12:00:05.000Z", "item-admin");
    };

    await expect(service.uploadImages(items, "item-admin", [{ full: new Uint8Array(), view: new Uint8Array() }], {
      expected_updated_at: before!.updated_at,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(scalar(harness.database, "SELECT count(*) FROM media_links WHERE media_id = ?", remoteMediaId)).toBe(1);
    expect(scalar(harness.database, "SELECT count(*) FROM media_links WHERE media_id = ?", staleMediaId)).toBe(0);
    expect(harness.database.prepare("SELECT state FROM media_assets WHERE id = ?").get(staleMediaId))
      .toMatchObject({ state: "staged" });
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE subject_id = ?", "item-admin")).toBe(0);
  });

  it("keeps the ledger's positive delete protection when a transaction lands during confirmation", async () => {
    const harness = createHarness();
    const items = context(ADMIN_ID, ["admin.storage.items"]);
    const stock = context(ADMIN_ID, ["admin.storage.stock"], "ledger-race", "2026-08-09T12:00:06.000Z");
    const before = await harness.store.getItem("item-admin");
    harness.executor.beforeNextBatch = async () => {
      await harness.service.createTransaction(stock, "item-admin", {
        idempotency_key: "ledger-race-delete-01",
        type: "intake",
        quantity: 1,
        recipient_user_id: MEMBER_ID,
      });
    };

    await expect(harness.service.deleteItem(items, "item-admin", {
      expected_updated_at: before!.updated_at,
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(scalar(harness.database, "SELECT count(*) FROM storage_ledger_entries WHERE item_id = ?", "item-admin")).toBe(1);
    expect(scalar(harness.database, "SELECT count(*) FROM storage_items WHERE id = ?", "item-admin")).toBe(1);
    expect(scalar(harness.database, "SELECT count(*) FROM audit_log WHERE subject_id = ? AND action = 'delete'", "item-admin")).toBe(0);
    expect(harness.published).toHaveLength(1);
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

    const uploaded = await service.uploadImages(admin, "item-admin", [{ full: new Uint8Array(), view: new Uint8Array() }], {
      expected_updated_at: NOW,
    });
    expect(scalar(harness.database, "SELECT count(*) FROM media_links WHERE media_id = ?", mediaId)).toBe(1);
    expect(harness.database.prepare("SELECT state FROM media_assets WHERE id = ?").get(mediaId))
      .toMatchObject({ state: "attached" });

    await service.deleteItem(admin, "item-admin", { expected_updated_at: uploaded.updated_at });

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
    const itemStatement = harness.executor.statements.find((statement) => statement.sql.includes("FROM storage_items AS item"));
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
    const beforeStatements = harness.executor.statements.length;
    const beforeBatches = harness.executor.batches.length;

    await harness.service.createBatchTransaction(admin, {
      idempotency_key: "twenty-entry-batch",
      type: "intake",
      entries: Array.from({ length: 20 }, (_, index) => ({ item_id: `bulk-${index}`, quantity: 0.5 })),
    });

    const newStatements = harness.executor.statements.slice(beforeStatements);
    const newBatches = harness.executor.batches.slice(beforeBatches);
    expect(newStatements.filter((statement) => statement.sql.includes("WITH requested"))).toHaveLength(1);
    expect(newBatches).toHaveLength(1);
    expect(newBatches[0]).toHaveLength(22);
    const callsBeforeRejected = harness.executor.statements.length + harness.executor.batches.length;
    await expect(harness.service.createBatchTransaction(admin, {
      idempotency_key: "twenty-one-items",
      type: "intake",
      entries: Array.from({ length: 21 }, (_, index) => ({ item_id: `bulk-${index}`, quantity: 1 })),
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(harness.executor.statements.length + harness.executor.batches.length).toBe(callsBeforeRejected);
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
    recipient_display_name: "member",
    note: null,
    actor_id: actorId,
    actor_display_name: "admin",
    created_at: NOW,
  };
}

function explain(database: DatabaseSync, statement: SqlStatement): string {
  const prepared = database.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`);
  const rows = prepared.all(...([...(statement.params ?? [])] as SQLInputValue[])) as Array<{ detail: string }>;
  return rows.map((row) => row.detail).join("\n");
}
