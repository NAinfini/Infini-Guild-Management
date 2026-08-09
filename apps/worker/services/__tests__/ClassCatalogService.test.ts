import { describe, expect, it, vi } from "vitest";
import { ClassCatalogService } from "../ClassCatalogService";
import { MediaValidationError } from "../MediaService";

const MEDIA_ID = "Abcdefghijklmnopqrstu";
const OLD_MEDIA_ID = "Vbcdefghijklmnopqrstu";

const VECTOR_ROW = {
  id: "warden",
  label: "Warden",
  color: "#61B8AA",
  iconType: "vector",
  vectorIcon: "shield",
  iconKey: null,
  sortOrder: 10,
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

function queryFromRows(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const query = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(rows)),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return query;
}

function createDrizzleDb(selectRows: unknown[][]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => queryFromRows(selectRows.shift() ?? [])),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
  };
}

type PreparedStatement = {
  sql: string;
  values: unknown[];
  bind: ReturnType<typeof vi.fn>;
  first: ReturnType<typeof vi.fn>;
};

function createRawDb(options: {
  batchError?: Error;
  classUpdateChanges?: number;
  deleteReturnedKey?: string | null;
  firstResponses?: unknown[];
} = {}) {
  const statements: PreparedStatement[] = [];
  const firstResponses = [...(options.firstResponses ?? [])];
  const prepare = vi.fn((sql: string) => {
    const statement: PreparedStatement = {
      sql,
      values: [],
      bind: vi.fn((...values: unknown[]) => {
        statement.values = values;
        return statement;
      }),
      first: vi.fn().mockImplementation(async () => firstResponses.shift() ?? null),
    };
    statements.push(statement);
    return statement;
  });
  const batch = options.batchError
    ? vi.fn().mockRejectedValue(options.batchError)
    : vi.fn().mockImplementation(async (batchStatements: PreparedStatement[]) => (
      batchStatements.map((statement) => {
        if (/^\s*UPDATE class_catalog/i.test(statement.sql)) {
          return { meta: { changes: options.classUpdateChanges ?? 1 }, results: [] };
        }
        if (/^\s*DELETE FROM class_catalog/i.test(statement.sql)) {
          return {
            meta: { changes: 1 },
            results: [{ icon_key: options.deleteReturnedKey ?? null }],
          };
        }
        return { meta: { changes: 1 }, results: [] };
      })
    ));
  return { rawDb: { prepare, batch }, statements, batch };
}

function createDeps(rawDb: ReturnType<typeof createRawDb>["rawDb"]) {
  return {
    rawDb,
    mediaService: {
      listLinkedMedia: vi.fn().mockResolvedValue(new Map()),
      listLinkedMediaIds: vi.fn().mockResolvedValue([]),
      createImages: vi.fn().mockResolvedValue({
        expiresAt: "2026-07-30T00:00:00.000Z",
        mediaIds: [MEDIA_ID],
      }),
      replace: vi.fn().mockResolvedValue(undefined),
    },
    generateId: vi.fn(() => "generated-class-id"),
    buildAuditLogStatements: vi.fn((input: { action: string }) => {
      const statement = (rawDb.prepare as (sql: string) => PreparedStatement)(
        "INSERT INTO audit_log (id, entity_type, action) VALUES (?, 'class_catalog', ?)",
      );
      return [
        (statement.bind as unknown as (...values: unknown[]) => PreparedStatement)(
          `audit-${input.action}`,
          input.action,
        ),
      ];
    }),
    warn: vi.fn(),
  };
}

