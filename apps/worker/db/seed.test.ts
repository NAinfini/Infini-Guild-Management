import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@guild/shared";
import {
  eventPolls,
  events,
  memberAvailabilityWindows,
  memberProfiles,
  memberProfileVideos,
  recurringTemplateWeekdays,
  recurringTemplates,
  rolePermissions,
  roles,
  siteConfig,
  users,
} from "./schema";

const mocks = vi.hoisted(() => ({
  drizzle: vi.fn(),
  createPasswordHash: vi.fn().mockResolvedValue({ passwordHash: "hash", salt: "salt" }),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: mocks.drizzle,
}));

vi.mock("../services/auth", () => ({
  createPasswordHash: mocks.createPasswordHash,
}));

const { clearAllData, SEED_CLEAR_TABLES, seedDatabase } = await import("./seed");

describe("clearAllData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes every core-schema table in foreign-key-safe order", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const prepare = vi.fn((_statement: string) => ({ run }));

    await clearAllData({ DB: { prepare } } as never);

    expect(prepare.mock.calls.map(([statement]) => statement)).toEqual(
      SEED_CLEAR_TABLES.map((table) => `DELETE FROM ${table}`),
    );
    expect(SEED_CLEAR_TABLES).toEqual([
      "system_test_artifacts",
      "media_links",
      "media_assets",
      "media_variants",
      "storage_transactions",
      "storage_batches",
      "storage_items",
      "storage_categories",
      "storages",
      "wiki_revisions",
      "wiki_articles",
      "wiki_categories",
      "event_poll_votes",
      "event_poll_options",
      "event_polls",
      "event_raffle_winners",
      "event_participants",
      "war_team_members",
      "war_pool_members",
      "war_teams",
      "war_history",
      "recurring_template_class_quotas",
      "recurring_template_weekdays",
      "event_class_quotas",
      "recurring_templates",
      "events",
      "class_tag_members",
      "class_tags",
      "class_catalog",
      "audit_log",
      "error_log",
      "gallery_items",
      "invite_links",
      "announcements",
      "member_badge_assignments",
      "member_badges",
      "member_absences",
      "member_profile_videos",
      "member_profile_classes",
      "member_availability_windows",
      "member_profiles",
      "site_config",
      "system_test_runs",
      "sessions",
      "login_failures",
      "user_auth_password",
      "users",
      "role_permissions",
      "roles",
    ]);
  });

  it("propagates a cleanup failure and stops instead of reporting a partial success", async () => {
    const failure = new Error("foreign key failure");
    const run = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(failure);
    const prepare = vi.fn((_statement: string) => ({ run }));

    await expect(clearAllData({ DB: { prepare } } as never)).rejects.toBe(failure);

    expect(prepare).toHaveBeenCalledTimes(2);
  });
});

