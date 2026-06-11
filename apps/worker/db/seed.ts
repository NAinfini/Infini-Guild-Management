import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import {
  announcements,
  auditLog,
  eventPollOptions,
  eventPolls,
  eventPollVotes,
  eventParticipants,
  eventRaffleWinners,
  events,
  galleryItems,
  inviteLinks,
  memberAbsences,
  memberBadgeAssignments,
  memberBadges,
  memberProfileClasses,
  memberProfiles,
  rolePermissions,
  roles,
  recurringTemplates,
  sessions,
  storageCategories,
  storageItems,
  storages,
  storageTransactions,
  userAuthPassword,
  users,
  warHistory,
  warPoolMembers,
  warTeamMembers,
  warTeams,
  wikiArticles,
  wikiCategories,
  gameData,
} from "./schema";
import seedGameData from "@guild/shared/calculator/seed-data.json";
import type { Bindings } from "../index";
import { createPasswordHash } from "../services/auth";

const ALL_TABLES = [
  "storage_transactions",
  "storage_item_images",
  "storage_items",
  "storage_categories",
  "storages",
  "game_data",
  "audit_log",
  "error_log",
  "gallery_items",
  "wiki_articles",
  "wiki_categories",
  "war_pool_members",
  "war_team_members",
  "war_teams",
  "war_history",
  "recurring_templates",
  "event_raffle_winners",
  "event_poll_votes",
  "event_poll_options",
  "event_polls",
  "event_participants",
  "events",
  "invite_links",
  "announcements",
  "member_badge_assignments",
  "member_badges",
  "member_absences",
  "member_profile_classes",
  "member_profiles",
  "sessions",
  "role_permissions",
  "roles",
  "user_auth_password",
  "users",
] as const;

export async function clearAllData(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  for (const table of ALL_TABLES) {
    try {
      await db.run(sql.raw(`DELETE FROM ${table}`));
    } catch {
      // Table may not exist in a fresh or partially-migrated database
    }
  }
}

import { activeGame } from "@guild/shared/games";

const CLASSES = activeGame.classes.map((c) => c.id);

const ROLE_PERMISSION_KEYS = [
  "admin.users.view",
  "admin.users.edit",
  "admin.users.role",
  "admin.users.activate",
  "admin.users.delete",
  "admin.users.password",
  "admin.invite.view",
  "admin.invite.manage",
  "admin.audit.view",
  "admin.audit.export",
  "admin.status.view",
  "admin.roles.view",
  "admin.roles.manage",
  "admin.analytics.view",
  "admin.analytics.manage",
  "guildwar.teams.edit",
  "guildwar.history.edit",
  "events.create",
  "events.edit",
  "events.archive",
  "events.delete",
  "events.templates",
  "announcements.create",
  "announcements.edit",
  "announcements.archive",
  "announcements.delete",
  "gallery.upload",
  "gallery.manage",
  "gallery.delete",
  "wiki.articles.create",
  "wiki.articles.edit",
  "wiki.articles.archive",
  "wiki.articles.delete",
  "wiki.categories.manage",
  "admin.badges.manage",
  "admin.gameData.manage",
] as const;

const MODERATOR_GRANTED_PERMISSIONS = new Set<string>([
  "admin.users.view",
  "admin.users.edit",
  "admin.invite.view",
  "admin.audit.view",
  "admin.status.view",
  "admin.roles.view",
  "admin.analytics.view",
  "guildwar.teams.edit",
  "guildwar.history.edit",
  "events.create",
  "events.edit",
  "events.archive",
  "events.delete",
  "events.templates",
  "announcements.create",
  "announcements.edit",
  "announcements.archive",
  "announcements.delete",
  "gallery.upload",
  "gallery.manage",
  "gallery.delete",
  "wiki.articles.create",
  "wiki.articles.edit",
  "wiki.articles.archive",
  "wiki.articles.delete",
  "wiki.categories.manage",
]);

const MEMBER_GRANTED_PERMISSIONS = new Set<string>(["gallery.upload"]);

function toDate(base: Date | string): Date {
  return base instanceof Date ? new Date(base) : new Date(base);
}

function addDays(base: Date | string, days: number): string {
  const source = toDate(base);
  if (!Number.isFinite(source.getTime())) {
    return new Date().toISOString();
  }

  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

function addHours(base: Date | string, hours: number): string {
  const source = toDate(base);
  if (!Number.isFinite(source.getTime())) {
    return new Date().toISOString();
  }

  const next = new Date(source);
  next.setUTCHours(next.getUTCHours() + hours);
  return next.toISOString();
}

function addMinutes(base: Date | string, minutes: number): string {
  const source = toDate(base);
  if (!Number.isFinite(source.getTime())) {
    return new Date().toISOString();
  }

  const next = new Date(source);
  next.setUTCMinutes(next.getUTCMinutes() + minutes);
  return next.toISOString();
}

function seedMockAsset(kind: "portrait" | "scene", index: number): string {
  return `/mock/${kind}-${(index % 2) + 1}.svg`;
}

function pickClasses(index: number): string[] {
  const first = CLASSES[index % CLASSES.length]!;
  const second = CLASSES[(index + 3) % CLASSES.length]!;
  return [first, second];
}

// D1 has a 100-variable limit per query; chunk large inserts
async function batchInsert<T extends Record<string, unknown>>(
  db: ReturnType<typeof drizzle>,
  table: Parameters<ReturnType<typeof drizzle>["insert"]>[0],
  rows: T[],
  chunkSize = 10,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await (db.insert(table) as any).values(chunk);
  }
}

