import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { handleAppError } from "./error-handler";
import {
  extractSystemTestArtifacts,
  isAnonymousSystemTestPath,
  systemTestTrackingMiddleware,
} from "./system-test-tracking";

describe("system-test anonymous request boundary", () => {
  it("allows only the guest login and invite registration smoke requests", () => {
    expect(isAnonymousSystemTestPath("POST", "/api/auth/login")).toBe(true);
    expect(isAnonymousSystemTestPath("POST", "/api/auth/register/INVITE")).toBe(true);
    expect(isAnonymousSystemTestPath("GET", "/api/auth/check-username")).toBe(false);
    expect(isAnonymousSystemTestPath("POST", "/api/events")).toBe(false);
  });

  it("registers a 500 error-log UUID before releasing the run lease", async () => {
    const statements: string[] = [];
    const DB = {
      prepare: (sql: string) => ({
        bind: () => {
          statements.push(sql);
          return {
            first: async () => sql.startsWith("UPDATE system_test_runs SET active_requests = active_requests + 1")
              ? { actor_id: "admin-1" }
              : undefined,
            run: async () => ({ meta: { changes: 1 } }),
          };
        },
      }),
      batch: async (batch: unknown[]) => batch.map(() => ({ meta: { changes: 1 } })),
    };
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user" as never, { id: "admin-1" } as never);
      c.set("requestId" as never, "request-500" as never);
      await next();
    });
    app.use("*", systemTestTrackingMiddleware);
    app.onError((error, c) => handleAppError(error, c));
    app.get("/api/fail", () => {
      throw new Error("system-test failure");
    });

    const response = await app.request("/api/fail", {
      headers: {
        "X-System-Test": "admin-console-api",
        "X-System-Test-Run-Id": "run-1",
      },
    }, { DB, MEDIA: { delete: async () => undefined } });

    expect(response.status).toBe(500);
    expect(statements.some((sql) => sql.includes("INSERT INTO error_log"))).toBe(true);
    expect(statements.some((sql) => sql.includes("'error_log'"))).toBe(true);
    expect(statements.findIndex((sql) => sql.includes("INSERT INTO error_log")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("active_requests - 1")));
  });
});

describe("system-test request lease", () => {
  it("holds cleanup until response artifacts are registered, then releases the lease", async () => {
    const statements: string[] = [];
    let artifactBatches = 0;
    const DB = {
      prepare: (sql: string) => ({
        bind: () => {
          statements.push(sql);
          return {
            first: async () => sql.startsWith("UPDATE system_test_runs SET active_requests = active_requests + 1")
              ? { actor_id: "admin-1" }
              : undefined,
            run: async () => ({ meta: { changes: 1 } }),
          };
        },
      }),
      batch: async (batch: unknown[]) => {
        artifactBatches += 1;
        return batch.map(() => ({ meta: { changes: 1 } }));
      },
    };
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user" as never, { id: "admin-1" } as never);
      c.set("requestId" as never, "request-1" as never);
      await next();
    });
    app.use("*", systemTestTrackingMiddleware);
    app.post("/api/events", (c) => c.json({ id: "event-1" }, 201));

    const response = await app.request("/api/events", {
      method: "POST",
      headers: {
        "X-System-Test": "admin-console-api",
        "X-System-Test-Run-Id": "run-1",
      },
    }, { DB, MEDIA: { delete: async () => undefined } });

    expect(response.status).toBe(201);
    expect(artifactBatches).toBe(1);
    expect(statements.findIndex((sql) => sql.includes("active_requests + 1")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("active_requests - 1")));
  });
});

describe("system-test actor boundary", () => {
  /**
   * 改密码 / 改用户名只允许操作自己，发起人的会话走不到那条路径，
   * 只能用本次运行新建的账号登录后再调。这类账号在清理阶段会被硬删，
   * 所以放行；其它任何会话用户都必须挡掉，否则无关成员写出的审计行
   * 会被算进这次运行。
   */
  function appWith(sessionUserId: string, registeredUserIds: readonly string[]) {
    const statements: string[] = [];
    const DB = {
      prepare: (sql: string) => ({
        bind: (...bindings: unknown[]) => {
          statements.push(sql);
          return {
            first: async () => {
              if (sql.startsWith("UPDATE system_test_runs SET active_requests = active_requests + 1")) {
                return { actor_id: "admin-1" };
              }
              if (sql.startsWith("SELECT run_id FROM system_test_artifacts")) {
                return bindings[1] === "user" && registeredUserIds.includes(bindings[2] as string)
                  ? { run_id: bindings[0] }
                  : undefined;
              }
              return undefined;
            },
            run: async () => ({ meta: { changes: 1 } }),
          };
        },
      }),
      batch: async (batch: unknown[]) => batch.map(() => ({ meta: { changes: 1 } })),
    };
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user" as never, { id: sessionUserId } as never);
      c.set("requestId" as never, "request-actor" as never);
      await next();
    });
    app.use("*", systemTestTrackingMiddleware);
    app.post("/api/users/:id/change-password", (c) => c.json({ ok: true }));
    const request = () => app.request("/api/users/someone/change-password", {
      method: "POST",
      headers: { "X-System-Test": "admin-console-api", "X-System-Test-Run-Id": "run-1" },
    }, { DB, MEDIA: { delete: async () => undefined } });
    return { request, statements };
  }

  it("accepts a session user this run created", async () => {
    const { request, statements } = appWith("throwaway-1", ["throwaway-1"]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(statements.findIndex((sql) => sql.includes("active_requests + 1")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("active_requests - 1")));
  });

  it("rejects a session user this run did not create, and releases the lease", async () => {
    const { request, statements } = appWith("member-9", ["throwaway-1"]);
    const response = await request();
    expect(response.status).toBe(403);
    expect(statements.some((sql) => sql.includes("active_requests - 1"))).toBe(true);
  });
});

