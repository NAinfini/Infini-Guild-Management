import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BUILT_IN_ROLES } from "../../../apps/shared/constants/roles.js";
import { DEFAULT_FEATURE_FLAGS } from "../../../apps/shared/config/features.js";
import { LIMITS } from "../../../apps/shared/config/limits.js";
import {
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_ANALYTICS_SETTINGS,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_STORAGE_POLICY,
} from "../../../apps/shared/schemas/site-config.js";
import {
  APP_MIGRATION_LEDGER_MARKER,
  canonicalMigrationPayload,
} from "../src/migrations/migration-manifest.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = join(packageRoot, "src", "migrations", "generated", "0000_core.sql");
const manifestPath = join(packageRoot, "src", "migrations", "generated", "manifest.json");
const marker = "-- modular-backend-invariants-and-seed";
const invariantFiles = [
  "app-migrations.invariants.sql",
  "audit-invariants.sql",
  "auth-triggers.sql",
  "events.invariants.sql",
  "guild-war.invariants.sql",
  "media-triggers.sql",
  "media-target-invariants.sql",
  "storage-invariants.sql",
  "system-test.invariants.sql",
  "wiki-triggers.sql",
] as const;

export async function renderCoreMigration(generated: string): Promise<string> {
  const beforeMarker = generated.split(marker, 1)[0];
  const generatedBase = beforeMarker
    ?.replace(/(?:\r?\n--> statement-breakpoint)+\s*$/, "")
    .trimEnd();
  if (!generatedBase) throw new Error("Generated core migration is empty");
  const base = addTableOptions(generatedBase);

  const invariants = await Promise.all(invariantFiles.map(async (name) => {
    const source = await readFile(join(packageRoot, "src", "schema", name), "utf8");
    return `-- ${name}\n${withBreakpoints(renderInvariant(source.trim()))}`;
  }));

  const body = `${base}\n--> statement-breakpoint\n${marker}\n${invariants.join("\n--> statement-breakpoint\n")}\n--> statement-breakpoint\n${seedSql()}\n--> statement-breakpoint\n`;
  const checksum = createHash("sha256").update(body).digest("hex");
  return `${body}${APP_MIGRATION_LEDGER_MARKER}\n${ledgerInsert("0000_core", 0, checksum)}\n`;
}

export async function assembleCoreMigration(): Promise<void> {
  const generated = await readFile(migrationPath, "utf8");
  const migration = await renderCoreMigration(generated);
  await Promise.all([
    writeFile(migrationPath, migration, "utf8"),
    writeFile(manifestPath, renderMigrationManifest(migration), "utf8"),
  ]);
}

export function renderMigrationManifest(migration: string): string {
  const checksum = createHash("sha256").update(canonicalMigrationPayload(migration)).digest("hex");
  return `${JSON.stringify([{ id: "0000_core", ordinal: 0, file: "0000_core.sql", checksum }], null, 2)}\n`;
}

if (import.meta.main) await assembleCoreMigration();