export async function seedDatabase(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const existingUsers = (
    await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
  )[0]!;

  if (Number(existingUsers.count ?? 0) > 0) {
    return;
  }

  const now = new Date();

  // ════════════════════════════════════════════
  // ── Roles & Permissions ──
  // ════════════════════════════════════════════

  const roleRows: Array<typeof roles.$inferInsert> = [
    { id: "admin", name: "Admin", level: 999, color: "red", isBuiltin: true },
    { id: "moderator", name: "Moderator", level: 500, color: "blue", isBuiltin: true },
    { id: "member", name: "Member", level: 100, color: "gray", isBuiltin: true },
  ];
  await batchInsert(db, roles, roleRows, 3);

  const rolePermissionRows: Array<typeof rolePermissions.$inferInsert> = [];
  for (const permission of ROLE_PERMISSION_KEYS) {
    rolePermissionRows.push({ roleId: "admin", permission, granted: true });
    rolePermissionRows.push({ roleId: "moderator", permission, granted: MODERATOR_GRANTED_PERMISSIONS.has(permission) });
    rolePermissionRows.push({ roleId: "member", permission, granted: MEMBER_GRANTED_PERMISSIONS.has(permission) });
  }
  await batchInsert(db, rolePermissions, rolePermissionRows, 15);

  // ════════════════════════════════════════════
  // ── Users ──
  // ════════════════════════════════════════════

  const adminId = nanoid();
  const moderatorIds = Array.from({ length: 3 }, () => nanoid());
  const memberIds = Array.from({ length: 15 }, () => nanoid());

  const userRows: Array<typeof users.$inferInsert> = [
    {
      id: adminId,
      username: "admin",
      role: "admin",
      isActive: true,
      deletedAt: null,
    },
    ...moderatorIds.map((id, index) => ({
      id,
      username: `mod_${index + 1}`,
      role: "moderator" as const,
      isActive: index !== 2,
      deletedAt: null,
    })),
    ...memberIds.map((id, index) => ({
      id,
      username: `member_${String(index + 1).padStart(2, "0")}`,
      role: "member" as const,
      isActive: index !== 13,
      deletedAt: null,
    })),
  ];

  await batchInsert(db, users, userRows);

  const passwords = new Map<string, string>([
    [adminId, "admin123"],
    ...moderatorIds.map((id, index) => [id, `moderator${index + 1}23`] as const),
    ...memberIds.map((id, index) => [id, `member${index + 1}234`] as const),
  ]);

  const passwordRows: Array<typeof userAuthPassword.$inferInsert> = [];
  for (const [userId, plainPassword] of passwords) {
    const hash = await createPasswordHash(plainPassword);
    passwordRows.push({
      userId,
      passwordHash: hash.passwordHash,
      salt: hash.salt,
    });
  }
  await batchInsert(db, userAuthPassword, passwordRows);

  // ════════════════════════════════════════════
  // ── Member Profiles ──
  // ════════════════════════════════════════════

  const profileRows: Array<typeof memberProfiles.$inferInsert> = [];
  for (let index = 0; index < memberIds.length; index += 1) {
    const userId = memberIds[index]!;
    const onVacation = index === 5 || index === 11;
    const profileImages = index % 4 === 3 ? [] : [seedMockAsset("portrait", index)];
    const profileVideos = index % 6 === 0 ? ["https://www.youtube.com/watch?v=aqz-KE-bpKQ"] : [];
    profileRows.push({
      id: nanoid(),
      userId,
      power: 3000 + index * 120,
      classes: JSON.stringify(pickClasses(index)),
      titleHtml: `<p>Seed Title ${index + 1}</p>`,
      bio: `Seed profile for member ${index + 1}`,
      images: JSON.stringify(profileImages),
      audioKey: null,
      videoUrls: JSON.stringify(profileVideos),
      availability: JSON.stringify({
        weekdayEvening: index % 2 === 0,
        weekendAfternoon: index % 3 === 0,
        guildWarNight: index % 4 !== 0,
      }),
      vacationStart: null,
      vacationEnd: null,
      notes: index % 5 === 0 ? "High priority member" : onVacation ? "Vacation scheduled" : null,
    });
  }

  const moderatorProfileRows: Array<typeof memberProfiles.$inferInsert> = moderatorIds.map((id, index) => ({
    id: nanoid(),
    userId: id,
    power: 6000 + index * 500,
    classes: JSON.stringify(pickClasses(index + 5)),
    titleHtml: `<p>Moderator ${index + 1}</p>`,
    bio: `Seed profile for moderator ${index + 1}`,
    images: JSON.stringify([seedMockAsset("portrait", index + 20)]),
    audioKey: null,
    videoUrls: JSON.stringify(index === 0 ? ["https://www.youtube.com/watch?v=aqz-KE-bpKQ"] : []),
    availability: JSON.stringify({ weekdayEvening: true, weekendAfternoon: true, guildWarNight: true }),
    vacationStart: null,
    vacationEnd: null,
    notes: index === 0 ? "Lead moderator" : null,
  }));

  const allProfileRows = [
    {
      id: nanoid(),
      userId: adminId,
      power: 9999,
      classes: JSON.stringify(["鸣金虹"]),
      titleHtml: "<p>Guild Leader</p>",
      bio: "Seeded admin profile",
      images: JSON.stringify([seedMockAsset("portrait", 99)]),
      audioKey: null,
      videoUrls: JSON.stringify(["https://www.youtube.com/watch?v=aqz-KE-bpKQ"]),
      availability: JSON.stringify({ all_day: true }),
      vacationStart: null,
      vacationEnd: null,
      notes: "seed-admin",
    },
    ...moderatorProfileRows,
    ...profileRows,
  ];
  await batchInsert(db, memberProfiles, allProfileRows, 5);

  // Absence history (请假) — one current, one upcoming, one past entry.
  const absenceRows: Array<typeof memberAbsences.$inferInsert> = [
    { id: nanoid(), userId: memberIds[5]!, startDate: addDays(now, -1).slice(0, 10), endDate: addDays(now, 3).slice(0, 10), note: "Seed: current absence" },
    { id: nanoid(), userId: memberIds[11]!, startDate: addDays(now, 7).slice(0, 10), endDate: addDays(now, 14).slice(0, 10), note: "Seed: upcoming absence" },
    { id: nanoid(), userId: memberIds[5]!, startDate: addDays(now, -30).slice(0, 10), endDate: addDays(now, -25).slice(0, 10), note: null },
  ];
  await batchInsert(db, memberAbsences, absenceRows);
  await batchInsert(
    db,
    memberProfileClasses,
    allProfileRows.flatMap((profile) => {
      const classNames = JSON.parse(profile.classes ?? "[]") as string[];
      return [...new Set(classNames)].map((className) => ({ userId: profile.userId, className }));
    }),
    10,
  );

  // ════════════════════════════════════════════
  // ── Member Badges ──
  // ════════════════════════════════════════════

  const badgeRows: Array<typeof memberBadges.$inferInsert> = [
    {
      id: nanoid(),
      name: "Veteran",
      labelHtml: "<b>Veteran</b>",
      color: "#f59e0b",
      description: "Awarded to members who have been with the guild for over a year",
      sortOrder: 0,
    },
    {
      id: nanoid(),
      name: "War Hero",
      labelHtml: "<b>War Hero</b>",
      color: "#ef4444",
      description: "Awarded for outstanding performance in guild wars",
      sortOrder: 1,
    },
    {
      id: nanoid(),
      name: "Top Contributor",
      labelHtml: "<b>Top Contributor</b>",
      color: "#3b82f6",
      description: "Active contributor to guild wiki and gallery",
      sortOrder: 2,
    },
    {
      id: nanoid(),
      name: "Event MVP",
      labelHtml: "<b>Event MVP</b>",
      color: "#8b5cf6",
      description: "Most valuable participant in guild events",
      sortOrder: 3,
    },
  ];
  await batchInsert(db, memberBadges, badgeRows, 4);

  const badgeAssignmentRows: Array<typeof memberBadgeAssignments.$inferInsert> = [
    // Veteran badge - admin, all mods, and first 5 members
    ...([adminId, ...moderatorIds, ...memberIds.slice(0, 5)].map((userId) => ({
      badgeId: badgeRows[0]!.id,
      userId,
      assignedBy: adminId,
      assignedAt: addDays(now, -30),
    }))),
    // War Hero - top performers
    { badgeId: badgeRows[1]!.id, userId: memberIds[0]!, assignedBy: adminId, assignedAt: addDays(now, -14) },
    { badgeId: badgeRows[1]!.id, userId: memberIds[2]!, assignedBy: adminId, assignedAt: addDays(now, -14) },
    { badgeId: badgeRows[1]!.id, userId: moderatorIds[0]!, assignedBy: adminId, assignedAt: addDays(now, -14) },
    // Top Contributor - active wiki/gallery users
    { badgeId: badgeRows[2]!.id, userId: memberIds[1]!, assignedBy: moderatorIds[0]!, assignedAt: addDays(now, -7) },
    { badgeId: badgeRows[2]!.id, userId: memberIds[4]!, assignedBy: moderatorIds[0]!, assignedAt: addDays(now, -7) },
    // Event MVP
    { badgeId: badgeRows[3]!.id, userId: memberIds[3]!, assignedBy: moderatorIds[1]!, assignedAt: addDays(now, -3) },
  ];
  await batchInsert(db, memberBadgeAssignments, badgeAssignmentRows);

  // ════════════════════════════════════════════
  // ── Events ──
  // ════════════════════════════════════════════

  const openPollEventId = nanoid();
  const hiddenPollEventId = nanoid();
  const closedPollEventId = nanoid();
  const openPollOptionIds = Array.from({ length: 4 }, () => nanoid());
  const hiddenPollOptionIds = Array.from({ length: 3 }, () => nanoid());
  const closedPollOptionIds = Array.from({ length: 3 }, () => nanoid());

  const drawnRaffleEventId = nanoid();
  const pendingRaffleEventId = nanoid();

  const eventRows: Array<typeof events.$inferInsert> = [
    // [0] weekly_mission - future, pinned, with attachments
    {
      id: nanoid(),
      type: "weekly_mission",
      title: "Weekly Mission Alpha",
      description: "Primary weekly mission",
      startAt: addDays(now, 1),
      endAt: addDays(addHours(now, 2), 1),
      capacity: 10,
      pinned: true,
      signupLocked: false,
      archivedAt: null,
      createdBy: adminId,
      updatedBy: null,
      attachments: JSON.stringify(["/mock/scene-1.svg", "/mock/scene-2.svg"]),
      seriesId: null,
      instanceDate: null,
    },
    // [1] weekly_mission - future, updated by mod
    {
      id: nanoid(),
      type: "weekly_mission",
      title: "Weekly Mission Beta",
      description: "Secondary weekly mission - updated by mod",
      startAt: addDays(now, 3),
      endAt: addDays(addHours(now, 2), 3),
      capacity: 12,
      pinned: false,
      signupLocked: false,
      archivedAt: null,
      createdBy: adminId,
      updatedBy: moderatorIds[0]!,
      seriesId: null,
      instanceDate: null,
    },
    // [2] guild_war - active future war #1
    {
      id: nanoid(),
      type: "guild_war",
      title: "Guild War #1",
      description: "Seed guild war",
      startAt: addDays(now, 5),
      endAt: addDays(addHours(now, 3), 5),
      capacity: 20,
      pinned: true,
      signupLocked: false,
      archivedAt: null,
      createdBy: adminId,
      updatedBy: null,
      attachments: JSON.stringify(["/mock/portrait-1.svg"]),
      seriesId: null,
      instanceDate: null,
    },
    // [3] guild_war - active future war #2, updated
    {
      id: nanoid(),
      type: "guild_war",
      title: "Guild War #2",
      description: "Second seed guild war",
      startAt: addDays(now, 12),
      endAt: addDays(addHours(now, 3), 12),
      capacity: 20,
      pinned: false,
      signupLocked: false,
      archivedAt: null,
      createdBy: adminId,
      updatedBy: moderatorIds[1]!,
      seriesId: null,
      instanceDate: null,
    },
    // [4] social - future
    {
      id: nanoid(),
      type: "social",
      title: "Guild Social Night",
      description: "Relaxed social event",
      startAt: addDays(now, 2),
      endAt: addDays(addHours(now, 2), 2),
      capacity: null,
      pinned: false,
      signupLocked: false,
      archivedAt: null,
      createdBy: adminId,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
    // [5] social - future, created by mod
    {
      id: nanoid(),
      type: "social",
      title: "Movie Night",
      description: "Watch together event - no signup needed",
      startAt: addDays(now, 4),
      endAt: addDays(addHours(now, 3), 4),
      capacity: null,
      pinned: false,
      signupLocked: false,
      archivedAt: null,
      createdBy: moderatorIds[1]!,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
    // [6] weekly_mission - archived (past)
    {
      id: nanoid(),
      type: "weekly_mission",
      title: "Archived Weekly Mission",
      description: "This event was archived after completion",
      startAt: addDays(now, -14),
      endAt: addDays(addHours(now, 2), -14),
      capacity: 15,
      pinned: false,
      signupLocked: false,
      archivedAt: addDays(now, -7),
      createdBy: moderatorIds[0]!,
      updatedBy: adminId,
      seriesId: null,
      instanceDate: null,
    },
    // [7] guild_war - ARCHIVED war (past, finished)
    {
      id: nanoid(),
      type: "guild_war",
      title: "Archived War Event",
      description: "Old war that finished - still accessible for history entry",
      startAt: addDays(now, -21),
      endAt: addDays(addHours(now, 3), -21),
      capacity: 20,
      pinned: false,
      signupLocked: true,
      archivedAt: addDays(now, -14),
      createdBy: adminId,
      updatedBy: moderatorIds[0]!,
      seriesId: null,
      instanceDate: null,
    },
    // [8] other - locked signup
    {
      id: nanoid(),
      type: "other",
      title: "Locked Recruitment Drive",
      description: "Signup is locked - mod-only additions",
      startAt: addDays(now, 6),
      endAt: addDays(addHours(now, 4), 6),
      capacity: 5,
      pinned: true,
      signupLocked: true,
      archivedAt: null,
      createdBy: moderatorIds[2]!,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
    // [9] social - near-full capacity
    {
      id: nanoid(),
      type: "social",
      title: "PvP Training Session",
      description: "Practice session with full capacity",
      startAt: addDays(now, 8),
      endAt: addDays(addHours(now, 2), 8),
      capacity: 2,
      pinned: false,
      signupLocked: false,
      archivedAt: null,
      createdBy: moderatorIds[0]!,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
    // [10] weekly_mission - past, not archived
    {
      id: nanoid(),
      type: "weekly_mission",
      title: "Past Mission - Completed",
      description: "Already happened last week",
      startAt: addDays(now, -7),
      endAt: addDays(addHours(now, 2), -7),
      capacity: 10,
      pinned: false,
      signupLocked: false,
      archivedAt: null,
      createdBy: adminId,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
    // [11] guild_war - far future
    {
      id: nanoid(),
      type: "guild_war",
      title: "Guild War #3 - Far Future",
      description: "Scheduled far out",
      startAt: addDays(now, 30),
      endAt: addDays(addHours(now, 3), 30),
      capacity: 25,
      pinned: false,
      signupLocked: false,
      archivedAt: null,
      createdBy: moderatorIds[1]!,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
    // [12] other - no end time
    {
      id: nanoid(),
      type: "other",
      title: "No-End-Time Event",
      description: "Open-ended event with no end time",
      startAt: addDays(now, 9),
      endAt: null,
      capacity: null,
      pinned: false,
      signupLocked: false,
      archivedAt: null,
      createdBy: adminId,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
    // [13] social - archived, old
    {
      id: nanoid(),
      type: "social",
      title: "Archived Social - Old",
      description: "Happened months ago",
      startAt: addDays(now, -60),
      endAt: addDays(addHours(now, 2), -60),
      capacity: 50,
      pinned: false,
      signupLocked: false,
      archivedAt: addDays(now, -55),
      createdBy: moderatorIds[0]!,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
    // [14] poll - open, results after vote
    {
      id: openPollEventId,
      type: "poll",
      title: "Poll: Next Activity",
      description: "Vote for the next activity. Results are visible after voting.",
      startAt: addHours(now, -1),
      endAt: addDays(now, 2),
      capacity: null,
      pinned: true,
      signupLocked: true,
      archivedAt: null,
      createdBy: moderatorIds[0]!,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
    // [15] poll - hidden results until close
    {
      id: hiddenPollEventId,
      type: "poll",
      title: "Poll: War Prep Window",
      description: "Private-name poll with results visible only after the poll closes.",
      startAt: addHours(now, -2),
      endAt: addDays(now, 4),
      capacity: null,
      pinned: false,
      signupLocked: true,
      archivedAt: null,
      createdBy: adminId,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
    // [16] poll - closed
    {
      id: closedPollEventId,
      type: "poll",
      title: "Poll: Closed Example",
      description: "Closed poll with final results visible.",
      startAt: addDays(now, -5),
      endAt: addDays(now, -2),
      capacity: null,
      pinned: false,
      signupLocked: true,
      archivedAt: null,
      createdBy: moderatorIds[1]!,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
    // [17] raffle - drawn (ended, winners selected)
    {
      id: drawnRaffleEventId,
      type: "raffle",
      title: "Raffle: VIP Package Giveaway",
      description: "3 lucky winners will receive a VIP package! Winners have been drawn.",
      startAt: addDays(now, -3),
      endAt: addDays(now, -1),
      capacity: null,
      pinned: false,
      signupLocked: true,
      archivedAt: null,
      createdBy: adminId,
      updatedBy: adminId,
      seriesId: null,
      instanceDate: null,
      winnerCount: 3,
    },
    // [18] raffle - pending (still open for signup)
    {
      id: pendingRaffleEventId,
      type: "raffle",
      title: "Raffle: Weekly Gem Draw",
      description: "Sign up for a chance to win gems! Drawing happens when the event ends.",
      startAt: addHours(now, -2),
      endAt: addDays(now, 3),
      capacity: 20,
      pinned: true,
      signupLocked: false,
      archivedAt: null,
      createdBy: moderatorIds[0]!,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
      winnerCount: 2,
    },
    // [19] other - auto-archive enabled, past end
    {
      id: nanoid(),
      type: "other",
      title: "Auto-Archive Demo",
      description: "Event with auto-archive enabled that has ended",
      startAt: addDays(now, -5),
      endAt: addDays(now, -3),
      capacity: 8,
      pinned: false,
      signupLocked: false,
      autoArchive: true,
      archivedAt: null,
      createdBy: adminId,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
    // [20] guild_war - second archived war (to test multiple archived wars in dropdown)
    {
      id: nanoid(),
      type: "guild_war",
      title: "Archived War Event #2",
      description: "Another old war that finished - history entry pending",
      startAt: addDays(now, -35),
      endAt: addDays(addHours(now, 3), -35),
      capacity: 20,
      pinned: false,
      signupLocked: true,
      archivedAt: addDays(now, -28),
      createdBy: adminId,
      updatedBy: null,
      seriesId: null,
      instanceDate: null,
    },
  ];

  await batchInsert(db, events, eventRows, 3);

  // ════════════════════════════════════════════
  // ── Event Polls ──
  // ════════════════════════════════════════════

  await batchInsert(db, eventPolls, [
    {
      eventId: openPollEventId,
      resultsVisibility: "after_vote",
      showVoterNames: true,
      createdAt: addHours(now, -1),
      updatedAt: addHours(now, -1),
    },
    {
      eventId: hiddenPollEventId,
      resultsVisibility: "after_close",
      showVoterNames: false,
      createdAt: addHours(now, -2),
      updatedAt: addHours(now, -2),
    },
    {
      eventId: closedPollEventId,
      resultsVisibility: "after_close",
      showVoterNames: true,
      createdAt: addDays(now, -5),
      updatedAt: addDays(now, -2),
    },
  ], 3);

  const pollOptionRows: Array<typeof eventPollOptions.$inferInsert> = [
    ...["Guild War Practice", "Weekly Mission", "PvP Training", "Social Night"].map((label, index) => ({
      id: openPollOptionIds[index]!,
      eventId: openPollEventId,
      label,
      sortOrder: index,
      createdAt: addHours(now, -1),
    })),
    ...["Friday Night", "Saturday Afternoon", "Sunday Evening"].map((label, index) => ({
      id: hiddenPollOptionIds[index]!,
      eventId: hiddenPollEventId,
      label,
      sortOrder: index,
      createdAt: addHours(now, -2),
    })),
    ...["Raid Review", "Arena Scrims", "Build Workshop"].map((label, index) => ({
      id: closedPollOptionIds[index]!,
      eventId: closedPollEventId,
      label,
      sortOrder: index,
      createdAt: addDays(now, -5),
    })),
  ];
  await batchInsert(db, eventPollOptions, pollOptionRows, 6);

  const pollVoteRows: Array<typeof eventPollVotes.$inferInsert> = [
    ...memberIds.slice(0, 8).map((userId, index) => ({
      id: nanoid(),
      eventId: openPollEventId,
      optionId: openPollOptionIds[index % openPollOptionIds.length]!,
      userId,
      createdAt: addMinutes(now, -120 + index),
    })),
    ...memberIds.slice(2, 6).map((userId, index) => ({
      id: nanoid(),
      eventId: openPollEventId,
      optionId: openPollOptionIds[(index + 1) % openPollOptionIds.length]!,
      userId,
      createdAt: addMinutes(now, -90 + index),
    })),
    ...memberIds.slice(0, 9).map((userId, index) => ({
      id: nanoid(),
      eventId: hiddenPollEventId,
      optionId: hiddenPollOptionIds[index % hiddenPollOptionIds.length]!,
      userId,
      createdAt: addMinutes(now, -180 + index),
    })),
    ...memberIds.slice(0, 10).map((userId, index) => ({
      id: nanoid(),
      eventId: closedPollEventId,
      optionId: closedPollOptionIds[index % closedPollOptionIds.length]!,
      userId,
      createdAt: addDays(now, -4),
    })),
  ];
  await batchInsert(db, eventPollVotes, pollVoteRows, 8);

  // ════════════════════════════════════════════
  // ── Event Participants ──
  // ════════════════════════════════════════════

  const raffleEventIds = new Set([drawnRaffleEventId, pendingRaffleEventId]);
  const participantRows: Array<typeof eventParticipants.$inferInsert> = [];
  for (const event of eventRows) {
    if (event.type === "poll" || raffleEventIds.has(event.id)) {
      continue;
    }
    const count = event.archivedAt ? 3 : 6;
    for (const userId of memberIds.slice(0, count)) {
      participantRows.push({
        id: nanoid(),
        eventId: event.id,
        userId,
        joinedAt: addMinutes(now, participantRows.length),
      });
    }
  }
  // Add moderators to some non-raffle events
  for (const event of eventRows.slice(0, 5)) {
    if (event.type === "poll" || raffleEventIds.has(event.id)) {
      continue;
    }
    for (const modId of moderatorIds) {
      participantRows.push({
        id: nanoid(),
        eventId: event.id,
        userId: modId,
        joinedAt: addMinutes(now, participantRows.length),
      });
    }
  }

  // Raffle participants: drawn raffle gets 8 members who could win
  for (const userId of memberIds.slice(0, 8)) {
    participantRows.push({
      id: nanoid(),
      eventId: drawnRaffleEventId,
      userId,
      joinedAt: addMinutes(addDays(now, -3), participantRows.length % 60),
    });
  }
  // Pending raffle gets 10 active signups
  for (const userId of memberIds.slice(0, 10)) {
    participantRows.push({
      id: nanoid(),
      eventId: pendingRaffleEventId,
      userId,
      joinedAt: addMinutes(addHours(now, -1), participantRows.length % 60),
    });
  }

  await batchInsert(db, eventParticipants, participantRows);

  // ── Raffle winners (drawn raffle) ──
  const raffleWinnerRows: Array<typeof eventRaffleWinners.$inferInsert> = [
    { id: nanoid(), eventId: drawnRaffleEventId, userId: memberIds[0]!, drawnAt: addDays(now, -1) },
    { id: nanoid(), eventId: drawnRaffleEventId, userId: memberIds[2]!, drawnAt: addDays(now, -1) },
    { id: nanoid(), eventId: drawnRaffleEventId, userId: memberIds[4]!, drawnAt: addDays(now, -1) },
  ];
  await batchInsert(db, eventRaffleWinners, raffleWinnerRows, 3);

  // ════════════════════════════════════════════
  // ── Recurring Templates ──
  // ════════════════════════════════════════════

  const recurringTemplateRows: Array<typeof recurringTemplates.$inferInsert> = [
    {
      id: nanoid(),
      type: "weekly_mission",
      title: "每周副本",
      description: "每周固定副本活动，全员参与",
      startTime: "04:00",
      durationMinutes: 120,
      capacity: 10,
      recurrenceRule: JSON.stringify({ frequency: "weekly", interval: 1, daysOfWeek: [1, 3, 5] }),
      visibilityOffsetMinutes: 1440,
      autoArchive: true,
      paused: false,
      createdBy: adminId,
      lastGeneratedDate: addDays(now, -1).slice(0, 10),
      generationCount: 12,
      createdAt: addDays(now, -90),
      updatedAt: addDays(now, -1),
    },
    {
      id: nanoid(),
      type: "guild_war",
      title: "公会战",
      description: "每周公会战，需提前报名",
      startTime: "04:30",
      durationMinutes: 180,
      capacity: 20,
      recurrenceRule: JSON.stringify({ frequency: "weekly", interval: 1, daysOfWeek: [6] }),
      visibilityOffsetMinutes: 10080,
      autoArchive: false,
      paused: false,
      createdBy: adminId,
      lastGeneratedDate: addDays(now, -3).slice(0, 10),
      generationCount: 8,
      createdAt: addDays(now, -60),
      updatedAt: addDays(now, -3),
    },
    {
      id: nanoid(),
      type: "social",
      title: "Daily Check-in",
      description: "Daily social gathering",
      startTime: "05:00",
      durationMinutes: 60,
      capacity: null,
      recurrenceRule: JSON.stringify({ frequency: "daily", interval: 1 }),
      visibilityOffsetMinutes: 0,
      autoArchive: true,
      paused: false,
      createdBy: moderatorIds[0]!,
      lastGeneratedDate: addDays(now, -1).slice(0, 10),
      generationCount: 30,
      createdAt: addDays(now, -30),
      updatedAt: addDays(now, -1),
    },
    {
      id: nanoid(),
      type: "other",
      title: "月度总结会",
      description: "每月一次的公会总结会议",
      startTime: "03:00",
      durationMinutes: 90,
      capacity: null,
      recurrenceRule: JSON.stringify({ frequency: "monthly", interval: 1, dayOfMonth: 1 }),
      visibilityOffsetMinutes: 4320,
      autoArchive: false,
      paused: true,
      createdBy: adminId,
      lastGeneratedDate: addDays(now, -35).slice(0, 10),
      generationCount: 3,
      createdAt: addDays(now, -120),
      updatedAt: addDays(now, -35),
    },
  ];
  await batchInsert(db, recurringTemplates, recurringTemplateRows, 4);

  // ════════════════════════════════════════════
  // ── Announcements ──
  // ════════════════════════════════════════════

  await db.insert(announcements).values([
    {
      id: nanoid(),
      title: "Welcome to Infini Guild",
      bodyJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Welcome!" }] }] }),
      pinned: true,
      status: "published",
      publishAt: now.toISOString(),
      expiresAt: null,
      archivedAt: null,
      createdBy: adminId,
      updatedBy: null,
    },
    {
      id: nanoid(),
      title: "Next War Prep",
      bodyJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Prepare your builds." }] }] }),
      pinned: false,
      status: "draft",
      publishAt: null,
      expiresAt: null,
      archivedAt: null,
      createdBy: moderatorIds[0]!,
      updatedBy: null,
    },
    {
      id: nanoid(),
      title: "Scheduled Announcement",
      bodyJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Auto publish soon." }] }] }),
      pinned: false,
      status: "scheduled",
      publishAt: addHours(now, 3),
      expiresAt: null,
      archivedAt: null,
      createdBy: moderatorIds[1]!,
      updatedBy: null,
    },
    {
      id: nanoid(),
      title: "Retired Raid Rotation",
      bodyJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Archived for historical reference." }] }] }),
      pinned: false,
      status: "archived",
      publishAt: addDays(now, -21),
      expiresAt: addDays(now, -7),
      archivedAt: addDays(now, -6),
      createdBy: adminId,
      updatedBy: moderatorIds[0]!,
    },
  ]);

  // ════════════════════════════════════════════
  // ── Guild War History ──
  // ════════════════════════════════════════════

  const warHistoryRows: Array<typeof warHistory.$inferInsert> = [
    {
      id: nanoid(),
      eventId: eventRows[2]!.id,
      warName: "War Session A",
      enemyName: "Shadow Legion",
      result: "win",
      ownStats: { kills: 38, towers: 6, base_hp: 72, credits: 12800, distance: 4800 },
      enemyStats: { kills: 27, towers: 3, base_hp: 0, credits: 9300, distance: 3900 },
      durationMinutes: 42,
      notes: "Solid frontline execution",
      createdBy: adminId,
      updatedBy: null,
    },
    {
      id: nanoid(),
      eventId: eventRows[3]!.id,
      warName: "War Session B",
      enemyName: "Iron Vanguard",
      result: "loss",
      ownStats: { kills: 24, towers: 2, base_hp: 0, credits: 8700, distance: 3200 },
      enemyStats: { kills: 34, towers: 5, base_hp: 55, credits: 12100, distance: 4600 },
      durationMinutes: 55,
      notes: "Need better split control",
      createdBy: moderatorIds[0]!,
      updatedBy: null,
    },
    {
      id: nanoid(),
      eventId: eventRows[7]!.id,
      warName: "War Session C",
      enemyName: "Crimson Tide",
      result: "win",
      ownStats: { kills: 42, towers: 7, base_hp: 58, credits: 14200, distance: 5100 },
      enemyStats: { kills: 31, towers: 4, base_hp: 0, credits: 10500, distance: 4200 },
      durationMinutes: 38,
      notes: "Clean sweep - great coordination",
      createdBy: adminId,
      updatedBy: moderatorIds[0]!,
    },
    {
      id: nanoid(),
      eventId: eventRows[11]!.id,
      warName: "War Session D",
      enemyName: "Frost Reapers",
      result: "draw",
      ownStats: { kills: 30, towers: 4, base_hp: 35, credits: 11000, distance: 4400 },
      enemyStats: { kills: 29, towers: 4, base_hp: 38, credits: 10800, distance: 4350 },
      durationMinutes: 60,
      notes: "Extremely close match, towers tied",
      createdBy: moderatorIds[1]!,
      updatedBy: null,
    },
    // War Session E - linked to second archived war event [20]
    {
      id: nanoid(),
      eventId: eventRows[20]!.id,
      warName: "War Session E",
      enemyName: "Storm Vanguard",
      result: "win",
      ownStats: { kills: 35, towers: 5, base_hp: 60, credits: 13000, distance: 4700 },
      enemyStats: { kills: 28, towers: 3, base_hp: 0, credits: 9800, distance: 4000 },
      durationMinutes: 45,
      notes: "Older match - good for history browsing",
      createdBy: adminId,
      updatedBy: null,
    },
  ];
  await db.insert(warHistory).values(warHistoryRows);

  for (const [index, history] of warHistoryRows.entries()) {
    const teamAId = nanoid();
    const teamBId = nanoid();

    await db.insert(warTeams).values([
      {
        id: teamAId,
        warHistoryId: history.id,
        teamName: "Alpha Team",
        sortOrder: 0,
        notes: null,
        isLocked: false,
      },
      {
        id: teamBId,
        warHistoryId: history.id,
        teamName: "Bravo Team",
        sortOrder: 1,
        notes: null,
        isLocked: false,
      },
    ]);

    const assigned = memberIds.slice(index * 3, index * 3 + 8);
    const teamMemberRows: Array<typeof warTeamMembers.$inferInsert> = [];
    assigned.forEach((userId, memberIndex) => {
      const base = memberIndex + index * 2 + 3;
      teamMemberRows.push({
        id: nanoid(),
        warTeamId: memberIndex < 4 ? teamAId : teamBId,
        userId,
        roleTag: memberIndex % 2 === 0 ? "core" : "flex",
        sortOrder: memberIndex,
        stats: {
          kills: base * 4 + (memberIndex % 3),
          deaths: Math.max(1, base - (memberIndex % 2)),
          assists: base * 6 + (memberIndex % 5),
          damage: base * 15000 + memberIndex * 2000,
          healing: base * 8000 + memberIndex * 1500,
          building_damage: base * 5000 + memberIndex * 1000,
          credits: base * 1200 + memberIndex * 200,
          damage_taken: base * 12000 + memberIndex * 1800,
        },
      });
    });

    await batchInsert(db, warTeamMembers, teamMemberRows, 4);

    await db.insert(warPoolMembers).values(
      memberIds.slice(10, 13).map((userId) => ({
        id: nanoid(),
        warHistoryId: history.id,
        userId,
      })),
    );
  }

  // ════════════════════════════════════════════
  // ── Wiki ──
  // ════════════════════════════════════════════

  const categoryRows: Array<typeof wikiCategories.$inferInsert> = [
    { id: nanoid(), name: "General", slug: "general", sortOrder: 0, parentId: null },
    { id: nanoid(), name: "Builds", slug: "builds", sortOrder: 1, parentId: null },
    { id: nanoid(), name: "War", slug: "war", sortOrder: 2, parentId: null },
  ];
  const subCategoryRows: Array<typeof wikiCategories.$inferInsert> = [
    { id: nanoid(), name: "FAQ", slug: "faq", sortOrder: 0, parentId: categoryRows[0]!.id },
    { id: nanoid(), name: "DPS Builds", slug: "dps-builds", sortOrder: 0, parentId: categoryRows[1]!.id },
    { id: nanoid(), name: "Support Builds", slug: "support-builds", sortOrder: 1, parentId: categoryRows[1]!.id },
    { id: nanoid(), name: "Offense", slug: "war-offense", sortOrder: 0, parentId: categoryRows[2]!.id },
    { id: nanoid(), name: "Defense", slug: "war-defense", sortOrder: 1, parentId: categoryRows[2]!.id },
  ];
  await db.insert(wikiCategories).values([...categoryRows, ...subCategoryRows]);

  const tiptap = (...blocks: unknown[]) => JSON.stringify({ type: "doc", content: blocks });
  const heading = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
  const para = (...parts: unknown[]) => ({ type: "paragraph", content: parts });
  const txt = (text: string) => ({ type: "text", text });
  const bold = (text: string) => ({ type: "text", marks: [{ type: "bold" }], text });
  const italic = (text: string) => ({ type: "text", marks: [{ type: "italic" }], text });
  const bulletList = (...items: string[]) => ({
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text: item }] }],
    })),
  });

  const articleRows: Array<typeof wikiArticles.$inferInsert> = [
    {
      id: nanoid(),
      title: "Getting Started",
      slug: "getting-started",
      categoryId: categoryRows[0]!.id,
      bodyJson: tiptap(
        heading(1, "Welcome to Infini Guild"),
        para(txt("This guide covers everything you need to know as a new member. Read through each section carefully.")),
        heading(2, "First Steps"),
        bulletList("Set up your profile with your in-game name and class", "Check the events page for upcoming activities", "Review the war rotation schedule", "Set your availability so officers can plan events"),
        para(bold("Important:"), txt(" Make sure to set your availability in your profile so officers can plan events.")),
      ),
      sortOrder: 0,
      archivedAt: null,
      createdBy: adminId,
    },
    {
      id: nanoid(),
      title: "Class Build Basics",
      slug: "class-build-basics",
      categoryId: categoryRows[1]!.id,
      bodyJson: tiptap(
        heading(1, "Class Build Overview"),
        para(txt("Each class in the game has multiple viable builds. This article covers the fundamentals.")),
        heading(2, "Core Principles"),
        bulletList("Focus on one primary stat before branching out", "Synergy between skills matters more than raw numbers", "Always test builds in practice mode before committing resources"),
        heading(2, "Class Categories"),
        para(bold("鸣金"), txt(" - Ranged DPS with high burst potential. Best paired with 破竹 for sustained damage.")),
        para(bold("牵丝"), txt(" - Support/healer class. Essential for guild war compositions.")),
        para(bold("破竹"), txt(" - Melee DPS with strong AoE. Versatile in both PvE and PvP.")),
        para(bold("裂石"), txt(" - Tank class with crowd control. Anchors the frontline in wars.")),
      ),
      sortOrder: 0,
      archivedAt: null,
      createdBy: moderatorIds[0]!,
    },
    {
      id: nanoid(),
      title: "War Rotation",
      slug: "war-rotation",
      categoryId: categoryRows[2]!.id,
      bodyJson: tiptap(
        heading(1, "Guild War Rotation Strategy"),
        para(txt("Our standard rotation ensures consistent performance across all war sessions.")),
        heading(2, "Team Composition"),
        para(txt("Each war fields two teams of 4 players. The "), bold("Vanguard"), txt(" pushes lanes while the "), bold("Sentinel"), txt(" controls towers.")),
        heading(2, "Rotation Rules"),
        bulletList("Teams rotate every 2 wars to prevent burnout", "Pool members fill gaps when regulars are unavailable", "New members observe for 2 wars before joining active rotation"),
        para(italic("Note: Rotation may be adjusted during tournament seasons.")),
      ),
      sortOrder: 0,
      archivedAt: null,
      createdBy: moderatorIds[1]!,
    },
    {
      id: nanoid(),
      title: "Support Role Notes",
      slug: "support-role-notes",
      categoryId: subCategoryRows[2]!.id,
      bodyJson: tiptap(
        heading(1, "Playing Support in Guild Wars"),
        para(txt("Support players are the backbone of any successful war team. This guide covers positioning, timing, and build priorities.")),
        heading(2, "Key Responsibilities"),
        bulletList("Keep frontline alive during tower pushes", "Provide buffs before major engagements", "Call out enemy flanks and cooldown windows", "Prioritize healing tanks over DPS in sustained fights"),
        heading(2, "Recommended Builds"),
        para(bold("牵丝玉"), txt(" - Pure healing focus. Best for defensive compositions.")),
        para(bold("牵丝霖"), txt(" - Hybrid support with shields. Better for aggressive pushes.")),
      ),
      sortOrder: 0,
      archivedAt: null,
      createdBy: moderatorIds[2]!,
    },
    {
      id: nanoid(),
      title: "Archived Tactics",
      slug: "archived-tactics",
      categoryId: categoryRows[2]!.id,
      bodyJson: tiptap(
        heading(1, "Legacy Tactics Archive"),
        para(txt("These tactics were used in previous seasons and are kept for historical reference.")),
        heading(2, "Season 3 Rush Meta"),
        para(txt("The rush meta relied on overwhelming the enemy base within the first 3 minutes. This was "), bold("patched in Season 4"), txt(" and is no longer viable.")),
        bulletList("All 8 players pushed a single lane", "Ignored towers entirely", "Required specific class composition: 2 tanks, 4 DPS, 2 supports"),
      ),
      sortOrder: 1,
      archivedAt: addDays(now, -10),
      createdBy: adminId,
    },
    {
      id: nanoid(),
      title: "Common Questions",
      slug: "common-questions",
      categoryId: subCategoryRows[0]!.id,
      bodyJson: tiptap(
        heading(1, "Frequently Asked Questions"),
        heading(2, "How do I join guild wars?"),
        para(txt("Sign up for guild war events on the events page. Officers will assign you to a team based on your class and availability.")),
        heading(2, "What are the activity requirements?"),
        para(txt("Members should participate in at least "), bold("2 events per week"), txt(". Extended absences should be communicated via the vacation system in your profile.")),
        heading(2, "How do I get promoted?"),
        para(txt("Promotions are based on consistent participation, war performance, and community contribution. Talk to a moderator for details.")),
      ),
      sortOrder: 1,
      archivedAt: null,
      createdBy: adminId,
    },
    {
      id: nanoid(),
      title: "DPS Optimization Guide",
      slug: "dps-optimization",
      categoryId: subCategoryRows[1]!.id,
      bodyJson: tiptap(
        heading(1, "Maximizing DPS Output"),
        para(txt("This guide covers advanced techniques for squeezing maximum damage from DPS classes.")),
        heading(2, "Skill Rotation"),
        bulletList("Open with your highest burst skill", "Weave auto-attacks between cooldowns", "Save ultimate for tower pushes or team fights"),
        para(italic("Tip: Practice your rotation until it becomes muscle memory. Consistency beats theory.")),
      ),
      sortOrder: 0,
      archivedAt: null,
      createdBy: moderatorIds[0]!,
    },
    {
      id: nanoid(),
      title: "Defensive Formations",
      slug: "defensive-formations",
      categoryId: subCategoryRows[4]!.id,
      bodyJson: tiptap(
        heading(1, "War Defense Strategies"),
        para(txt("When the enemy has a stronger lineup, switching to a defensive formation can turn the tide.")),
        heading(2, "Tower Priority Defense"),
        bulletList("Station 2 players per tower", "Rotate reinforcements based on enemy push direction", "Use crowd control to stall while towers deal damage"),
        para(bold("Key principle:"), txt(" Trading time for tower damage is always worth it in close matches.")),
      ),
      sortOrder: 0,
      archivedAt: null,
      createdBy: moderatorIds[1]!,
    },
  ];
  await db.insert(wikiArticles).values(articleRows);

  // ════════════════════════════════════════════
  // ── Gallery ──
  // ════════════════════════════════════════════

  const galleryItemRows: Array<typeof galleryItems.$inferInsert> = [
    ...Array.from({ length: 20 }).map((_, index) => ({
      id: nanoid(),
      type: "image" as const,
      url: seedMockAsset("scene", index),
      caption: `Seed image ${index + 1}`,
      uploadedBy: memberIds[index % memberIds.length]!,
    })),
    ...Array.from({ length: 8 }).map((_, index) => ({
      id: nanoid(),
      type: "video" as const,
      url: `https://youtu.be/seed-video-${index + 1}`,
      caption: `Seed video ${index + 1}`,
      uploadedBy: index < 3 ? moderatorIds[index]! : memberIds[(index + 5) % memberIds.length]!,
    })),
  ];
  await batchInsert(db, galleryItems, galleryItemRows);

  // ════════════════════════════════════════════
  // ── Invite Links ──
  // ════════════════════════════════════════════
  // usedCount: 18 = 1 admin + 3 mods + 14 active members (member_14 is inactive but was registered via this link)
  // Total registered users through SEEDLIVE = 19 (all users), but some may have used other links
  // For simplicity: admin + 3 mods + 15 members = 19, minus those via other links = 18

  await db.insert(inviteLinks).values([
    {
      id: nanoid(),
      code: "SEEDLIVE",
      createdBy: adminId,
      maxUses: 100,
      usedCount: 18,
      expiresAt: addDays(now, 30),
      revokedAt: null,
    },
    {
      id: nanoid(),
      code: "SEEDEXPR",
      createdBy: adminId,
      maxUses: 10,
      usedCount: 10,
      expiresAt: addDays(now, -1),
      revokedAt: null,
    },
    {
      id: nanoid(),
      code: "SEEDREVOKED",
      createdBy: adminId,
      maxUses: 25,
      usedCount: 4,
      expiresAt: addDays(now, 12),
      revokedAt: addDays(now, -2),
    },
    {
      id: nanoid(),
      code: "SEEDFRESH",
      createdBy: moderatorIds[0]!,
      maxUses: 50,
      usedCount: 0,
      expiresAt: addDays(now, 60),
      revokedAt: null,
    },
  ]);
  // ════════════════════════════════════════════
  // ── Sessions ──
  // ════════════════════════════════════════════

  await db.insert(sessions).values([
    {
      id: nanoid(),
      userId: adminId,
      expiresAt: addDays(now, 7),
    },
    {
      id: nanoid(),
      userId: moderatorIds[0]!,
      expiresAt: addDays(now, 5),
    },
  ]);

  // ════════════════════════════════════════════
  // ── Audit Log ──
  // ════════════════════════════════════════════

  await db.insert(auditLog).values([
    {
      id: nanoid(),
      entityType: "seed",
      action: "init",
      actorId: adminId,
      entityId: "seed-users",
      diffTitle: "Seed users created",
      detailText: JSON.stringify({ users: userRows.length }),
      createdAt: addHours(now, -12),
    },
    {
      id: nanoid(),
      entityType: "seed",
      action: "init",
      actorId: adminId,
      entityId: "seed-events",
      diffTitle: "Seed events created",
      detailText: JSON.stringify({ events: eventRows.length }),
      createdAt: addHours(now, -10),
    },
    {
      id: nanoid(),
      entityType: "seed",
      action: "init",
      actorId: adminId,
      entityId: "seed-announcements",
      diffTitle: "Seed announcements created",
      detailText: JSON.stringify({ announcements: 4 }),
      createdAt: addHours(now, -9),
    },
    {
      id: nanoid(),
      entityType: "seed",
      action: "init",
      actorId: adminId,
      entityId: "seed-wiki",
      diffTitle: "Seed wiki created",
      detailText: JSON.stringify({ categories: categoryRows.length, articles: articleRows.length }),
      createdAt: addHours(now, -8),
    },
    {
      id: nanoid(),
      entityType: "user",
      action: "deactivate",
      actorId: adminId,
      entityId: memberIds[13]!,
      diffTitle: "Marked member_14 as inactive",
      detailText: JSON.stringify({ reason: "Seeded inactive state for admin QA" }),
      createdAt: addHours(now, -7),
    },
    {
      id: nanoid(),
      entityType: "invite_link",
      action: "revoke",
      actorId: adminId,
      entityId: "SEEDREVOKED",
      diffTitle: "Revoked compromised invite link",
      detailText: JSON.stringify({ code: "SEEDREVOKED" }),
      createdAt: addHours(now, -6),
    },
    {
      id: nanoid(),
      entityType: "announcement",
      action: "archive",
      actorId: moderatorIds[0]!,
      entityId: "retired-raid-rotation",
      diffTitle: "Archived outdated raid rotation",
      detailText: JSON.stringify({ status: "archived" }),
      createdAt: addHours(now, -5),
    },
    {
      id: nanoid(),
      entityType: "gallery",
      action: "upload_images",
      actorId: memberIds[2]!,
      entityId: galleryItemRows[2]!.id!,
      diffTitle: "Uploaded strategy reference image",
      detailText: JSON.stringify({ type: galleryItemRows[2]!.type, caption: galleryItemRows[2]!.caption }),
      createdAt: addHours(now, -4),
    },
    {
      id: nanoid(),
      entityType: "badge",
      action: "create",
      actorId: adminId,
      entityId: badgeRows[0]!.id,
      diffTitle: "Created Veteran badge",
      detailText: JSON.stringify({ name: "Veteran", color: "#f59e0b" }),
      createdAt: addHours(now, -3),
    },
    {
      id: nanoid(),
      entityType: "seed",
      action: "complete",
      actorId: adminId,
      entityId: "seed-run",
      diffTitle: "Seed complete",
      detailText: JSON.stringify({
        at: new Date().toISOString(),
        totals: {
          users: userRows.length,
          events: eventRows.length,
          participants: participantRows.length,
          announcements: 4,
          wikiCategories: categoryRows.length + subCategoryRows.length,
          wikiArticles: articleRows.length,
          galleryItems: galleryItemRows.length,
          warHistory: warHistoryRows.length,
          badges: badgeRows.length,
          badgeAssignments: badgeAssignmentRows.length,
        },
      }),
      createdAt: addHours(now, -1),
    },
  ]);

  // ════════════════════════════════════════════
  // ── Guild Storage ──
  // ════════════════════════════════════════════

  const equipStorageId = nanoid();
  const supplyStorageId = nanoid();
  const storageRows: Array<typeof storages.$inferInsert> = [
    { id: equipStorageId, name: "装备仓库", description: "公会战利品与装备", createdAt: addDays(now, -40) },
    { id: supplyStorageId, name: "帮会物资", description: "日常材料与资金", createdAt: addDays(now, -40) },
  ];
  await batchInsert(db, storages, storageRows, 2);

  const weaponCategoryId = nanoid();
  const armorCategoryId = nanoid();
  const materialCategoryId = nanoid();
  const storageCategoryRows: Array<typeof storageCategories.$inferInsert> = [
    { id: weaponCategoryId, storageId: equipStorageId, name: "武器", createdAt: addDays(now, -40) },
    { id: armorCategoryId, storageId: equipStorageId, name: "防具", createdAt: addDays(now, -40) },
    { id: materialCategoryId, storageId: supplyStorageId, name: "材料", createdAt: addDays(now, -40) },
  ];
  await batchInsert(db, storageCategories, storageCategoryRows, 3);

  // Ledger invariant: each item's quantity is DERIVED from its transaction
  // deltas below (quantity = sum of quantityDelta), so they cannot drift.
  type StorageTransactionSeed = Omit<typeof storageTransactions.$inferInsert, "id" | "itemId">;
  const storageItemSeeds: Array<{
    item: Omit<typeof storageItems.$inferInsert, "quantity">;
    transactions: StorageTransactionSeed[];
  }> = [
    {
      item: {
        id: nanoid(),
        storageId: equipStorageId,
        categoryId: weaponCategoryId,
        name: "玄铁重剑",
        description: "公会战掉落的稀有武器",
        createdAt: addDays(now, -35),
        updatedAt: addDays(now, -2),
      },
      transactions: [
        { type: "intake", quantityDelta: 5, actorId: adminId, note: "公会战战利品入库", createdAt: addDays(now, -35) },
        { type: "distribute", quantityDelta: -1, recipientUserId: memberIds[0]!, actorId: adminId, note: "6/7 战局分发", createdAt: addDays(now, -4) },
        { type: "distribute", quantityDelta: -1, recipientUserId: memberIds[2]!, actorId: adminId, note: "6/7 战局分发", createdAt: addDays(now, -4) },
        { type: "adjust", quantityDelta: -1, actorId: moderatorIds[0]!, note: "盘点修正", createdAt: addDays(now, -2) },
      ],
    },
    {
      item: {
        id: nanoid(),
        storageId: equipStorageId,
        categoryId: weaponCategoryId,
        name: "百炼长枪",
        description: "制式武器，按需分发",
        createdAt: addDays(now, -30),
        updatedAt: addDays(now, -4),
      },
      transactions: [
        { type: "intake", quantityDelta: 8, actorId: moderatorIds[0]!, note: "批量打造入库", createdAt: addDays(now, -30) },
        { type: "distribute", quantityDelta: -2, recipientUserId: memberIds[1]!, actorId: moderatorIds[0]!, note: "6/7 战局分发", createdAt: addDays(now, -4) },
      ],
    },
    {
      item: {
        id: nanoid(),
        storageId: equipStorageId,
        categoryId: armorCategoryId,
        name: "寒铁护甲",
        description: "前排坦克专用防具",
        createdAt: addDays(now, -28),
        updatedAt: addDays(now, -3),
      },
      transactions: [
        { type: "intake", quantityDelta: 4, actorId: adminId, note: "公会战战利品入库", createdAt: addDays(now, -28) },
        { type: "adjust", quantityDelta: 1, actorId: adminId, note: "盘点修正", createdAt: addDays(now, -3) },
      ],
    },
    {
      item: {
        id: nanoid(),
        storageId: supplyStorageId,
        categoryId: materialCategoryId,
        name: "精铁矿石",
        description: "打造装备的基础材料，成员可自助存取",
        allowMemberDeposit: true,
        allowMemberWithdraw: true,
        createdAt: addDays(now, -25),
        updatedAt: addDays(now, -1),
      },
      transactions: [
        { type: "intake", quantityDelta: 200, actorId: adminId, note: "周常采集入库", createdAt: addDays(now, -25) },
        { type: "distribute", quantityDelta: -30, recipientUserId: memberIds[6]!, actorId: moderatorIds[0]!, note: "6/7 战局分发", createdAt: addDays(now, -4) },
        { type: "intake", quantityDelta: 20, actorId: memberIds[3]!, note: "成员存入", createdAt: addDays(now, -2) },
        { type: "adjust", quantityDelta: -5, actorId: adminId, note: "盘点修正", createdAt: addDays(now, -1) },
      ],
    },
    {
      item: {
        id: nanoid(),
        storageId: supplyStorageId,
        categoryId: materialCategoryId,
        name: "灵芝草药",
        description: "炼药材料，欢迎成员捐赠",
        allowMemberDeposit: true,
        createdAt: addDays(now, -20),
        updatedAt: addDays(now, -2),
      },
      transactions: [
        { type: "intake", quantityDelta: 50, actorId: moderatorIds[1]!, note: "采购入库", createdAt: addDays(now, -20) },
        { type: "intake", quantityDelta: 10, actorId: memberIds[7]!, note: "成员存入", createdAt: addDays(now, -2) },
      ],
    },
    {
      // Uncategorized item — exercises the nullable category_id path.
      item: {
        id: nanoid(),
        storageId: supplyStorageId,
        categoryId: null,
        name: "帮会资金券",
        description: "公会公共资金，仅管理员操作",
        createdAt: addDays(now, -15),
        updatedAt: addDays(now, -1),
      },
      transactions: [
        { type: "intake", quantityDelta: 1000, actorId: adminId, note: "赛季结算入账", createdAt: addDays(now, -15) },
        { type: "distribute", quantityDelta: -100, recipientUserId: memberIds[4]!, actorId: adminId, note: "6/7 战局分发", createdAt: addDays(now, -4) },
        { type: "adjust", quantityDelta: 10, actorId: adminId, note: "盘点修正", createdAt: addDays(now, -1) },
      ],
    },
  ];

  const storageItemRows: Array<typeof storageItems.$inferInsert> = [];
  const storageTransactionRows: Array<typeof storageTransactions.$inferInsert> = [];
  for (const seed of storageItemSeeds) {
    const quantity = seed.transactions.reduce((sum, tx) => sum + tx.quantityDelta, 0);
    storageItemRows.push({ ...seed.item, quantity });
    for (const tx of seed.transactions) {
      storageTransactionRows.push({ id: nanoid(), itemId: seed.item.id, ...tx });
    }
  }
  await batchInsert(db, storageItems, storageItemRows, 5);
  await batchInsert(db, storageTransactions, storageTransactionRows, 8);
  // NOTE: no storage_item_images rows — mock R2 has no objects, keys would dangle.

  // ════════════════════════════════════════════
  // ── Game Data ──
  // ════════════════════════════════════════════

  await db.insert(gameData).values({
    data: JSON.stringify(seedGameData),
    version: seedGameData.version,
    uploadedBy: adminId,
  });
}
