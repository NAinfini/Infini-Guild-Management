// Domain: Member Profiles
// Tables: member_profiles, member_availability_windows, member_profile_classes, member_profile_videos, member_absences
// Dependencies: auth.users, class-catalog.class_catalog
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { classCatalog } from "./class-catalog";
import { canonicalUtcDate, nowUtc } from "./shared";

export const memberProfiles = sqliteTable(
  "member_profiles",
  {
    userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    power: real("power").notNull().default(0),
    titleHtml: text("title_html"),
    bio: text("bio"),
    availabilityTimezone: text("availability_timezone"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    check("member_profiles_power_nonnegative", sql`${table.power} >= 0`),
    check(
      "member_profiles_availability_timezone_valid",
      sql`${table.availabilityTimezone} IS NULL OR (length(${table.availabilityTimezone}) BETWEEN 1 AND 64 AND ${table.availabilityTimezone} = trim(${table.availabilityTimezone}))`,
    ),
  ],
);

export const memberAvailabilityWindows = sqliteTable(
  "member_availability_windows",
  {
    userId: text("user_id").notNull().references(() => memberProfiles.userId, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.weekday, table.startMinute, table.endMinute] }),
    index("idx_member_availability_windows_lookup").on(
      table.weekday,
      table.startMinute,
      table.endMinute,
      table.userId,
    ),
    check("member_availability_windows_weekday_valid", sql`${table.weekday} BETWEEN 0 AND 6`),
    check("member_availability_windows_start_valid", sql`${table.startMinute} BETWEEN 0 AND 1439`),
    check("member_availability_windows_end_valid", sql`${table.endMinute} BETWEEN 1 AND 1440`),
    check("member_availability_windows_range_valid", sql`${table.startMinute} < ${table.endMinute}`),
  ],
);

// Absence (请假) history — source of truth for member vacations.
export const memberAbsences = sqliteTable(
  "member_absences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(), // YYYY-MM-DD (UTC date)
    endDate: text("end_date").notNull(), // YYYY-MM-DD (UTC date), inclusive
    note: text("note"),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_member_absences_user_end").on(table.userId, table.endDate),
    index("idx_member_absences_end_start").on(table.endDate, table.startDate),
    check(
      "member_absences_dates_valid",
      sql`(${canonicalUtcDate(table.startDate)}) AND (${canonicalUtcDate(table.endDate)})`,
    ),
    check("member_absences_date_range_valid", sql`${table.startDate} <= ${table.endDate}`),
  ],
);

export const memberProfileClasses = sqliteTable(
  "member_profile_classes",
  {
    userId: text("user_id").notNull().references(() => memberProfiles.userId, { onDelete: "cascade" }),
    classId: text("class_id").notNull().references(() => classCatalog.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.classId] }),
    uniqueIndex("ux_member_profile_classes_user_sort").on(table.userId, table.sortOrder),
    index("idx_member_profile_classes_class_user").on(table.classId, table.userId),
    check("member_profile_classes_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const memberProfileVideos = sqliteTable(
  "member_profile_videos",
  {
    userId: text("user_id").notNull().references(() => memberProfiles.userId, { onDelete: "cascade" }),
    url: text("url").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.url] }),
    uniqueIndex("ux_member_profile_videos_user_sort").on(table.userId, table.sortOrder),
    check("member_profile_videos_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);
