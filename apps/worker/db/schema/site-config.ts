// Domain: Site Config & Onboarding
// Tables: site_config, onboarding_config, member_onboarding_state
// Dependencies: auth.users
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { nowUtc } from "./shared";

export const siteConfig = sqliteTable("site_config", {
  id: text("id").primaryKey(),
  siteName: text("site_name").notNull(),
  siteLogoUrl: text("site_logo_url").notNull(),
  featureFlagsJson: text("feature_flags_json").notNull(),
  mediaPolicyJson: text("media_policy_json").notNull(),
  paginationPolicyJson: text("pagination_policy_json").notNull(),
  storagePolicyJson: text("storage_policy_json").notNull(),
  absencePolicyJson: text("absence_policy_json").notNull(),
  analyticsSettingsJson: text("analytics_settings_json").notNull(),
  createdAt: text("created_at").notNull().default(nowUtc),
  updatedAt: text("updated_at").notNull().default(nowUtc),
});

export const onboardingConfig = sqliteTable("onboarding_config", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  bodyJson: text("body_json").notNull(),
  checklistJson: text("checklist_json").notNull().default("[]"),
  requireAck: integer("require_ack", { mode: "boolean" }).notNull().default(true),
  publishedAt: text("published_at"),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(nowUtc),
  updatedAt: text("updated_at").notNull().default(nowUtc),
});

export const memberOnboardingState = sqliteTable("member_onboarding_state", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  completedItemIdsJson: text("completed_item_ids_json").notNull().default("[]"),
  acknowledgedAt: text("acknowledged_at"),
  createdAt: text("created_at").notNull().default(nowUtc),
  updatedAt: text("updated_at").notNull().default(nowUtc),
});
