// Domain: Member Profiles
// Tables: member_profiles, member_profile_classes, member_absences
// Dependencies: auth.users
import { sql } from "drizzle-orm";
import { check, index, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { nowUtc } from "./shared";

export const memberProfiles = sqliteTable(
  "member_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
    power: real("power").notNull().default(0),
    classes: text("classes").notNull().default("[]"),
    titleHtml: text("title_html"),
    bio: text("bio"),
    avatarKey: text("avatar_key"),
    images: text("images").notNull().default("[]"),
    audioKey: text("audio_key"),
    videoUrls: text("video_urls").notNull().default("[]"),
    availability: text("availability"),
    vacationStart: text("vacation_start"),
    vacationEnd: text("vacation_end"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    check("member_profiles_power_nonnegative", sql`${table.power} >= 0`),
  ],
);

// Absence (请假) history — source of truth for member vacations.
// member_profiles.vacation_start/vacation_end are legacy columns kept for
// prod parity; reads derive them from this table (current-or-next absence).
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
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    className: text("class").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.className] }),
    idxClassUser: index("idx_member_profile_classes_class_user").on(table.className, table.userId),
  }),
);
