import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventAttachments, eventPolls, events, rolePermissions, roles, siteConfig, users } from "./schema";
import { parseMediaKey } from "../services/media-keys";

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
      "media_upload_leases",
      "media_references",
      "storage_transactions",
      "storage_item_images",
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
      "event_attachments",
      "war_team_members",
      "war_pool_members",
      "war_teams",
      "war_history",
      "recurring_template_class_quotas",
      "recurring_template_attachments",
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
      "member_profile_images",
      "member_profile_classes",
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
  it("ignores default role, permission, and site-config conflicts from the core migration", async () => {
    const stopAfterBaseline = new Error("baseline assertions complete");
    const conflictHandlers = new Map<unknown, ReturnType<typeof vi.fn>[]>();
    const insert = vi.fn((table: unknown) => ({
      values: vi.fn(() => {
        const onConflictDoNothing = vi.fn(async () => {
          if (table === siteConfig) throw stopAfterBaseline;
        });
        const handlers = conflictHandlers.get(table) ?? [];
        handlers.push(onConflictDoNothing);
        conflictHandlers.set(table, handlers);
        return { onConflictDoNothing };
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
    expect(conflictHandlers.get(siteConfig)?.every((handler) => handler.mock.calls.length === 1)).toBe(true);
    expect(conflictHandlers.get(users)?.every((handler) => handler.mock.calls.length === 0)).toBe(true);
  });

  it("does not seed public mock URLs as formal event attachment keys", async () => {
    const stopAfterEvents = new Error("event attachment assertions complete");
    const attachmentRows: Array<{ eventId: string; mediaKey: string }> = [];
    const insert = vi.fn((table: unknown) => ({
      values: vi.fn((rows: unknown) => {
        if (table === eventPolls) throw stopAfterEvents;
        if (table === eventAttachments) {
          attachmentRows.push(...rows as Array<{ eventId: string; mediaKey: string }>);
        }
        return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) };
      }),
    }));
    const select = vi.fn(() => ({
      from: vi.fn().mockResolvedValue([{ count: 0 }]),
    }));
    mocks.drizzle.mockReturnValue({ insert, select });

    await expect(seedDatabase({ DB: {} } as never)).rejects.toBe(stopAfterEvents);

    expect(insert).toHaveBeenCalledWith(events);
    expect(attachmentRows.filter((row) => {
      const parsed = parseMediaKey(row.mediaKey);
      return parsed?.kind !== "event_image" || parsed.entityId !== row.eventId || !parsed.contentType;
    })).toEqual([]);
  });
});