describe("system-test response extractor", () => {
  const mediaId1 = "Abcdefghijklmnopqrstu";
  const mediaId2 = "Vbcdefghijklmnopqrstu";

  it.each([
    ["/api/admin/invite-links", { id: "invite-1" }, { type: "invite_link", key: "invite-1" }],
    ["/api/auth/register/INVITE", { user: { id: "user-1" } }, { type: "user", key: "user-1" }],
    ["/api/admin/users", { user_id: "user-2" }, { type: "user", key: "user-2" }],
    ["/api/admin/roles", { id: "role-1" }, { type: "role", key: "role-1" }],
    ["/api/events", { id: "event-1" }, { type: "event", key: "event-1" }],
    ["/api/events/templates", { id: "template-1" }, { type: "event_template", key: "template-1" }],
    ["/api/announcements", { id: "announcement-1" }, { type: "announcement", key: "announcement-1" }],
    ["/api/gallery/videos", { id: "gallery-1" }, { type: "gallery_item", key: "gallery-1" }],
    ["/api/guild-war/history", { id: "history-1" }, { type: "war_history", key: "history-1" }],
    ["/api/guild-war/conclude", { war_history_id: "history-2" }, { type: "war_history", key: "history-2" }],
    ["/api/wiki/categories", { id: "category-1" }, { type: "wiki_category", key: "category-1" }],
    ["/api/wiki/articles", { id: "article-1" }, { type: "wiki_article", key: "article-1" }],
    ["/api/badges", { id: "badge-1" }, { type: "badge", key: "badge-1" }],
    ["/api/storage/storages", { id: "storage-1" }, { type: "storage", key: "storage-1" }],
    ["/api/storage/storages/storage-1/categories", { id: "storage-category-1" }, { type: "storage_category", key: "storage-category-1" }],
    ["/api/storage/items", { id: "storage-item-1" }, { type: "storage_item", key: "storage-item-1" }],
    ["/api/classes", { id: "class-1" }, { type: "class_catalog", key: "class-1" }],
    ["/api/class-tags", { id: "tag-1" }, { type: "class_tag", key: "tag-1" }],
    ["/api/users/user-1/absences", { id: "absence-1" }, { type: "member_absence", key: "absence-1" }],
  ])("registers the exact root returned by %s", (path, body, expected) => {
    expect(extractSystemTestArtifacts("POST", path, body)).toContainEqual(expected);
  });

  it.each([
    ["/api/users/user-1/media/images", { media_ids: [mediaId1, mediaId2] }, [
      { type: "media_asset", key: mediaId1 },
      { type: "media_asset", key: mediaId2 },
    ]],
    ["/api/users/user-1/media/avatar", { media_id: mediaId1 }, [
      { type: "media_asset", key: mediaId1 },
    ]],
    ["/api/users/user-1/media/audio", { media_id: mediaId1 }, [
      { type: "media_asset", key: mediaId1 },
    ]],
    ["/api/announcements/images", { expires_at: "2026-08-09T00:00:00.000Z", media_ids: [mediaId1] }, [
      { type: "media_asset", key: mediaId1 },
    ]],
    ["/api/announcements/announcement-1/images", { media_ids: [mediaId1] }, [
      { type: "media_asset", key: mediaId1 },
    ]],
    ["/api/events/event-1/images", { media_ids: [mediaId1] }, [
      { type: "media_asset", key: mediaId1 },
    ]],
    ["/api/wiki/articles/article-1/images", { media_ids: [mediaId1] }, [
      { type: "media_asset", key: mediaId1 },
    ]],
  ])("registers every exact media asset returned by %s", (path, body, expected) => {
    expect(extractSystemTestArtifacts("POST", path, body)).toEqual(expected);
  });

  it("registers storage image media IDs", () => {
    expect(extractSystemTestArtifacts("POST", "/api/storage/items/item-1/images", [
      { media_id: mediaId1 },
      { media_id: mediaId2 },
    ])).toEqual([
      { type: "media_asset", key: mediaId1 },
      { type: "media_asset", key: mediaId2 },
    ]);
  });

  it("registers every gallery item and media ID from the production data envelope", () => {
    expect(extractSystemTestArtifacts("POST", "/api/gallery/images", {
      data: [{ id: "gallery-1", media_id: mediaId1 }, { id: "gallery-2", media_id: mediaId2 }],
    })).toEqual(expect.arrayContaining([
      { type: "gallery_item", key: "gallery-1" },
      { type: "gallery_item", key: "gallery-2" },
      { type: "media_asset", key: mediaId1 },
      { type: "media_asset", key: mediaId2 },
    ]));
  });

  it("registers attachments uploaded inside the create-event request itself", () => {
    /*
     * 多部分创建活动时，附件会在同一个请求里创建 media_assets；活动行和媒体行都必须登记。
     */
    expect(
      extractSystemTestArtifacts("POST", "/api/events", {
        id: "event-1",
        attachments: [mediaId1, mediaId2],
      }),
    ).toEqual([
      { type: "event", key: "event-1" },
      { type: "media_asset", key: mediaId1 },
      { type: "media_asset", key: mediaId2 },
    ]);
  });

  it("uses only explicit creation paths and never infers artifacts from marker text", () => {
    expect(extractSystemTestArtifacts("POST", "/api/events/event-1/participants", { title: "[systemtest] ordinary content", id: "real" })).toEqual([]);
    expect(extractSystemTestArtifacts("POST", "/api/events", { id: "event-1" })).toEqual([{ type: "event", key: "event-1" }]);
  });
});
