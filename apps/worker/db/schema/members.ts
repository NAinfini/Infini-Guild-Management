// Domain: Member Profiles
// Tables: member_profiles, member_profile_classes, member_profile_images, member_absences
// Dependencies: auth.users, class-catalog.class_catalog
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { classCatalog } from "./class-catalog";
import { nowUtc } from "./shared";

export const memberProfiles = sqliteTable(
  "member_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
    power: real("power").notNull().default(0),
    titleHtml: text("title_html"),
    bio: text("bio"),
    avatarKey: text("avatar_key"),
    audioKey: text("audio_key"),
    videoUrls: text("video_urls").notNull().default("[]"),
    availability: text("availability"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    check("member_profiles_power_nonnegative", sql`${table.power} >= 0`),
    check("member_profiles_video_urls_json_array", sql`json_valid(${table.videoUrls}) AND json_type(${table.videoUrls}) = 'array'`),
    check("member_profiles_availability_json_object", sql`${table.availability} IS NULL OR (json_valid(${table.availability}) AND json_type(${table.availability}) = 'object')`),
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

export const memberProfileImages = sqliteTable(
  "member_profile_images",
  {
    userId: text("user_id").notNull().references(() => memberProfiles.userId, { onDelete: "cascade" }),
    mediaKey: text("media_key").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.mediaKey] }),
    uniqueIndex("ux_member_profile_images_user_sort").on(table.userId, table.sortOrder),
    index("idx_member_profile_images_media_user").on(table.mediaKey, table.userId),
    check("member_profile_images_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);