describe("ClassCatalogService catalog writes", () => {
  it("puts the catalog insert and durable audit in the same atomic batch", async () => {
    const createdRow = {
      ...VECTOR_ROW,
      id: "generated-class-id",
      label: "Sentinel",
      color: "#112233",
      sortOrder: 20,
    };
    const db = createDrizzleDb([[{ value: 10 }], [createdRow]]);
    const { rawDb, batch } = createRawDb();
    const deps = createDeps(rawDb);
    const service = new ClassCatalogService(db as never, deps as never);

    await expect(service.create({
      label: "Sentinel",
      color: "#112233",
      vector_icon: "shield",
    }, "admin-1")).resolves.toEqual({
      ok: true,
      data: expect.objectContaining({ id: "generated-class-id", label: "Sentinel" }),
    });

    expect(batch).toHaveBeenCalledOnce();
    const batchedSql = batch.mock.calls[0]?.[0].map((statement: PreparedStatement) => statement.sql);
    expect(batchedSql).toHaveLength(2);
    expect(batchedSql?.[0]).toMatch(/INSERT INTO class_catalog/i);
    expect(batchedSql?.[1]).toMatch(/INSERT INTO audit_log/i);
  });

  it("maps only the case-insensitive label unique index violation to conflict", async () => {
    const db = createDrizzleDb([[{ value: 10 }]]);
    const { rawDb } = createRawDb({
      batchError: new Error(
        "D1_ERROR: UNIQUE constraint failed: index 'ux_class_catalog_label_nocase'",
      ),
    });
    const deps = createDeps(rawDb);
    const service = new ClassCatalogService(db as never, deps as never);

    await expect(service.create({
      label: "warden",
      color: "#112233",
      vector_icon: "shield",
    }, "admin-1")).resolves.toEqual({
      ok: false,
      code: "CONFLICT",
      message: "A class with this label already exists",
    });
  });

  it("does not hide unrelated database failures behind a label conflict", async () => {
    const db = createDrizzleDb([[{ value: 10 }]]);
    const { rawDb } = createRawDb({ batchError: new Error("D1 unavailable") });
    const deps = createDeps(rawDb);
    const service = new ClassCatalogService(db as never, deps as never);

    await expect(service.create({
      label: "Sentinel",
      color: "#112233",
      vector_icon: "shield",
    }, "admin-1")).rejects.toThrow("D1 unavailable");
  });

  it("maps a concurrent case-insensitive rename collision to conflict", async () => {
    const db = createDrizzleDb([[VECTOR_ROW]]);
    const { rawDb } = createRawDb({
      batchError: new Error(
        "D1_ERROR: UNIQUE constraint failed: index 'ux_class_catalog_label_nocase'",
      ),
    });
    const deps = createDeps(rawDb);
    const service = new ClassCatalogService(db as never, deps as never);

    await expect(service.update("warden", {
      label: "Sentinel",
    }, "admin-1")).resolves.toEqual({
      ok: false,
      code: "CONFLICT",
      message: "A class with this label already exists",
    });
  });
});

describe("ClassCatalogService reorder", () => {
  const CATALOG_IDS = [{ id: "warden" }, { id: "seer" }, { id: "ranger" }];

  it("renumbers every class and the audit row in one atomic batch", async () => {
    const db = createDrizzleDb([CATALOG_IDS, [VECTOR_ROW]]);
    const { rawDb, batch } = createRawDb();
    const deps = createDeps(rawDb);
    const service = new ClassCatalogService(db as never, deps as never);

    const result = await service.reorder(["ranger", "warden", "seer"], "admin-1");

    expect(result).toMatchObject({ ok: true });
    expect(batch).toHaveBeenCalledOnce();
    const batched = batch.mock.calls[0]?.[0] as PreparedStatement[];
    expect(batched).toHaveLength(4);
    /* 下标 * 10：号段和 create() 的 max + 10 对齐，中间留出手工插值的空位。 */
    expect(batched.slice(0, 3).map((statement) => [statement.sql, statement.values[0], statement.values[2]]))
      .toEqual([
        [expect.stringMatching(/UPDATE class_catalog SET sort_order/i), 0, "ranger"],
        [expect.stringMatching(/UPDATE class_catalog SET sort_order/i), 10, "warden"],
        [expect.stringMatching(/UPDATE class_catalog SET sort_order/i), 20, "seer"],
      ]);
    expect(batched[3]?.sql).toMatch(/INSERT INTO audit_log/i);
    expect(deps.buildAuditLogStatements).toHaveBeenCalledWith(
      expect.objectContaining({ action: "batch_update", entityId: "batch" }),
    );
  });

  it("refuses a partial order instead of interleaving old and new sort keys", async () => {
    const db = createDrizzleDb([CATALOG_IDS]);
    const { rawDb, batch } = createRawDb();
    const service = new ClassCatalogService(db as never, createDeps(rawDb) as never);

    await expect(service.reorder(["ranger", "warden"], "admin-1")).resolves.toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Class order must list all 3 classes; received 2",
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("refuses an order built from a stale snapshot even when the count matches", async () => {
    const db = createDrizzleDb([CATALOG_IDS]);
    const { rawDb, batch } = createRawDb();
    const service = new ClassCatalogService(db as never, createDeps(rawDb) as never);

    // "ranger" 已经不在客户端那份快照里，"deleted-one" 则早就没了。
    await expect(service.reorder(["warden", "seer", "deleted-one"], "admin-1")).resolves.toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Class order is missing 1 class(es)",
    });
    expect(batch).not.toHaveBeenCalled();
  });
});

