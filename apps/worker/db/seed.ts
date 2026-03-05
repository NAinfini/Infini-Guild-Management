import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import {
  announcements,
  auditLog,
  botDeliveryLog,
  botDiscordEventMessages,
  botWechatEventMessages,
  eventParticipants,
  events,
  galleryComments,
  galleryItems,
  galleryLikes,
  inviteLinks,
  memberProfiles,
  rolePermissions,
  roles,
  userAuthPassword,
  users,
  warHistory,
  warPoolMembers,
  warTeamMembers,
  warTeams,
  warTemplates,
  wikiArticles,
  wikiCategories,
} from "./schema";
import type { Bindings } from "../index";
import { createPasswordHash } from "../services/auth";

const ALL_TABLES = [
  "audit_log",
  "bot_wechat_event_messages",
  "bot_discord_event_messages",
  "bot_delivery_log",
  "gallery_comments",
  "gallery_likes",
  "gallery_items",
  "wiki_articles",
  "wiki_categories",
  "war_pool_members",
  "war_team_members",
  "war_teams",
  "war_templates",
  "war_history",
  "event_participants",
  "events",
  "invite_links",
  "announcements",
  "member_profiles",
  "sessions",
  "discord_link_codes",
  "role_permissions",
  "roles",
  "user_auth_password",
  "users",
] as const;

export async function clearAllData(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  for (const table of ALL_TABLES) {
    await db.run(sql.raw(`DELETE FROM ${table}`));
  }
}

const CLASSES = [
  "鸣金虹",
  "鸣金影",
  "牵丝玉",
  "牵丝霖",
  "破竹风",
  "破竹尘",
  "破竹鸢",
  "裂石威",
  "裂石钧",
] as const;

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
  "admin.bot.view",
  "admin.bot.manage",
  "admin.status.view",
  "admin.roles.manage",
  "guildwar.manage",
  "guildwar.history.edit",
  "events.manage",
  "announcements.manage",
  "gallery.upload",
  "wiki.edit",
] as const;

