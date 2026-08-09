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

function siteConfigRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "default",
    siteName: "D1 Guild",
    featureAnnouncementsEnabled: true,
    featureEventsEnabled: true,
    featureGuildWarEnabled: true,
    featureGalleryEnabled: true,
    featureWikiEnabled: true,
    featureToolsEnabled: true,
    featureStorageEnabled: true,
    mediaSiteLogoMaxBytes: 2097152,
    mediaClassIconMaxBytes: 524288,
    mediaProfileImageMaxBytes: 5242880,
    mediaProfileAudioMaxBytes: 20971520,
    mediaAnnouncementImageMaxBytes: 5242880,
    mediaWikiImageMaxBytes: 5242880,
    mediaEventImageMaxBytes: 5242880,
    mediaGalleryImageMaxBytes: 10485760,
    mediaStorageImageMaxBytes: 5242880,
    mediaProfileQuota: 10,
    mediaAnnouncementQuota: 10,
    mediaGalleryQuota: 20,
    mediaWikiQuota: 10,
    storageImagesPerItem: 5,
    absenceMaxSpanDays: 366,
    absenceMaxEntriesPerUser: 20,
    analyticsReferenceDurationMinutes: 30,
    analyticsKillsWeight: 0.3,
    analyticsTowersWeight: 0.1,
    analyticsBaseHpWeight: 0.15,
    analyticsCreditsWeight: 0.3,
    analyticsDistanceWeight: 0.15,
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    ...overrides,
  };
}

function createRawDb() {
  return { batch: vi.fn().mockResolvedValue([]), prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })) };
}

