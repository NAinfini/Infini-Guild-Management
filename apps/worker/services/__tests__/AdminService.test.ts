import { describe, expect, it, vi } from "vitest";
import { AdminService } from "../AdminService";

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
      equipmentCalc: true,
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

function createService(db: unknown): AdminService {
  const media = {
    get: vi.fn(),
    put: vi.fn(),
    head: vi.fn(),
  };
  return new AdminService({
    db: db as never,
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
}

describe("AdminService role assignment guardrails", () => {
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
      modifier_weights: { kills: 2, assists: 1 },
    });

    expect(result.ok).toBe(true);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      analyticsSettingsJson: JSON.stringify({
        reference_duration_minutes: 60,
        modifier_weights: { kills: 0.6667, assists: 0.3333 },
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
});