describe("ClassCatalogService icon lifecycle", () => {
  it("maps MediaService validation to a service validation error", async () => {
    const db = createDrizzleDb([[VECTOR_ROW]]);
    const { rawDb } = createRawDb();
    const deps = createDeps(rawDb);
    deps.mediaService.createImages.mockRejectedValueOnce(
      new MediaValidationError("Class icons must be converted to WebP before upload"),
    );
    const service = new ClassCatalogService(db as never, deps as never);

    await expect(service.uploadIcon(
      "warden",
      { full: new ArrayBuffer(1), view: new ArrayBuffer(1) },
      "admin-1",
      5_000_000,
    )).resolves.toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Class icons must be converted to WebP before upload",
    });
  });

  it("creates and attaches a canonical media id before switching the catalog row to image", async () => {
    const updatedRow = {
      ...VECTOR_ROW,
      iconType: "image",
      vectorIcon: null,
    };
    const db = createDrizzleDb([[VECTOR_ROW], [updatedRow]]);
    const { rawDb, batch } = createRawDb();
    const deps = createDeps(rawDb);
    deps.mediaService.listLinkedMediaIds
      .mockResolvedValueOnce([OLD_MEDIA_ID])
      .mockResolvedValueOnce([MEDIA_ID]);
    const service = new ClassCatalogService(db as never, deps as never);

    const result = await service.uploadIcon(
      "warden",
      { full: new ArrayBuffer(1), view: new ArrayBuffer(1) },
      "admin-1",
      5_000_000,
    );

    expect(result).toEqual({ ok: true, data: expect.objectContaining({ id: "warden", icon_type: "image", icon_media_id: MEDIA_ID }) });
    expect(deps.mediaService.createImages).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "class_icon",
      ownerUserId: "admin-1",
      maxBytes: 5_000_000,
    }));
    expect(deps.mediaService.replace).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "class_catalog",
      entityId: "warden",
      slot: "icon",
      media: [{ mediaId: MEDIA_ID, sortOrder: 0 }],
    }));
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledOnce();
  });

  it("restores the previous icon link if the catalog update fails", async () => {
    const failure = new Error("D1 unavailable");
    const db = createDrizzleDb([[VECTOR_ROW]]);
    db.update.mockReturnValueOnce({ set: vi.fn(() => ({ where: vi.fn().mockRejectedValue(failure) })) });
    const { rawDb } = createRawDb();
    const deps = createDeps(rawDb);
    deps.mediaService.listLinkedMediaIds.mockResolvedValueOnce([OLD_MEDIA_ID]);
    const service = new ClassCatalogService(db as never, deps as never);

    await expect(service.uploadIcon(
      "warden",
      { full: new ArrayBuffer(1), view: new ArrayBuffer(1) },
      "admin-1",
      5_000_000,
    )).rejects.toBe(failure);

    expect(deps.mediaService.replace).toHaveBeenCalledTimes(2);
    expect(deps.mediaService.replace).toHaveBeenLastCalledWith(expect.objectContaining({
      media: [{ mediaId: OLD_MEDIA_ID, sortOrder: 0 }],
    }));
  });

  it("removes class-tag membership before deleting the class parent", async () => {
    const db = createDrizzleDb([[{ ...VECTOR_ROW, iconType: "image", vectorIcon: null }]]);
    const { rawDb, statements } = createRawDb();
    const deps = createDeps(rawDb);
    deps.mediaService.listLinkedMediaIds.mockResolvedValueOnce([OLD_MEDIA_ID]);
    const service = new ClassCatalogService(db as never, deps as never);

    await expect(service.delete("warden", "admin-1")).resolves.toEqual({
      ok: true,
      data: { deleted: true },
    });

    const sql = statements.map(({ sql: statement }) => statement).join("\n");
    expect(sql).toContain("DELETE FROM class_catalog");
    expect(sql).not.toContain("member_profiles");
    expect(sql).not.toContain("member_profile_classes");
    expect(statements.findIndex(({ sql: statement }) => statement.includes("DELETE FROM class_tag_members"))).toBeLessThan(
      statements.findIndex(({ sql: statement }) => statement.includes("DELETE FROM class_catalog")),
    );
    expect(deps.mediaService.replace).not.toHaveBeenCalled();
  });
});