function createMediaService() {
  return {
    listLinkedMedia: vi.fn().mockResolvedValue(new Map()),
    replace: vi.fn().mockResolvedValue(undefined),
  } as never;
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
    mediaService: createMediaService(),
    rawDb: rawDb as never,
    writeAuditLog: vi.fn(),
    writeAuditLogDurable: vi.fn(),
    createPasswordHash: vi.fn(),
    generateId: () => "id-1",
    generateInviteCode: () => "invite-1",
    generateTemporaryPassword: () => "temporary-password",
    now: () => new Date("2026-05-18T00:00:00.000Z"),
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
        roleId: "member",
        roleName: "Member",
        roleColor: "gray",
        roleLevel: 100,
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
        roleId: "member",
        roleName: "Member",
        roleColor: "gray",
        roleLevel: 100,
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
      .mockReturnValueOnce({ from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: listWhere })) })) })
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
      roleId: "member",
      roleName: "Member",
      roleColor: "gray",
      roleLevel: 100,
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
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ roleId: "admin", level: 999 }]) })),
          })),
        })),
      })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ level: 100 }]) })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where })) })) });
    const writeAuditLog = vi.fn();
    const service = new AdminService({
      db: { insert, select } as never,
      media: {} as never,
      mediaService: createMediaService(),
      rawDb: {} as never,
      writeAuditLog,
      writeAuditLogDurable: vi.fn(),
      createPasswordHash: vi.fn(),
      generateId: () => "invite-id-1",
      generateInviteCode: () => "SECRET-INVITE-CODE",
      generateTemporaryPassword: () => "temporary-password",
      now: () => new Date("2026-05-18T00:00:00.000Z"),
      envSiteLogoUrl: "/env-logo.webp",
    });

    await service.createInviteLink("admin-1", "member", 2, null);

    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityId: "invite-id-1",
      diffTitle: "invite-id-1",
    }));
    expect(JSON.stringify(writeAuditLog.mock.calls)).not.toContain("SECRET-INVITE-CODE");
  });

  it("reports seeded admin permissions from database rows without synthesizing missing grants", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          orderBy: vi.fn().mockResolvedValue([{
            id: "admin",
            name: "Admin",
            level: 999,
            color: "red",
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T00:00:00.000Z",
          }]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ roleId: "admin", permission: "admin.users.view" }]),
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
          limit: vi.fn().mockResolvedValue([siteConfigRow({
            analyticsReferenceDurationMinutes: 60,
            analyticsKillsWeight: 0.4,
            analyticsTowersWeight: 0.1,
            analyticsBaseHpWeight: 0.2,
            analyticsCreditsWeight: 0.2,
            analyticsDistanceWeight: 0.1,
          })]),
        })),
      })),
    }));
    const service = new AdminService({
      db: { select } as never,
      media: media as never,
      mediaService: createMediaService(),
      rawDb: { batch: vi.fn(), prepare: vi.fn() } as never,
      writeAuditLog: vi.fn(),
      writeAuditLogDurable: vi.fn(),
      createPasswordHash: vi.fn(),
      generateId: () => "id-1",
      generateInviteCode: () => "invite-1",
      generateTemporaryPassword: () => "temporary-password",
      now: () => new Date("2026-05-18T00:00:00.000Z"),
      envSiteLogoUrl: "/env-logo.webp",
    });

    const result = await service.getAnalyticsSettings();

    expect(result).toEqual({
      ok: true,
      data: {
        reference_duration_minutes: 60,
        modifier_weights: { kills: 0.4, towers: 0.1, base_hp: 0.2, credits: 0.2, distance: 0.1 },
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
          limit: vi.fn().mockResolvedValue([siteConfigRow()]),
        })),
      })),
    }));
    const writeAuditLog = vi.fn();
    const service = new AdminService({
      db: { select, update: vi.fn(() => ({ set })) } as never,
      media: media as never,
      mediaService: createMediaService(),
      rawDb: { batch: vi.fn(), prepare: vi.fn() } as never,
      writeAuditLog,
      writeAuditLogDurable: vi.fn(),
      createPasswordHash: vi.fn(),
      generateId: () => "id-1",
      generateInviteCode: () => "invite-1",
      generateTemporaryPassword: () => "temporary-password",
      now: () => new Date("2026-05-18T00:00:00.000Z"),
      envSiteLogoUrl: "/env-logo.webp",
    });

    const result = await service.updateAnalyticsSettings("admin-1", {
      reference_duration_minutes: 60,
      modifier_weights: { kills: 2, towers: 1, base_hp: 1, credits: 0, distance: 0 },
    });

    expect(result.ok).toBe(true);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      analyticsReferenceDurationMinutes: 60,
      analyticsKillsWeight: 0.5,
      analyticsTowersWeight: 0.25,
      analyticsBaseHpWeight: 0.25,
      analyticsCreditsWeight: 0,
      analyticsDistanceWeight: 0,
    }));
    expect(media.put).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "analytics_settings",
      action: "update",
      actorId: "admin-1",
    }));
  });

  it("blocks assigning a role with any permission the actor does not hold", async () => {
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
            { permission: "admin.users.role" },
          ]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      });
    const service = createService({ select, update });

    const result = await service.updateUserRole("actor-1", "target-1", "role-danger");

    expect(result).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Cannot assign a role with permissions you do not hold: admin.users.role",
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
            { permission: "admin.roles.manage" },
            { permission: "events.create" },
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
          where: vi.fn().mockResolvedValue([{ permission: "events.create" }]),
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

  it("rejects an invite target at the actor's own level", async () => {
    const insert = vi.fn();
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ roleId: "manager", level: 500 }]) })),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ level: 500 }]) })) })),
      });
    const service = createService({ select, insert });

    const result = await service.createInviteLink("actor-1", "peer", 1, null);

    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("applies the same level guard to batch reactivation", async () => {
    const update = vi.fn();
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ roleId: "manager", level: 500 }]) })),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ id: "peer-1", username: "Peer", role: "peer", roleLevel: 500 }]),
          })),
        })),
      });
    const service = createService({ select, update });

    const result = await service.batchReactivate("actor-1", ["peer-1"]);

    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(update).not.toHaveBeenCalled();
  });

  it("does not let an actor raise their own role level", async () => {
    const update = vi.fn();
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: "manager", name: "Manager", level: 500, color: null }]) })) })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ roleId: "manager", level: 500 }]) })),
          })),
        })),
      });
    const service = createService({ select, update });

    const result = await service.updateRole("actor-1", "manager", { level: 501 });

    expect(result).toEqual({ ok: false, code: "VALIDATION_ERROR", message: "Cannot raise the level of your own role" });
    expect(update).not.toHaveBeenCalled();
  });

  it("allows an actor to remove roles.manage from their own role", async () => {
    const rawDb = createRawDb();
    const updatedRole = {
      id: "manager",
      name: "Manager",
      level: 500,
      color: null,
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
    };
    const currentPermissions = [
      { permission: "admin.roles.manage" },
      { permission: "events.create" },
    ];
    const select = vi
      .fn()
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: "manager", name: "Manager", level: 500, color: null }]) })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ roleId: "manager", level: 500 }]) })) })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(currentPermissions) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(currentPermissions) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([updatedRole]) })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ permission: "events.create" }]) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ count: 1 }]) })) })) });
    const service = createService({ select }, rawDb);

    const result = await service.updateRole("actor-1", "manager", {
      permissions: { "admin.roles.manage": false },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.permissions["admin.roles.manage"]).toBe(false);
    expect(rawDb.batch).toHaveBeenCalledTimes(1);
    expect(rawDb.prepare).toHaveBeenCalledWith("DELETE FROM role_permissions WHERE role_id = ?1");
    expect(rawDb.prepare).toHaveBeenCalledWith("INSERT INTO role_permissions (role_id, permission) VALUES (?1, ?2)");
    expect(rawDb.prepare).not.toHaveBeenCalledWith(expect.stringContaining("granted"));
  });

  it("returns CONFLICT before deleting a role referenced by invites", async () => {
    const remove = vi.fn();
    const select = vi
      .fn()
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: "helper", name: "Helper", level: 100 }]) })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ roleId: "manager", level: 500 }]) })) })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ count: 0 }]) })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ count: 2 }]) })) })) });
    const service = createService({ select, delete: remove });

    const result = await service.deleteRole("actor-1", "helper");

    expect(result).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Role is assigned to invite links",
      details: { invite_link_count: 2 },
    });
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("AdminService.createMember reserved system-test username", () => {
  /*
   * System-test cleanup permanently deletes users in this namespace, so an
   * admin-created account must never be able to land in it — the row would
   * be gone with the next cleanup and no warning.
   */
  it("refuses to create an account in the system-test namespace", async () => {
    const select = vi.fn();
    const rawDb = createRawDb();
    const service = createService({ select }, rawDb);

    const result = await service.createMember("admin-1", "systemtest_hijack", "member");

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

    const result = await service.createMember("admin-1", "SystemTest_Hijack", "member");

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
    "member_profile_videos",
    "roles",
    "role_permissions",
    "site_config",
    "class_catalog",
    "class_tags",
    "class_tag_members",
    "events",
    "event_class_quotas",
    "recurring_templates",
    "recurring_template_class_quotas",
    "media_assets",
    "media_variants",
    "media_links",
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
      mediaService: createMediaService(),
      ws: {} as never,
      rawDb: rawDb as never,
      writeAuditLog: vi.fn(),
      writeAuditLogDurable: vi.fn(),
      createPasswordHash: vi.fn(),
      generateId: () => "id-1",
      generateInviteCode: () => "invite-1",
      generateTemporaryPassword: () => "temporary-password",
      now: () => new Date("2026-05-18T00:00:00.000Z"),
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