function seedSql(): string {
  const roleRows = BUILT_IN_ROLES.map((role) =>
    `(${quote(role.id)}, ${quote(role.name)}, ${role.level}, ${quote(role.color)}, ${quote(`seed-role-${role.id}-0001`)})`
  ).join(",\n  ");
  const permissionRows = BUILT_IN_ROLES.flatMap((role) =>
    role.permissions.map((permission) => `(${quote(role.id)}, ${quote(permission)})`)
  ).join(",\n  ");
  const sizes = DEFAULT_SITE_MEDIA_POLICY.max_file_size_bytes;
  const quotas = DEFAULT_SITE_MEDIA_POLICY.quotas;
  const weights = DEFAULT_SITE_ANALYTICS_SETTINGS.modifier_weights;

  return `-- Canonical built-ins. Parity tests compare these rows with apps/shared/constants/roles.ts.
INSERT INTO roles (id, name, level, color, revision_token) VALUES
  ${roleRows};
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission) VALUES
  ${permissionRows};
--> statement-breakpoint
INSERT INTO site_config (
  singleton, site_name, site_logo_media_id, default_site_logo_url,
  feature_announcements, feature_events, feature_guild_war, feature_gallery,
  feature_wiki, feature_tools, feature_storage,
  max_site_logo_bytes, max_class_icon_bytes, max_profile_image_bytes, max_profile_audio_bytes,
  max_announcement_image_bytes, max_wiki_image_bytes, max_event_image_bytes,
  max_gallery_image_bytes, max_storage_image_bytes,
  quota_profile, quota_announcement, quota_gallery, quota_wiki,
  storage_images_per_item, absence_max_span_days, absence_max_entries_per_user,
  analytics_reference_duration_minutes, analytics_weight_kills, analytics_weight_towers,
  analytics_weight_base_hp, analytics_weight_credits, analytics_weight_distance,
  revision_token
) VALUES (
  1, 'Infini Guild', NULL, '/guild-logo.svg',
  ${flag(DEFAULT_FEATURE_FLAGS.announcements)}, ${flag(DEFAULT_FEATURE_FLAGS.events)}, ${flag(DEFAULT_FEATURE_FLAGS.guildWar)}, ${flag(DEFAULT_FEATURE_FLAGS.gallery)},
  ${flag(DEFAULT_FEATURE_FLAGS.wiki)}, ${flag(DEFAULT_FEATURE_FLAGS.tools)}, ${flag(DEFAULT_FEATURE_FLAGS.storage)},
  ${sizes.site_logo}, ${sizes.class_icon}, ${sizes.profile_image}, ${sizes.profile_audio},
  ${sizes.announcement_image}, ${sizes.wiki_image}, ${sizes.event_image},
  ${sizes.gallery_image}, ${sizes.storage_image},
  ${quotas.profile}, ${quotas.announcement}, ${quotas.gallery}, ${quotas.wiki},
  ${DEFAULT_SITE_STORAGE_POLICY.images_per_item}, ${DEFAULT_SITE_ABSENCE_POLICY.max_span_days}, ${DEFAULT_SITE_ABSENCE_POLICY.max_entries_per_user},
  ${DEFAULT_SITE_ANALYTICS_SETTINGS.reference_duration_minutes}, ${weights.kills}, ${weights.towers},
  ${weights.base_hp}, ${weights.credits}, ${weights.distance},
  'seed-site-config-0001'
);
--> statement-breakpoint
INSERT INTO wiki_category_state (singleton, revision_token) VALUES (1, 'seed-wiki-state-0001');`;
}

function ledgerInsert(id: string, ordinal: number, checksum: string): string {
  return `INSERT INTO app_migrations (id, ordinal, checksum) VALUES (${quote(id)}, ${ordinal}, ${quote(checksum)});`;
}

function withBreakpoints(sql: string): string {
  return sql.replace(
    /END;(?=\s*(?:(?:--[^\r\n]*)\s*)*CREATE TRIGGER)/g,
    "END;\n--> statement-breakpoint",
  ).trimEnd();
}

function renderInvariant(sql: string): string {
  return sql
    .replaceAll("__RECURRING_TEMPLATE_CATALOG_MAX__", String(LIMITS.content.recurringTemplateCatalog.max))
    .replaceAll("__EVENT_PARTICIPANTS_PER_EVENT_MAX__", String(LIMITS.content.eventParticipantsPerEvent.max));
}

function addTableOptions(sql: string): string {
  if (/CREATE TABLE `scheduled_job_leases` \([\s\S]*?\) WITHOUT ROWID;/.test(sql)) return sql;
  const updated = sql.replace(
    /(CREATE TABLE `scheduled_job_leases` \([\s\S]*?\n\));/,
    "$1 WITHOUT ROWID;",
  );
  if (updated === sql) throw new Error("Generated scheduled_job_leases table is missing");
  return updated;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function flag(value: boolean): number {
  return value ? 1 : 0;
}
