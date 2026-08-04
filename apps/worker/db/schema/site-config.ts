// Domain: Site Config
// Tables: site_config
// Dependencies: none
import { check, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { nowUtc } from "./shared";

export const siteConfig = sqliteTable(
  "site_config",
  {
    id: text("id").primaryKey(),
    siteName: text("site_name").notNull(),
    siteLogoUrl: text("site_logo_url").notNull(),
    featureFlagsJson: text("feature_flags_json").notNull(),
    mediaPolicyJson: text("media_policy_json").notNull(),
    storagePolicyJson: text("storage_policy_json").notNull(),
    absencePolicyJson: text("absence_policy_json").notNull(),
    analyticsSettingsJson: text("analytics_settings_json").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    check("site_config_feature_flags_json_object", sql`json_valid(${table.featureFlagsJson}) AND json_type(${table.featureFlagsJson}) = 'object'`),
    check("site_config_media_policy_json_object", sql`json_valid(${table.mediaPolicyJson}) AND json_type(${table.mediaPolicyJson}) = 'object'`),
    check("site_config_storage_policy_json_object", sql`json_valid(${table.storagePolicyJson}) AND json_type(${table.storagePolicyJson}) = 'object'`),
    check("site_config_absence_policy_json_object", sql`json_valid(${table.absencePolicyJson}) AND json_type(${table.absencePolicyJson}) = 'object'`),
    check("site_config_analytics_settings_json_object", sql`json_valid(${table.analyticsSettingsJson}) AND json_type(${table.analyticsSettingsJson}) = 'object'`),
  ],
);