const MODERATOR_GRANTED_PERMISSIONS = new Set<string>([
  "admin.users.view",
  "admin.users.edit",
  "admin.invite.view",
  "admin.audit.view",
  "admin.bot.view",
  "admin.status.view",
  "guildwar.manage",
  "guildwar.history.edit",
  "events.manage",
  "announcements.manage",
  "gallery.upload",
  "wiki.edit",
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

function pickClasses(index: number): string[] {
  const first = CLASSES[index % CLASSES.length];
  const second = CLASSES[(index + 3) % CLASSES.length];
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
  )[0];

  if (Number(existingUsers?.count ?? 0) > 0) {
    return;
  }

  const now = new Date();

  const roleRows: Array<typeof roles.$inferInsert> = [
    { id: "admin", name: "Admin", level: 3, color: "red", isBuiltin: true },
    { id: "moderator", name: "Moderator", level: 2, color: "blue", isBuiltin: true },
    { id: "member", name: "Member", level: 1, color: "gray", isBuiltin: true },
  ];
  await batchInsert(db, roles, roleRows, 3);

  const rolePermissionRows: Array<typeof rolePermissions.$inferInsert> = [];
  for (const permission of ROLE_PERMISSION_KEYS) {
    rolePermissionRows.push({ roleId: "admin", permission, granted: true });
    rolePermissionRows.push({ roleId: "moderator", permission, granted: MODERATOR_GRANTED_PERMISSIONS.has(permission) });
    rolePermissionRows.push({ roleId: "member", permission, granted: MEMBER_GRANTED_PERMISSIONS.has(permission) });
  }
  await batchInsert(db, rolePermissions, rolePermissionRows, 15);

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
      isActive: true,
      deletedAt: null,
    })),
    ...memberIds.map((id, index) => ({
      id,
      username: `member_${String(index + 1).padStart(2, "0")}`,
      role: "member" as const,
      isActive: true,
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

  const profileRows: Array<typeof memberProfiles.$inferInsert> = [];
  for (let index = 0; index < memberIds.length; index += 1) {
    const userId = memberIds[index];
    profileRows.push({
      id: nanoid(),
      userId,
      wechatName: `成员${String(index + 1).padStart(2, "0")}`,
      power: 3000 + index * 120,
      classes: JSON.stringify(pickClasses(index)),
      titleHtml: `<p>Seed Title ${index + 1}</p>`,
      bio: `Seed profile for member ${index + 1}`,
      images: JSON.stringify([]),
      audioKey: null,
      videoUrls: JSON.stringify([]),
      availability: JSON.stringify({ weekdayEvening: index % 2 === 0 }),
      vacationStart: null,
      vacationEnd: null,
      discordId: `discord_user_${index + 1}`,
      discordReminderOptOut: false,
      notes: index % 5 === 0 ? "High priority member" : null,
    });
  }

  const allProfileRows = [
    {
      id: nanoid(),
      userId: adminId,
      wechatName: "会长",
      power: 9999,
      classes: JSON.stringify(["鸣金虹"]),
      titleHtml: "<p>Guild Leader</p>",
      bio: "Seeded admin profile",
      images: JSON.stringify([]),
      audioKey: null,
      videoUrls: JSON.stringify([]),
      availability: JSON.stringify({ all_day: true }),
      vacationStart: null,
      vacationEnd: null,
      discordId: "discord_admin",
      discordReminderOptOut: false,
      notes: "seed-admin",
    },
    ...profileRows,
  ];
  await batchInsert(db, memberProfiles, allProfileRows, 5);

  const eventRows: Array<typeof events.$inferInsert> = [
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
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
    {
      id: nanoid(),
      type: "weekly_mission",
      title: "Weekly Mission Beta",
      description: "Secondary weekly mission",
      startAt: addDays(now, 3),
      endAt: addDays(addHours(now, 2), 3),
      capacity: 12,
      pinned: false,
      signupLocked: false,
      archivedAt: null,
      createdBy: adminId,
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
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
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
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
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
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
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
    // ── Additional events for richer mock data ──
    {
      id: nanoid(),
      type: "social",
      title: "Movie Night",
      description: "Watch together event — no signup needed",
      startAt: addDays(now, 4),
      endAt: addDays(addHours(now, 3), 4),
      capacity: null,
      pinned: false,
      signupLocked: false,
      archivedAt: null,
      createdBy: moderatorIds[1],
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
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
      createdBy: moderatorIds[0],
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
    {
      id: nanoid(),
      type: "guild_war",
      title: "Archived War Event",
      description: "Old war that finished",
      startAt: addDays(now, -21),
      endAt: addDays(addHours(now, 3), -21),
      capacity: 20,
      pinned: false,
      signupLocked: true,
      archivedAt: addDays(now, -14),
      createdBy: adminId,
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
    {
      id: nanoid(),
      type: "other",
      title: "Locked Recruitment Drive",
      description: "Signup is locked — mod-only additions",
      startAt: addDays(now, 6),
      endAt: addDays(addHours(now, 4), 6),
      capacity: 5,
      pinned: true,
      signupLocked: true,
      archivedAt: null,
      createdBy: moderatorIds[2],
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
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
      createdBy: moderatorIds[0],
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
    {
      id: nanoid(),
      type: "weekly_mission",
      title: "Past Mission — Completed",
      description: "Already happened last week",
      startAt: addDays(now, -7),
      endAt: addDays(addHours(now, 2), -7),
      capacity: 10,
      pinned: false,
      signupLocked: false,
      archivedAt: null,
      createdBy: adminId,
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
    {
      id: nanoid(),
      type: "guild_war",
      title: "Guild War #3 — Far Future",
      description: "Scheduled far out",
      startAt: addDays(now, 30),
      endAt: addDays(addHours(now, 3), 30),
      capacity: 25,
      pinned: false,
      signupLocked: false,
      archivedAt: null,
      createdBy: moderatorIds[1],
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
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
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
    {
      id: nanoid(),
      type: "social",
      title: "Archived Social — Old",
      description: "Happened months ago",
      startAt: addDays(now, -60),
      endAt: addDays(addHours(now, 2), -60),
      capacity: 50,
      pinned: false,
      signupLocked: false,
      archivedAt: addDays(now, -55),
      createdBy: moderatorIds[0],
      recurrenceRule: null,
      seriesId: null,
      isSeriesParent: false,
      instanceDate: null,
    },
  ];

  await batchInsert(db, events, eventRows, 5);

  const participantRows: Array<typeof eventParticipants.$inferInsert> = [];
  for (const event of eventRows) {
    // Skip archived events for participants sometimes
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
  // Add moderators to some events
  for (const event of eventRows.slice(0, 5)) {
    for (const modId of moderatorIds) {
      participantRows.push({
        id: nanoid(),
        eventId: event.id,
        userId: modId,
        joinedAt: addMinutes(now, participantRows.length),
      });
    }
  }
  await batchInsert(db, eventParticipants, participantRows);

  await db.insert(announcements).values([
    {
      id: nanoid(),
      title: "Welcome to Infini Guild",
      bodyJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Welcome!" }] }] }),
      pinned: true,
      pinnedAt: now.toISOString(),
      status: "published",
      publishAt: now.toISOString(),
      expiresAt: null,
      archivedAt: null,
      createdBy: adminId,
    },
    {
      id: nanoid(),
      title: "Next War Prep",
      bodyJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Prepare your builds." }] }] }),
      pinned: false,
      pinnedAt: null,
      status: "draft",
      publishAt: null,
      expiresAt: null,
      archivedAt: null,
      createdBy: moderatorIds[0],
    },
    {
      id: nanoid(),
      title: "Scheduled Announcement",
      bodyJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Auto publish soon." }] }] }),
      pinned: false,
      pinnedAt: null,
      status: "scheduled",
      publishAt: addHours(now, 3),
      expiresAt: null,
      archivedAt: null,
      createdBy: moderatorIds[1],
    },
  ]);

  const warHistoryRows: Array<typeof warHistory.$inferInsert> = [
    {
      id: nanoid(),
      eventId: eventRows[2].id,
      warName: "War Session A",
      enemyName: "Shadow Legion",
      result: "win",
      ownKills: 38,
      ownTowers: 6,
      ownBaseHp: 72,
      ownCredits: 12800,
      ownDistance: 4800,
      enemyKills: 27,
      enemyTowers: 3,
      enemyBaseHp: 0,
      enemyCredits: 9300,
      enemyDistance: 3900,
      notes: "Solid frontline execution",
      createdBy: adminId,
    },
    {
      id: nanoid(),
      eventId: eventRows[3].id,
      warName: "War Session B",
      enemyName: "Iron Vanguard",
      result: "loss",
      ownKills: 24,
      ownTowers: 2,
      ownBaseHp: 0,
      ownCredits: 8700,
      ownDistance: 3200,
      enemyKills: 34,
      enemyTowers: 5,
      enemyBaseHp: 55,
      enemyCredits: 12100,
      enemyDistance: 4600,
      notes: "Need better split control",
      createdBy: moderatorIds[0],
    },
    {
      id: nanoid(),
      eventId: eventRows[7].id,
      warName: "War Session C",
      enemyName: "Crimson Tide",
      result: "win",
      ownKills: 42,
      ownTowers: 7,
      ownBaseHp: 58,
      ownCredits: 14200,
      ownDistance: 5100,
      enemyKills: 31,
      enemyTowers: 4,
      enemyBaseHp: 0,
      enemyCredits: 10500,
      enemyDistance: 4200,
      notes: "Clean sweep — great coordination",
      createdBy: adminId,
    },
    {
      id: nanoid(),
      eventId: eventRows[11].id,
      warName: "War Session D",
      enemyName: "Frost Reapers",
      result: "draw",
      ownKills: 30,
      ownTowers: 4,
      ownBaseHp: 35,
      ownCredits: 11000,
      ownDistance: 4400,
      enemyKills: 29,
      enemyTowers: 4,
      enemyBaseHp: 38,
      enemyCredits: 10800,
      enemyDistance: 4350,
      notes: "Extremely close match, towers tied",
      createdBy: moderatorIds[1],
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

    const assigned = memberIds.slice(index * 4, index * 4 + 8);
    const teamMemberRows: Array<typeof warTeamMembers.$inferInsert> = [];
    assigned.forEach((userId, memberIndex) => {
      teamMemberRows.push({
        id: nanoid(),
        warTeamId: memberIndex < 4 ? teamAId : teamBId,
        userId,
        roleTag: memberIndex % 2 === 0 ? "core" : "flex",
        sortOrder: memberIndex,
      });
    });

    await db.insert(warTeamMembers).values(teamMemberRows);

    await db.insert(warPoolMembers).values(
      memberIds.slice(10, 13).map((userId) => ({
        id: nanoid(),
        warHistoryId: history.id,
        userId,
      })),
    );
  }

  const categoryRows: Array<typeof wikiCategories.$inferInsert> = [
    { id: nanoid(), name: "General", slug: "general", sortOrder: 0, parentId: null },
    { id: nanoid(), name: "Builds", slug: "builds", sortOrder: 1, parentId: null },
    { id: nanoid(), name: "War", slug: "war", sortOrder: 2, parentId: null },
  ];
  await db.insert(wikiCategories).values(categoryRows);

  const articleRows: Array<typeof wikiArticles.$inferInsert> = [
    {
      id: nanoid(),
      title: "Getting Started",
      slug: "getting-started",
      categoryId: categoryRows[0].id,
      bodyJson: JSON.stringify({ content: "Welcome guide" }),
      sortOrder: 0,
      archivedAt: null,
      createdBy: adminId,
    },
    {
      id: nanoid(),
      title: "Class Build Basics",
      slug: "class-build-basics",
      categoryId: categoryRows[1].id,
      bodyJson: JSON.stringify({ content: "Build intro" }),
      sortOrder: 1,
      archivedAt: null,
      createdBy: moderatorIds[0],
    },
    {
      id: nanoid(),
      title: "War Rotation",
      slug: "war-rotation",
      categoryId: categoryRows[2].id,
      bodyJson: JSON.stringify({ content: "Rotation strategy" }),
      sortOrder: 2,
      archivedAt: null,
      createdBy: moderatorIds[1],
    },
    {
      id: nanoid(),
      title: "Support Role Notes",
      slug: "support-role-notes",
      categoryId: categoryRows[1].id,
      bodyJson: JSON.stringify({ content: "Support details" }),
      sortOrder: 3,
      archivedAt: null,
      createdBy: moderatorIds[2],
    },
    {
      id: nanoid(),
      title: "Archived Tactics",
      slug: "archived-tactics",
      categoryId: categoryRows[2].id,
      bodyJson: JSON.stringify({ content: "Old tactics" }),
      sortOrder: 4,
      archivedAt: addDays(now, -10),
      createdBy: adminId,
    },
  ];
  await db.insert(wikiArticles).values(articleRows);

  const galleryItemRows: Array<typeof galleryItems.$inferInsert> = [
    ...Array.from({ length: 7 }).map((_, index) => ({
      id: nanoid(),
      type: "image" as const,
      url: `gallery/images/seed/member_${index + 1}.webp`,
      caption: `Seed image ${index + 1}`,
      uploadedBy: memberIds[index],
    })),
    ...Array.from({ length: 3 }).map((_, index) => ({
      id: nanoid(),
      type: "video" as const,
      url: `https://youtu.be/seed-video-${index + 1}`,
      caption: `Seed video ${index + 1}`,
      uploadedBy: memberIds[index + 7],
    })),
  ];
  await batchInsert(db, galleryItems, galleryItemRows);

  await db.insert(inviteLinks).values([
    {
      id: nanoid(),
      code: "SEEDLIVE",
      createdBy: adminId,
      maxUses: 100,
      usedCount: 2,
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
  ]);

  // ── Gallery likes ──
  const galleryLikeRows: Array<typeof galleryLikes.$inferInsert> = [];
  for (let itemIdx = 0; itemIdx < galleryItemRows.length; itemIdx++) {
    // Each item gets a varying number of likes
    const likeCount = ((itemIdx * 3 + 2) % memberIds.length) + 1;
    for (let likerIdx = 0; likerIdx < Math.min(likeCount, memberIds.length); likerIdx++) {
      galleryLikeRows.push({
        id: nanoid(),
        galleryItemId: galleryItemRows[itemIdx].id!,
        userId: memberIds[likerIdx],
      });
    }
  }
  // Moderators like some items too
  for (const modId of moderatorIds) {
    for (const item of galleryItemRows.slice(0, 4)) {
      galleryLikeRows.push({
        id: nanoid(),
        galleryItemId: item.id!,
        userId: modId,
      });
    }
  }
  await batchInsert(db, galleryLikes, galleryLikeRows);

  // ── Gallery comments ──
  const commentBodies = [
    "Great shot!",
    "Love the composition",
    "How did you get this angle?",
    "Nice work 👍",
    "This is amazing",
    "Can you share your settings?",
    "Beautiful colors",
    "Impressive!",
    "More of this please",
    "Top tier content",
    "Wow, stunning!",
    "Keep it up",
  ];
  const galleryCommentRows: Array<typeof galleryComments.$inferInsert> = [];
  for (let itemIdx = 0; itemIdx < galleryItemRows.length; itemIdx++) {
    const commentCount = (itemIdx % 4) + 1;
    for (let commentIdx = 0; commentIdx < commentCount; commentIdx++) {
      galleryCommentRows.push({
        id: nanoid(),
        galleryItemId: galleryItemRows[itemIdx].id!,
        userId: memberIds[(itemIdx + commentIdx + 1) % memberIds.length],
        body: commentBodies[(itemIdx * 3 + commentIdx) % commentBodies.length],
      });
    }
  }
  // Admin and mods leave some comments
  galleryCommentRows.push(
    {
      id: nanoid(),
      galleryItemId: galleryItemRows[0].id!,
      userId: adminId,
      body: "Excellent submission, pinning this!",
    },
    {
      id: nanoid(),
      galleryItemId: galleryItemRows[2].id!,
      userId: moderatorIds[0],
      body: "Featured in this week's highlights",
    },
    {
      id: nanoid(),
      galleryItemId: galleryItemRows[5].id!,
      userId: moderatorIds[1],
      body: "Great contribution to the gallery",
    },
  );
  await batchInsert(db, galleryComments, galleryCommentRows);

  // ── War templates ──
  await db.insert(warTemplates).values([
    {
      id: nanoid(),
      templateName: "Standard 4v4 Split",
      description: "Default 4-player split formation with core/flex roles",
      sourceEventId: eventRows[2].id,
      payloadJson: JSON.stringify({
        teams: [
          {
            team_name: "Vanguard",
            sort_order: 0,
            notes: "Frontline pressure",
            is_locked: false,
            members: [
              { user_id: moderatorIds[0], role_tag: "core", sort_order: 0 },
              { user_id: memberIds[0], role_tag: "core", sort_order: 1 },
              { user_id: memberIds[1], role_tag: "flex", sort_order: 2 },
              { user_id: memberIds[2], role_tag: "flex", sort_order: 3 },
            ],
          },
          {
            team_name: "Sentinel",
            sort_order: 1,
            notes: "Tower control",
            is_locked: false,
            members: [
              { user_id: moderatorIds[1], role_tag: "core", sort_order: 0 },
              { user_id: memberIds[3], role_tag: "core", sort_order: 1 },
              { user_id: memberIds[4], role_tag: "flex", sort_order: 2 },
              { user_id: memberIds[5], role_tag: "flex", sort_order: 3 },
            ],
          },
        ],
        pool_members: [{ user_id: memberIds[6] }, { user_id: memberIds[7] }],
      }),
      createdBy: adminId,
    },
    {
      id: nanoid(),
      templateName: "Rush Formation",
      description: "Aggressive 5-player rush setup",
      sourceEventId: null,
      payloadJson: JSON.stringify({
        teams: [
          {
            team_name: "Blitz",
            sort_order: 0,
            notes: "Fast engage",
            is_locked: true,
            members: [
              { user_id: moderatorIds[2], role_tag: "core", sort_order: 0 },
              { user_id: memberIds[8], role_tag: "core", sort_order: 1 },
              { user_id: memberIds[9], role_tag: "flex", sort_order: 2 },
              { user_id: memberIds[10], role_tag: "support", sort_order: 3 },
              { user_id: memberIds[11], role_tag: "support", sort_order: 4 },
            ],
          },
          {
            team_name: "Lancer",
            sort_order: 1,
            notes: "Follow-up burst",
            is_locked: false,
            members: [
              { user_id: moderatorIds[0], role_tag: "core", sort_order: 0 },
              { user_id: memberIds[12], role_tag: "core", sort_order: 1 },
              { user_id: memberIds[13], role_tag: "flex", sort_order: 2 },
              { user_id: memberIds[14], role_tag: "support", sort_order: 3 },
            ],
          },
        ],
        pool_members: [{ user_id: memberIds[5] }],
      }),
      createdBy: moderatorIds[0],
    },
    {
      id: nanoid(),
      templateName: "Defense Hold",
      description: "Defensive formation prioritizing tower control",
      sourceEventId: eventRows[3].id,
      payloadJson: JSON.stringify({
        teams: [
          {
            team_name: "Aegis",
            sort_order: 0,
            notes: "North lane hold",
            is_locked: false,
            members: [
              { user_id: moderatorIds[1], role_tag: "core", sort_order: 0 },
              { user_id: memberIds[2], role_tag: "support", sort_order: 1 },
              { user_id: memberIds[4], role_tag: "support", sort_order: 2 },
              { user_id: memberIds[6], role_tag: "core", sort_order: 3 },
            ],
          },
          {
            team_name: "Bulwark",
            sort_order: 1,
            notes: "South lane hold",
            is_locked: false,
            members: [
              { user_id: moderatorIds[2], role_tag: "core", sort_order: 0 },
              { user_id: memberIds[7], role_tag: "support", sort_order: 1 },
              { user_id: memberIds[8], role_tag: "support", sort_order: 2 },
              { user_id: memberIds[9], role_tag: "core", sort_order: 3 },
            ],
          },
        ],
        pool_members: [{ user_id: memberIds[10] }, { user_id: memberIds[11] }],
      }),
      createdBy: adminId,
    },
  ]);

  // ── Bot delivery log ──
  const deliveryStatuses = ["queued", "sending", "sent", "failed"] as const;
  const deliveryLogRows: Array<typeof botDeliveryLog.$inferInsert> = [];
  for (let i = 0; i < 20; i++) {
    const platform = i % 3 === 0 ? "wechat" : "discord";
    const taskTypes = ["event_notify", "team_comp", "reminder", "war_result"] as const;
    const taskType = taskTypes[i % taskTypes.length];
    const status = deliveryStatuses[Math.min(i % 4, 3)];
    deliveryLogRows.push({
      id: nanoid(),
      idempotencyKey: `seed-delivery-${platform}-${taskType}-${i}`,
      platform,
      taskType,
      eventId: eventRows[i % eventRows.length].id,
      targetId: platform === "discord" ? `discord-channel-${(i % 3) + 1}` : `wechat-room-${(i % 2) + 1}`,
      payloadJson: JSON.stringify({
        type: taskType,
        eventTitle: eventRows[i % eventRows.length].title,
        message: `Seed delivery ${i + 1}`,
      }),
      status,
      attemptCount: status === "failed" ? 3 : status === "sent" ? 1 : 0,
      lastError: status === "failed" ? "Connection timeout after 10s" : null,
      nextAttemptAt: status === "queued" ? addMinutes(now, i * 5) : null,
      sentAt: status === "sent" ? addMinutes(now, -(i * 2)) : null,
      messageId: status === "sent" ? `msg-${nanoid()}` : null,
    });
  }
  await batchInsert(db, botDeliveryLog, deliveryLogRows, 5);

  // ── Bot Discord event messages ──
  const discordMsgRows: Array<typeof botDiscordEventMessages.$inferInsert> = [];
  const discordChannels = ["discord-channel-1", "discord-channel-2", "discord-channel-3"];
  for (let i = 0; i < Math.min(eventRows.length, 8); i++) {
    discordMsgRows.push({
      id: nanoid(),
      eventId: eventRows[i].id,
      channelId: discordChannels[i % discordChannels.length],
      messageId: `discord-msg-${nanoid()}`,
    });
  }
  await db.insert(botDiscordEventMessages).values(discordMsgRows);

  // ── Bot WeChat event messages ──
  const wechatMsgRows: Array<typeof botWechatEventMessages.$inferInsert> = [];
  const wechatRooms = ["wechat-room-1", "wechat-room-2"];
  for (let i = 0; i < Math.min(eventRows.length, 6); i++) {
    wechatMsgRows.push({
      id: nanoid(),
      eventId: eventRows[i].id,
      roomId: wechatRooms[i % wechatRooms.length],
      messageId: `wechat-msg-${nanoid()}`,
    });
  }
  await db.insert(botWechatEventMessages).values(wechatMsgRows);

  await db.insert(auditLog).values([
    {
      id: nanoid(),
      entityType: "seed",
      action: "init",
      actorId: adminId,
      entityId: "seed-users",
      diffTitle: "Seed users created",
      detailText: JSON.stringify({ users: userRows.length }),
    },
    {
      id: nanoid(),
      entityType: "seed",
      action: "init",
      actorId: adminId,
      entityId: "seed-events",
      diffTitle: "Seed events created",
      detailText: JSON.stringify({ events: eventRows.length }),
    },
    {
      id: nanoid(),
      entityType: "seed",
      action: "init",
      actorId: adminId,
      entityId: "seed-announcements",
      diffTitle: "Seed announcements created",
      detailText: JSON.stringify({ announcements: 3 }),
    },
    {
      id: nanoid(),
      entityType: "seed",
      action: "init",
      actorId: adminId,
      entityId: "seed-wiki",
      diffTitle: "Seed wiki created",
      detailText: JSON.stringify({ categories: categoryRows.length, articles: 5 }),
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
          announcements: 3,
          wikiCategories: categoryRows.length,
          wikiArticles: articleRows.length,
          galleryItems: galleryItemRows.length,
          galleryLikes: galleryLikeRows.length,
          galleryComments: galleryCommentRows.length,
          warHistory: warHistoryRows.length,
          warTemplates: 3,
          botDeliveryLog: deliveryLogRows.length,
          botDiscordMessages: discordMsgRows.length,
          botWechatMessages: wechatMsgRows.length,
        },
      }),
    },
  ]);
}
