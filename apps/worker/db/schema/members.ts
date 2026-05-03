// Domain: Member Profiles
// Tables: member_profiles
// Dependencies: auth.users
import { real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { nowUtc } from "./shared";

export const memberProfiles = sqliteTable("member_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => users.id),
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
});
