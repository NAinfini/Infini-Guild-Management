import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";
import { AdminService } from "../AdminService";

const sqliteDialect = new SQLiteSyncDialect();

function encodeInviteCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify({ created_at: createdAt, id }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function decodeInviteCursor(value: string): { created_at: string; id: string } {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return JSON.parse(atob(base64)) as { created_at: string; id: string };
}

function siteConfigRow(analyticsSettingsJson: string) {
  return {
    id: "default",
    siteName: "D1 Guild",
    siteLogoUrl: "/logo.webp",
    featureFlagsJson: JSON.stringify({
      announcements: true,
      events: true,
      guildWar: true,
      gallery: true,
      wiki: true,
      tools: true,
      storage: true,
    }),
    mediaPolicyJson: JSON.stringify({
      max_file_size_bytes: {
        profile_image: 5242880,
        profile_audio: 20971520,
        announcement_image: 5242880,
        wiki_image: 5242880,
        event_image: 5242880,
        gallery_image: 10485760,
      },
      quotas: {
        profile: 10,
        announcement: 10,
        gallery: 20,
        wiki: 10,
      },
    }),
    paginationPolicyJson: JSON.stringify({
      admin: 50,
      announcements: 50,
      events: 100,
      gallery: 24,
      guild_war: 20,
      users: 500,
      wiki: 50,
    }),
    storagePolicyJson: JSON.stringify({ images_per_item: 5 }),
    absencePolicyJson: JSON.stringify({ max_span_days: 366, max_entries_per_user: 20 }),
    analyticsSettingsJson,
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
  };
}

function createRawDb() {
  return { batch: vi.fn().mockResolvedValue([]), prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })) };
}

function createService(db: unknown, rawDb: unknown = { batch: vi.fn(), prepare: vi.fn() }): AdminService {
  const media = {
    get: vi.fn(),
    put: vi.fn(),
    head: vi.fn(),
  };
  return new AdminService({
    db: db as never,
    media: media as never,
    rawDb: rawDb as never,
    writeAuditLog: vi.fn(),
    writeAuditLogDurable: vi.fn(),
    createPasswordHash: vi.fn(),
    generateId: () => "id-1",
    generateInviteCode: () => "invite-1",
    generateTemporaryPassword: () => "temporary-password",
    now: () => new Date("2026-05-18T00:00:00.000Z"),
    envSiteName: "Env Guild",
    envSiteLogoUrl: "/env-logo.webp",
  });
}

