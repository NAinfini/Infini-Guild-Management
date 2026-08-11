import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const classCatalog = sqliteTable(
  "class_catalog",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    color: text("color").notNull(),
    iconType: text("icon_type", { enum: ["vector", "image"] }).notNull().default("vector"),
    vectorIcon: text("vector_icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("ux_class_catalog_label_nocase").on(sql`${table.label} COLLATE NOCASE`),
    index("idx_class_catalog_sort").on(table.sortOrder, table.id),
    check("class_catalog_sort_nonnegative", sql`${table.sortOrder} >= 0`),
    check(
      "class_catalog_icon_consistent",
      sql`(${table.iconType} = 'vector' AND ${table.vectorIcon} IS NOT NULL) OR (${table.iconType} = 'image' AND ${table.vectorIcon} IS NULL)`,
    ),
  ],
);

export const classTags = sqliteTable(
  "class_tags",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ownerKind: text("owner_kind", { enum: ["event", "recurring_template"] }),
    ownerId: text("owner_id"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("ux_class_tags_catalog_label_nocase")
      .on(sql`${table.label} COLLATE NOCASE`)
      .where(sql`${table.ownerKind} IS NULL`),
    index("idx_class_tags_sort").on(table.ownerKind, table.sortOrder, table.id),
    index("idx_class_tags_owner").on(table.ownerKind, table.ownerId),
    check("class_tags_sort_nonnegative", sql`${table.sortOrder} >= 0`),
    check(
      "class_tags_owner_consistent",
      sql`(${table.ownerKind} IS NULL AND ${table.ownerId} IS NULL) OR (${table.ownerKind} IS NOT NULL AND ${table.ownerId} IS NOT NULL)`,
    ),
  ],
);

export const classTagMembers = sqliteTable(
  "class_tag_members",
  {
    tagId: text("tag_id")
      .notNull()
      .references(() => classTags.id, { onDelete: "cascade" }),
    classId: text("class_id")
      .notNull()
      .references(() => classCatalog.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.tagId, table.classId] }),
    index("idx_class_tag_members_class").on(table.classId, table.tagId),
  ],
);

export const memberProfiles = sqliteTable(
  "member_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    power: real("power").notNull().default(0),
    titleHtml: text("title_html"),
    bio: text("bio"),
    availabilityTimezone: text("availability_timezone"),
    notes: text("notes"),
    revisionToken: text("revision_token").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    check("member_profiles_power_nonnegative", sql`${table.power} >= 0`),
    check("member_profiles_revision_present", sql`length(${table.revisionToken}) >= 16`),
    check(
      "member_profiles_timezone_valid",
      sql`${table.availabilityTimezone} IS NULL OR (length(${table.availabilityTimezone}) BETWEEN 1 AND 64 AND ${table.availabilityTimezone} = trim(${table.availabilityTimezone}))`,
    ),
  ],
);

export const memberProfileClasses = sqliteTable(
  "member_profile_classes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => memberProfiles.userId, { onDelete: "cascade" }),
    classId: text("class_id")
      .notNull()
      .references(() => classCatalog.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.classId] }),
    uniqueIndex("ux_member_profile_classes_sort").on(table.userId, table.sortOrder),
    index("idx_member_profile_classes_class").on(table.classId, table.userId),
    check("member_profile_classes_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const memberProfileVideos = sqliteTable(
  "member_profile_videos",
  {
    userId: text("user_id")
      .notNull()
      .references(() => memberProfiles.userId, { onDelete: "cascade" }),
    url: text("url").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.url] }),
    uniqueIndex("ux_member_profile_videos_sort").on(table.userId, table.sortOrder),
    check("member_profile_videos_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const memberAvailabilityWindows = sqliteTable(
  "member_availability_windows",
  {
    userId: text("user_id")
      .notNull()
      .references(() => memberProfiles.userId, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.weekday, table.startMinute, table.endMinute] }),
    index("idx_member_availability_lookup").on(table.weekday, table.startMinute, table.endMinute, table.userId),
    check("member_availability_weekday_valid", sql`${table.weekday} BETWEEN 0 AND 6`),
    check("member_availability_start_valid", sql`${table.startMinute} BETWEEN 0 AND 1439`),
    check("member_availability_end_valid", sql`${table.endMinute} BETWEEN 1 AND 1440`),
    check("member_availability_range_valid", sql`${table.startMinute} < ${table.endMinute}`),
  ],
);

export const memberAbsences = sqliteTable(
  "member_absences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_member_absences_user_start").on(table.userId, table.startDate, table.id),
    index("idx_member_absences_window").on(table.endDate, table.startDate, table.userId),
    check("member_absences_range_valid", sql`${table.startDate} <= ${table.endDate}`),
  ],
);

export const memberBadges = sqliteTable(
  "member_badges",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    labelHtml: text("label_html").notNull(),
    color: text("color").notNull().default("#3b82f6"),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("ux_member_badges_name_nocase").on(sql`${table.name} COLLATE NOCASE`),
    index("idx_member_badges_sort").on(table.sortOrder, table.id),
    check("member_badges_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const memberBadgeAssignments = sqliteTable(
  "member_badge_assignments",
  {
    badgeId: text("badge_id")
      .notNull()
      .references(() => memberBadges.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assignedBy: text("assigned_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assignedAt: text("assigned_at").notNull().default(nowUtc),
  },
  (table) => [
    primaryKey({ columns: [table.badgeId, table.userId] }),
    index("idx_member_badge_assignments_user").on(table.userId, table.badgeId),
    index("idx_member_badge_assignments_actor").on(table.assignedBy),
  ],
);