describe("seedDatabase schema baselines", () => {
  it("updates the core site-config singleton with explicit demo values", async () => {
    const stopAfterBaseline = new Error("baseline assertions complete");
    const conflictHandlers = new Map<unknown, ReturnType<typeof vi.fn>[]>();
    const seededUserIds: string[] = [];
    const seededRolePermissions: Array<Record<string, unknown>> = [];
    let seededSiteConfig: Record<string, unknown> = {};
    let siteConfigConflictSet: Record<string, unknown> = {};
    const insert = vi.fn((table: unknown) => ({
      values: vi.fn((rows: unknown) => {
        if (table === users && Array.isArray(rows)) {
          seededUserIds.push(...rows.map((row) => (row as { id: string }).id));
        }
        if (table === rolePermissions && Array.isArray(rows)) {
          seededRolePermissions.push(...rows as Array<Record<string, unknown>>);
        }
        if (table === siteConfig) {
          seededSiteConfig = rows as Record<string, unknown>;
        }
        const onConflictDoNothing = vi.fn(async () => undefined);
        const onConflictDoUpdate = vi.fn(async (config: { set: Record<string, unknown> }) => {
          if (table === siteConfig) {
            siteConfigConflictSet = config.set;
            throw stopAfterBaseline;
          }
        });
        const handlers = conflictHandlers.get(table) ?? [];
        handlers.push(onConflictDoNothing);
        conflictHandlers.set(table, handlers);
        return { onConflictDoNothing, onConflictDoUpdate };
      }),
    }));
    const select = vi.fn(() => ({
      from: vi.fn().mockResolvedValue([{ count: 0 }]),
    }));
    mocks.drizzle.mockReturnValue({ insert, select });

    await expect(seedDatabase({ DB: {} } as never)).rejects.toBe(stopAfterBaseline);

    expect(insert).toHaveBeenCalledWith(roles);
    expect(insert).toHaveBeenCalledWith(rolePermissions);
    expect(insert).toHaveBeenCalledWith(users);
    expect(insert).toHaveBeenCalledWith(siteConfig);
    expect(conflictHandlers.get(roles)?.every((handler) => handler.mock.calls.length === 1)).toBe(true);
    expect(conflictHandlers.get(rolePermissions)?.every((handler) => handler.mock.calls.length === 1)).toBe(true);
    expect(conflictHandlers.get(siteConfig)?.every((handler) => handler.mock.calls.length === 0)).toBe(true);
    expect(conflictHandlers.get(users)?.every((handler) => handler.mock.calls.length === 0)).toBe(true);
    expect(seededUserIds.length).toBeGreaterThan(0);
    expect(seededUserIds.every((id) => /^[A-Za-z0-9_-]{21}$/.test(id))).toBe(true);
    expect(seededRolePermissions.every((row) => Object.keys(row).sort().join(",") === "permission,roleId"))
      .toBe(true);
    expect(seededRolePermissions.filter((row) => row.roleId === "admin")).toHaveLength(PERMISSIONS.length);
    expect(seededRolePermissions.filter((row) => row.roleId === "member")).toEqual([
      { roleId: "member", permission: "gallery.upload" },
    ]);
    expect(seededSiteConfig).toMatchObject({
      id: "default",
      siteName: "演示公会",
      featureAnnouncementsEnabled: true,
      mediaClassIconMaxBytes: 512 * 1024,
      mediaProfileImageMaxBytes: 5 * 1024 * 1024,
      storageImagesPerItem: 5,
      absenceMaxSpanDays: 366,
      analyticsKillsWeight: 0.3,
    });
    expect(siteConfigConflictSet).toMatchObject({
      siteName: "演示公会",
      mediaClassIconMaxBytes: 512 * 1024,
      analyticsDistanceWeight: 0.15,
    });
  });

  it("keeps profile videos on the external-video flow", async () => {
    const stopAfterEvents = new Error("profile video assertions complete");
    const profileVideoRows: Array<{ userId: string; url: string; sortOrder: number }> = [];
    const insert = vi.fn((table: unknown) => ({
      values: vi.fn((rows: unknown) => {
        if (table === eventPolls) throw stopAfterEvents;
        if (table === memberProfileVideos) {
          profileVideoRows.push(...rows as typeof profileVideoRows);
        }
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        };
      }),
    }));
    const select = vi.fn(() => ({
      from: vi.fn().mockResolvedValue([{ count: 0 }]),
    }));
    mocks.drizzle.mockReturnValue({ insert, select });

    await expect(seedDatabase({ DB: {} } as never)).rejects.toBe(stopAfterEvents);

    expect(insert).toHaveBeenCalledWith(events);
    expect(profileVideoRows.length).toBeGreaterThan(0);
    expect(profileVideoRows.every((row) => row.url.startsWith("https://") && row.sortOrder === 0)).toBe(true);
  });

  it("seeds normalized availability and recurrence rows without legacy JSON columns", async () => {
    const stopAfterRecurrence = new Error("normalized seed assertions complete");
    const profileRows: Array<Record<string, unknown>> = [];
    const availabilityRows: Array<{ userId: string; weekday: number; startMinute: number; endMinute: number }> = [];
    const templateRows: Array<Record<string, unknown>> = [];
    const weekdayRows: Array<{ templateId: string; weekday: number }> = [];
    const insert = vi.fn((table: unknown) => ({
      values: vi.fn((rows: unknown) => {
        const rowList = Array.isArray(rows) ? rows : [rows];
        if (table === memberProfiles) profileRows.push(...rowList as Array<Record<string, unknown>>);
        if (table === memberAvailabilityWindows) {
          availabilityRows.push(...rowList as typeof availabilityRows);
        }
        if (table === recurringTemplates) templateRows.push(...rowList as Array<Record<string, unknown>>);
        if (table === recurringTemplateWeekdays) {
          weekdayRows.push(...rowList as typeof weekdayRows);
          throw stopAfterRecurrence;
        }
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        };
      }),
    }));
    const select = vi.fn(() => ({
      from: vi.fn().mockResolvedValue([{ count: 0 }]),
    }));
    mocks.drizzle.mockReturnValue({ insert, select });

    await expect(seedDatabase({ DB: {} } as never)).rejects.toBe(stopAfterRecurrence);

    expect(profileRows.length).toBeGreaterThan(0);
    expect(profileRows.every((row) => (
      row.availabilityTimezone === "Asia/Shanghai" && !("availability" in row)
    ))).toBe(true);
    expect(availabilityRows.length).toBeGreaterThan(0);
    expect(availabilityRows.every((row) => (
      Number.isInteger(row.weekday) && row.weekday >= 0 && row.weekday <= 6 &&
      row.startMinute >= 0 && row.endMinute <= 1440 && row.startMinute < row.endMinute
    ))).toBe(true);

    expect(templateRows).toHaveLength(4);
    expect(templateRows.every((row) => (
      !("recurrenceRule" in row) &&
      ["daily", "weekly", "monthly"].includes(String(row.recurrenceFrequency)) &&
      Number(row.recurrenceInterval) > 0
    ))).toBe(true);
    expect(weekdayRows.map((row) => row.weekday).sort()).toEqual([1, 3, 5, 6]);
    expect(new Set(weekdayRows.map((row) => `${row.templateId}:${row.weekday}`)).size)
      .toBe(weekdayRows.length);
  });
});