describe("AdminService role assignment guardrails", () => {
  it("paginates invite links with a stable keyset cursor and reports an uncapped total", async () => {
    const inviteRows = [
      {
        id: "invite-3",
        code: "THREE",
        createdBy: "admin-1",
        maxUses: 5,
        usedCount: 1,
        expiresAt: null,
        createdAt: "2026-05-18T00:00:00.000Z",
        revokedAt: null,
      },
      {
        id: "invite-2",
        code: "TWO",
        createdBy: "admin-1",
        maxUses: 5,
        usedCount: 0,
        expiresAt: null,
        createdAt: "2026-05-17T00:00:00.000Z",
        revokedAt: null,
      },
    ];
    const cursor = encodeInviteCursor("2026-05-19T00:00:00.000Z", "invite-4");
    let listPredicate: SQL | undefined;
    let countPredicate: SQL | undefined;
    const limit = vi.fn().mockResolvedValue(inviteRows);
    const orderBy = vi.fn(() => ({ limit }));
    const listWhere = vi.fn((predicate: SQL) => {
      listPredicate = predicate;
      return { orderBy };
    });
    const countWhere = vi.fn((predicate: SQL) => {
      countPredicate = predicate;
      return Promise.resolve([{ total: 12 }]);
    });
    const select = vi
      .fn()
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: listWhere })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: countWhere })) });
    const service = createService({ select });

    const result = await service.listInviteLinks({
      cursor,
      limit: 1,
      visibility: "active",
      search: "three",
      searchCodes: true,
    });

    expect(limit).toHaveBeenCalledWith(2);
    const listQuery = sqliteDialect.sqlToQuery(listPredicate!);
    const countQuery = sqliteDialect.sqlToQuery(countPredicate!);
    expect(listQuery.sql).toContain("created_at");
    expect(listQuery.sql).toContain("id");
    expect(listQuery.params).toEqual(expect.arrayContaining([
      "2026-05-19T00:00:00.000Z",
      "invite-4",
    ]));
    expect(countQuery.params).not.toContain("invite-4");
    expect(result).toEqual({
      ok: true,
      data: {
        data: [expect.objectContaining({ id: "invite-3", code: "THREE" })],
        next_cursor: expect.any(String),
        total: 12,
      },
    });
    if (!result.ok || !result.data.next_cursor) return;
    expect(decodeInviteCursor(result.data.next_cursor)).toEqual({
      created_at: "2026-05-18T00:00:00.000Z",
      id: "invite-3",
    });
  });

  it("rejects an invalid invite cursor instead of silently restarting at page one", async () => {
    const select = vi.fn();
    const service = createService({ select });

    const result = await service.listInviteLinks({
      cursor: "not base64url",
      limit: 50,
      visibility: "active",
      searchCodes: true,
    });

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Invalid invite cursor",
    });
    expect(select).not.toHaveBeenCalled();
  });

  it("aggregates invite stats in SQL without a 100-row cap", async () => {
    const from = vi.fn().mockResolvedValue([{
      total: 321,
      active: 120,
      revoked: 31,
      expired: 170,
    }]);
    const service = createService({
      select: vi.fn(() => ({ from })),
    });

    const result = await service.getInviteLinkStats();

    expect(result).toEqual({
      ok: true,
      data: {
        total: 321,
        active: 120,
        revoked: 31,
        expired: 170,
      },
    });
  });

  it("records the invite id instead of the invite code in create audit logs", async () => {
    const inviteRow = {
      id: "invite-id-1",
      code: "SECRET-INVITE-CODE",
      createdBy: "admin-1",
      maxUses: 2,
      usedCount: 0,
      expiresAt: null,
      createdAt: "2026-05-18T00:00:00.000Z",
      revokedAt: null,
    };
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    const limit = vi.fn().mockResolvedValue([inviteRow]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const writeAuditLog = vi.fn();
    const service = new AdminService({
      db: { insert, select } as never,
      media: {} as never,
      rawDb: {} as never,
      writeAuditLog,
      writeAuditLogDurable: vi.fn(),
      createPasswordHash: vi.fn(),
      generateId: () => "invite-id-1",
      generateInviteCode: () => "SECRET-INVITE-CODE",
      generateTemporaryPassword: () => "temporary-password",
      now: () => new Date("2026-05-18T00:00:00.000Z"),
      envSiteName: "Env Guild",
      envSiteLogoUrl: "/env-logo.webp",
    });

    await service.createInviteLink("admin-1", 2, null);

    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityId: "invite-id-1",
      diffTitle: "invite-id-1",
    }));
    expect(JSON.stringify(writeAuditLog.mock.calls)).not.toContain("SECRET-INVITE-CODE");
  });

  it("reports built-in admin permissions from database rows without synthesizing missing grants", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          orderBy: vi.fn().mockResolvedValue([{
            id: "admin",
            name: "Admin",
            level: 999,
            color: "red",
            isBuiltin: true,
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T00:00:00.000Z",
          }]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ roleId: "admin", permission: "admin.users.view", granted: true }]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn().mockResolvedValue([{ roleId: "admin", count: 1 }]),
          })),
        })),
      });
    const service = createService({ select });

    const result = await service.listRoles();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.permissions["admin.users.view"]).toBe(true);
    expect(result.data[0]?.permissions["admin.siteConfig.manage"]).toBe(false);
    expect(result.data[0]?.permissions["admin.storage.stock"]).toBe(false);
  });

  it("reads analytics settings from D1 site config without touching R2", async () => {
    const media = {
      get: vi.fn(),
      put: vi.fn(),
      head: vi.fn(),
    };
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([siteConfigRow(
            JSON.stringify({
              reference_duration_minutes: 60,
              modifier_weights: { kills: 0.6, assists: 0.4 },
            }),
          )]),
        })),
      })),
    }));
    const service = new AdminService({
      db: { select } as never,
      media: media as never,
      rawDb: { batch: vi.fn(), prepare: vi.fn() } as never,
      writeAuditLog: vi.fn(),
      writeAuditLogDurable: vi.fn(),
      createPasswordHash: vi.fn(),
      generateId: () => "id-1",
      generateInviteCode: () => "invite-1",
      generateTemporaryPassword: () => "temporary-password",
      now: () => new Date("2026-05-18T00:00:00.000Z"),
      envSiteName: "Env Guild",
      envSiteLogoUrl: "/env-logo.webp",
    });

    const result = await service.getAnalyticsSettings();

    expect(result).toEqual({
      ok: true,
      data: {
        reference_duration_minutes: 60,
        modifier_weights: { kills: 0.6, assists: 0.4 },
      },
    });
    expect(media.get).not.toHaveBeenCalled();
  });

  it("updates analytics settings in D1 site config without writing R2", async () => {
    const media = {
      get: vi.fn(),
      put: vi.fn(),
      head: vi.fn(),
    };
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([siteConfigRow(
            JSON.stringify({
              reference_duration_minutes: 30,
              modifier_weights: { kills: 1 },
            }),
          )]),
        })),
      })),
    }));
    const writeAuditLog = vi.fn();
    const service = new AdminService({
      db: { select, update: vi.fn(() => ({ set })) } as never,
      media: media as never,
      rawDb: { batch: vi.fn(), prepare: vi.fn() } as never,
      writeAuditLog,
      writeAuditLogDurable: vi.fn(),
      createPasswordHash: vi.fn(),
      generateId: () => "id-1",
      generateInviteCode: () => "invite-1",
      generateTemporaryPassword: () => "temporary-password",
      now: () => new Date("2026-05-18T00:00:00.000Z"),
      envSiteName: "Env Guild",
      envSiteLogoUrl: "/env-logo.webp",
    });

    const result = await service.updateAnalyticsSettings("admin-1", {
      reference_duration_minutes: 60,
      modifier_weights: { kills: 2, towers: 1 },
    });

    expect(result.ok).toBe(true);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      analyticsSettingsJson: JSON.stringify({
        reference_duration_minutes: 60,
        modifier_weights: { kills: 0.6667, towers: 0.3333 },
      }),
    }));
    expect(media.put).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "analytics_settings",
      action: "update",
      actorId: "admin-1",
    }));
  });

  it("blocks non-admins from assigning roles with high-risk permissions", async () => {
    const update = vi.fn();
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([{ roleId: "moderator", level: 50 }]),
            })),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ id: "role-danger", level: 10 }]),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            { permission: "admin.users.role", granted: true },
          ]),
        })),
      });
    const service = createService({ select, update });

    const result = await service.updateUserRole("actor-1", "target-1", "role-danger");

    expect(result).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Only admin can assign roles containing high-risk permissions",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("blocks a role manager from granting permissions it does not hold itself", async () => {
    const values = vi.fn();
    const insert = vi.fn(() => ({ values }));
    const select = vi
      .fn()
      // getActorRoleLevel
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([{ roleId: "moderator", level: 50 }]),
            })),
          })),
        })),
      })
      // duplicate role id check
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        })),
      })
      // permissions actually held by the actor's own role
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            { permission: "admin.roles.manage", granted: true },
            { permission: "events.create", granted: true },
          ]),
        })),
      });
    const service = createService({ select, insert });

    const result = await service.createRole("actor-1", {
      id: "custom_helper",
      name: "Helper",
      level: 10,
      permissions: { "events.create": true, "admin.audit.view": true },
    });

    expect(result).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Cannot grant permissions you do not hold: admin.audit.view",
    });
    // The role row must not survive a rejected request.
    expect(insert).not.toHaveBeenCalled();
  });

  it("lets a role manager re-grant permissions it holds without escalating", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    const createdRow = {
      id: "custom_helper",
      name: "Helper",
      level: 10,
      color: null,
      isBuiltin: false,
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
    };
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([{ roleId: "moderator", level: 50 }]),
            })),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ permission: "events.create", granted: true }]),
        })),
      })
      // reload of the created role
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([createdRow]) })),
        })),
      });
    const service = createService({ select, insert }, createRawDb());

    const result = await service.createRole("actor-1", {
      id: "custom_helper",
      name: "Helper",
      level: 10,
      permissions: { "events.create": true },
    });

    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe("AdminService.createMember reserved system-test username", () => {
  /*
   * system-test-cleanup permanently deletes users in this namespace, so an
   * admin-created account must never be able to land in it — the row would
   * be gone a day later with no warning.
   */
  it("refuses to create an account in the system-test namespace", async () => {
    const select = vi.fn();
    const rawDb = createRawDb();
    const service = createService({ select }, rawDb);

    const result = await service.createMember("admin-1", "systemtest_hijack");

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: 'Usernames beginning with "systemtest_" are reserved',
    });
    // Rejected before any lookup or insert.
    expect(select).not.toHaveBeenCalled();
    expect(rawDb.batch).not.toHaveBeenCalled();
  });

  it("matches the reserved prefix case-insensitively", async () => {
    const select = vi.fn();
    const service = createService({ select }, createRawDb());

    const result = await service.createMember("admin-1", "SystemTest_Hijack");

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
  });
});

