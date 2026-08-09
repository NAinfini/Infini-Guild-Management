
import { describe, expect, it, vi } from "vitest";
import { SystemTestService } from "../SystemTestService";

function createEnv() {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const DB = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => {
        statements.push({ sql, params });
        return { run: async () => ({ meta: { changes: 1 } }), first: async () => undefined, all: async () => ({ results: [] }) };
      },
    }),
    batch: async () => [],
  };
  const MEDIA = { delete: vi.fn().mockResolvedValue(undefined) };
  return { env: { DB, MEDIA }, statements, MEDIA };
}

describe("SystemTestService exact compensation", () => {
  it("issues a different server-generated UID for every run", async () => {
    const { env, statements } = createEnv();
    const service = new SystemTestService(env as never);

    const first = await service.createRun("admin-1");
    const second = await service.createRun("admin-1");

    expect(first).not.toBe(second);
    expect(statements.filter((statement) => statement.sql.startsWith("INSERT INTO system_test_runs")))
      .toHaveLength(2);
  });

  /*
   * 废弃运行的回收挂在「开一次新测试」上，没有定时任务兜底了。
   * 扫描必须发生在这一行插进去之前，否则新运行会被自己这一轮扫描看见。
   */
  it("sweeps abandoned runs before registering the new one", async () => {
    const { env, statements } = createEnv();

    await new SystemTestService(env as never).createRun("admin-1");

    const sweep = statements.findIndex((statement) => statement.sql.includes("FROM system_test_runs WHERE (status ="));
    const insert = statements.findIndex((statement) => statement.sql.startsWith("INSERT INTO system_test_runs"));
    expect(sweep, "开新运行时要扫一遍废弃运行").toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(sweep);
  });

  it("deletes only registered exact domain ids and media asset ids", async () => {
    const { env, statements, MEDIA } = createEnv();
    const mediaId = "Abcdefghijklmnopqrstu";
    await new SystemTestService(env as never).cleanupExactArtifacts([
      { type: "gallery_item", key: "gallery-test-1" },
      { type: "media_asset", key: mediaId },
    ]);

    expect(statements).toEqual(expect.arrayContaining([
      expect.objectContaining({ sql: "DELETE FROM gallery_items WHERE id = ?", params: ["gallery-test-1"] }),
      expect.objectContaining({ sql: "DELETE FROM media_assets WHERE id = ?1", params: [mediaId] }),
    ]));
    expect(statements.some((statement) => /\bLIKE\b/i.test(statement.sql))).toBe(false);
    expect(MEDIA.delete).not.toHaveBeenCalled();
    const galleryDelete = statements.findIndex(({ sql }) => sql === "DELETE FROM gallery_items WHERE id = ?");
    const mediaLookup = statements.findIndex(({ sql }) => sql.includes("FROM media_assets"));
    expect(galleryDelete).toBeGreaterThanOrEqual(0);
    expect(mediaLookup).toBeGreaterThan(galleryDelete);
  });

  it("uses child-first cleanup for compensated event, template, war, and error UUIDs", async () => {
    const { env, statements } = createEnv();
    await new SystemTestService(env as never).cleanupExactArtifacts([
      { type: "event", key: "event-1" },
      { type: "event_template", key: "template-1" },
      { type: "war_history", key: "war-1" },
      { type: "error_log", key: "error-1" },
    ]);

    const sql = statements.map((statement) => statement.sql);
    expect(sql.some((query) => query.includes("DELETE FROM war_team_members"))).toBe(true);
    expect(sql.some((query) => query.includes("DELETE FROM event_poll_votes"))).toBe(true);
    expect(sql.some((query) => query.includes("SELECT id FROM events WHERE series_id = ?"))).toBe(true);
    expect(statements).toContainEqual(expect.objectContaining({
      sql: "DELETE FROM error_log WHERE id = ?",
      params: ["error-1"],
    }));
    const generatedEventLookup = sql.findIndex((query) => query.includes("SELECT id FROM events WHERE series_id = ?"));
    const eventDelete = sql.findIndex((query) => query === "DELETE FROM events WHERE id = ?");
    const templateDelete = sql.findIndex((query) => query === "DELETE FROM recurring_templates WHERE id = ?");
    expect(eventDelete).toBeGreaterThan(generatedEventLookup);
    expect(templateDelete).toBeGreaterThan(eventDelete);
    expect(sql.every((query) => !/\bLIKE\b/iu.test(query))).toBe(true);
  });

  it("deletes registered domain parents before their explicitly registered media assets", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const mediaId = "Abcdefghijklmnopqrstu";
    const DB = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => {
          statements.push({ sql, params });
          return {
            first: async () => sql.startsWith("SELECT id, actor_id")
              ? { id: "run-1", actor_id: "admin-1", status: "running", active_requests: 0, cleanup_attempts: 0 }
              : undefined,
            all: async () => sql.startsWith("SELECT artifact_type")
              ? { results: [
                  { artifact_type: "gallery_item", artifact_key: "gallery-1" },
                  { artifact_type: "media_asset", artifact_key: mediaId },
                ] }
              : { results: [] },
            run: async () => ({ meta: { changes: 1 } }),
          };
        },
      }),
      batch: async (batch: unknown[]) => batch.map(() => ({ meta: { changes: 1 } })),
    };
    const service = new SystemTestService({ DB, MEDIA: { delete: vi.fn().mockResolvedValue(undefined) } } as never);

    await expect(service.cleanupRun("run-1", "admin-1")).resolves.toEqual({ status: "completed", attempts: 1 });

    const galleryDelete = statements.findIndex(({ sql }) => sql === "DELETE FROM gallery_items WHERE id = ?");
    const mediaLookup = statements.findIndex(({ sql }) => sql.includes("FROM media_assets"));
    expect(galleryDelete).toBeGreaterThanOrEqual(0);
    expect(mediaLookup).toBeGreaterThan(galleryDelete);
  });

  it("cleans storage ledger rows before their batch and then removes the ordinary audit", async () => {
    const { env, statements } = createEnv();

    await new SystemTestService(env as never).cleanupExactArtifacts([
      { type: "storage_item", key: "item-1" },
      { type: "storage_batch", key: `storage-batch-${"a".repeat(64)}` },
      { type: "audit_log", key: "audit-1" },
    ]);

    const sql = statements.map((statement) => statement.sql);
    const transactionDelete = sql.findIndex((query) => query.startsWith("DELETE FROM storage_transactions"));
    const itemDelete = sql.findIndex((query) => query.startsWith("DELETE FROM storage_items"));
    const batchDelete = sql.findIndex((query) => query.startsWith("DELETE FROM storage_batches"));
    const auditDelete = sql.findIndex((query) => query.startsWith("DELETE FROM audit_log"));
    expect(transactionDelete).toBeGreaterThanOrEqual(0);
    expect(itemDelete).toBeGreaterThan(transactionDelete);
    expect(batchDelete).toBeGreaterThan(itemDelete);
    expect(auditDelete).toBeGreaterThan(batchDelete);
  });

  it("registers artifacts only while the run is accepting requests", async () => {
    const statements: string[] = [];
    const DB = {
      prepare: (sql: string) => ({
        bind: () => {
          statements.push(sql);
          return {};
        },
      }),
      batch: async () => [{ meta: { changes: 0 } }],
    };

    await expect(new SystemTestService({
      DB,
      MEDIA: { delete: async () => undefined },
    } as never).registerArtifacts("run-1", [
      { type: "event", key: "event-1" },
    ])).rejects.toThrow("no longer accepting artifacts");

    expect(statements[0]).toContain("FROM system_test_runs");
    expect(statements[0]).toContain("status = 'running'");
  });

  it("does not claim cleanup while a request lease is active", async () => {
    const queries: string[] = [];
    const DB = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            queries.push(sql);
            if (sql.startsWith("SELECT id, actor_id")) {
              return {
                id: "run-1",
                actor_id: "admin-1",
                status: "running",
                active_requests: 1,
                cleanup_attempts: 0,
              };
            }
            if (sql.startsWith("SELECT status")) {
              return { status: "running", cleanup_attempts: 0 };
            }
            return undefined;
          },
          run: async () => {
            queries.push(sql);
            return { meta: { changes: 0 } };
          },
        }),
      }),
    };

    await expect(new SystemTestService({
      DB,
      MEDIA: { delete: async () => undefined },
    } as never).cleanupRun("run-1", "admin-1")).resolves.toEqual({
      status: "running",
      attempts: 0,
    });

    expect(queries.some((sql) => sql.includes("active_requests = 0"))).toBe(true);
    expect(queries.some((sql) => sql.startsWith("SELECT artifact_type"))).toBe(false);
  });

  it("moves a third failed cleanup attempt to manual review without marker SQL", async () => {
    const updates: unknown[][] = [];
    const DB = {
      prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({
        first: async () => sql.startsWith("SELECT id, actor_id") ? { id: "run-1", actor_id: "admin-1", status: "cleanup_failed", cleanup_attempts: 2 } : undefined,
        all: async () => { if (sql.startsWith("SELECT artifact_type")) throw new Error("D1 unavailable"); return { results: [] }; },
        run: async () => { if (sql.startsWith("UPDATE system_test_runs")) updates.push(params); return { meta: { changes: 1 } }; },
      }) }),
      batch: async () => [],
    };
    const service = new SystemTestService({ DB, MEDIA: { delete: async () => undefined } } as never);
    await expect(service.cleanupRun("run-1", "admin-1")).resolves.toEqual({ status: "manual_review", attempts: 3 });
    expect(updates.some((params) => params.includes("manual_review"))).toBe(true);
  });

  it("finds abandoned work only through the run registry", async () => {
    const queries: string[] = [];
    const DB = {
      prepare: (sql: string) => {
        queries.push(sql);
        return {
          bind: () => ({
            run: async () => ({ meta: { changes: 0 } }),
            all: async () => ({ results: [] }),
          }),
        };
      },
    };

    await expect(new SystemTestService({
      DB,
      MEDIA: { delete: async () => undefined },
    } as never).cleanupStaleRuns()).resolves.toEqual({
      processed: 0,
      completed: 0,
      manualReview: 0,
    });

    expect(queries).toHaveLength(2);
    expect(queries.every((query) => query.includes("system_test_runs"))).toBe(true);
    expect(queries.some((query) => query.includes("status = 'completed'"))).toBe(true);
    expect(queries.every((query) => !/\b(?:announcements|events|wiki_articles|gallery_items)\b/iu.test(query))).toBe(true);
    expect(queries.every((query) => !/\bLIKE\b/iu.test(query))).toBe(true);
  });

  it("finalizes an empty completed run and keeps only a stable audit summary identity", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const DB = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => {
          statements.push({ sql, params });
          return {};
        },
      }),
      batch: async (batch: unknown[]) => batch.map(() => ({ meta: { changes: 1 } })),
    };
    const service = new SystemTestService({ DB, MEDIA: { delete: async () => undefined } } as never);

    await expect(service.finalizeRun("run-private-uuid", "admin-1", {
      diffTitle: "Full system test: 2/2 passed",
      detail: { total: 2, passed: 2, failed: 0, errors: [] },
    })).resolves.toBeUndefined();

    expect(statements[0]?.sql).toContain("INSERT INTO audit_log");
    expect(statements[0]?.sql).toContain("'admin-console-api'");
    expect(statements[0]?.sql).not.toContain("entity_id, diff_title, detail_text) VALUES");
    expect(statements[0]?.params[2]).toBe('{"total":2,"passed":2,"failed":0,"errors":[]}');
    expect(statements.at(-1)).toEqual(expect.objectContaining({
      params: ["run-private-uuid", "admin-1"],
    }));
  });

  it("treats a missing run as already finalized so client retries are safe", async () => {
    const DB = {
      prepare: (sql: string) => ({
        bind: () => ({
          run: async () => ({ meta: { changes: 0 } }),
          first: async () => sql.startsWith("SELECT actor_id") ? undefined : undefined,
        }),
      }),
    };

    await expect(new SystemTestService({
      DB,
      MEDIA: { delete: async () => undefined },
    } as never).finalizeRun("already-removed", "admin-1")).resolves.toBeUndefined();
  });

  it("ignores unregistered media ids during exact cleanup", async () => {
    const { env, statements, MEDIA } = createEnv();

    await new SystemTestService(env as never).cleanupExactArtifacts([
      { type: "gallery_item", key: "gallery-test-1" },
    ]);

    expect(statements.some((statement) => statement.sql.includes("media_assets"))).toBe(false);
    expect(MEDIA.delete).not.toHaveBeenCalled();
  });
});