describe("AdminService.getStatus", () => {
  const REQUIRED_TABLES = [
    "users",
    "user_auth_password",
    "sessions",
    "login_failures",
    "member_profiles",
    "member_profile_classes",
    "member_profile_images",
    "roles",
    "role_permissions",
    "site_config",
    "class_catalog",
    "class_tags",
    "class_tag_members",
    "events",
    "event_attachments",
    "event_class_quotas",
    "recurring_templates",
    "recurring_template_attachments",
    "recurring_template_class_quotas",
    "media_references",
    "media_reference_backfills",
    "media_upload_leases",
    "system_test_runs",
    "system_test_artifacts",
    "storage_items",
    "storage_transactions",
  ];

  /**
   * 按表名给出每张表探针的结果：返回值即 first() 的行为，抛出的 Error 即真故障。
   * 同时把执行过的 SQL 收集下来，供「不许再碰 sqlite_master」的断言使用。
   */
  function createStatusService(
    tableBehaviour: (table: string) => unknown,
    mediaHead: () => unknown = () => null,
  ): { service: AdminService; sql: string[] } {
    const sql: string[] = [];
    const rawDb = {
      batch: vi.fn(),
      prepare: (query: string) => {
        sql.push(query);
        const table = /FROM "([^"]+)"/.exec(query)?.[1] ?? "";
        return { first: async () => tableBehaviour(table) };
      },
    };
    const service = new AdminService({
      db: {} as never,
      media: { get: vi.fn(), put: vi.fn(), head: async () => mediaHead() } as never,
      ws: {} as never,
      rawDb: rawDb as never,
      writeAuditLog: vi.fn(),
      writeAuditLogDurable: vi.fn(),
      createPasswordHash: vi.fn(),
      generateId: () => "id-1",
      generateInviteCode: () => "invite-1",
      generateTemporaryPassword: () => "temporary-password",
      now: () => new Date("2026-05-18T00:00:00.000Z"),
      envSiteName: "Env Guild",
      envSiteLogoUrl: "/env-logo.webp",
    });
    return { service, sql };
  }

  /* D1 forbids sqlite_master reads, so health checks probe required tables directly. */
  it("probes each required table directly instead of reading sqlite_master", async () => {
    const { service, sql } = createStatusService(() => ({ 1: 1 }));

    const result = await service.getStatus();

    expect(result).toMatchObject({ ok: true });
    expect(sql.some((q) => /sqlite_master/i.test(q))).toBe(false);
    for (const table of REQUIRED_TABLES) {
      expect(sql).toContain(`SELECT 1 FROM "${table}" LIMIT 1`);
    }
    expect(result.ok && result.data).toMatchObject({
      db: "ok",
      r2: "ok",
      ws: "configured",
      crons: "configured",
      r2_reason: null,
      db_checks: Object.fromEntries(REQUIRED_TABLES.map((t) => [t, "ok"])),
    });
  });

  it("reports a genuinely absent table as missing", async () => {
    const { service } = createStatusService((table) => {
      if (table === "site_config") throw new Error("D1_ERROR: no such table: site_config");
      return { 1: 1 };
    });

    const result = await service.getStatus();

    expect(result.ok && result.data.db).toBe("error");
    expect(result.ok && result.data.db_checks.site_config).toBe("missing");
    expect(result.ok && result.data.db_checks.users).toBe("ok");
  });

  // 真故障必须带着原因浮上来，而不是被压成一句没有信息量的 "error"。
  it("surfaces the real reason when a probe fails for any other cause", async () => {
    const { service } = createStatusService((table) => {
      if (table === "roles") throw new Error("D1_ERROR: Network connection lost");
      return { 1: 1 };
    });

    const result = await service.getStatus();

    expect(result.ok && result.data.db).toBe("error");
    expect(result.ok && result.data.db_checks.roles).toBe("error: D1_ERROR: Network connection lost");
  });

  it("surfaces the real reason when the R2 probe fails", async () => {
    const { service } = createStatusService(() => ({ 1: 1 }), () => {
      throw new Error("R2 bucket unreachable");
    });

    const result = await service.getStatus();

    expect(result.ok && result.data.r2).toBe("error");
    expect(result.ok && result.data.r2_reason).toBe("R2 bucket unreachable");
    // R2 掉线不该把 D1 的结论一起拖下水。
    expect(result.ok && result.data.db).toBe("ok");
  });

  // head() 对不存在的对象返回 null 而不抛，这不是故障。
  it("treats a missing healthcheck object as healthy", async () => {
    const { service } = createStatusService(() => ({ 1: 1 }), () => null);

    const result = await service.getStatus();

    expect(result.ok && result.data.r2).toBe("ok");
    expect(result.ok && result.data.r2_reason).toBeNull();
  });
});
