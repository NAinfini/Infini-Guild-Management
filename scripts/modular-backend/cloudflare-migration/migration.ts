import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { LIMITS } from "@guild/shared";
import { convertLegacyWorkerPasswordHash } from "@guild/server/migrations/auth-password-hash";

type Scalar = null | string | number;

export const LEGACY_SCHEMA = "production-c7076b53";
export const SOURCE_SCHEMA_SHA256 = "c7076b5388837f35aac93553440bb489ec1905063f33e5d1b07e078022fd8b3f";
export const MAX_BATCH_STATEMENTS = 80;
export const MAX_STATEMENT_BYTES = 96 * 1024;
export const MAX_BATCH_BYTES = 512 * 1024;
export const IMPORT_CHECKPOINT_TABLE = "bluegreen_import_checkpoints";
const MIGRATION_UUID_NAMESPACE = Buffer.from("6139763c61395615bdd855b747990c1a", "hex");

export const LEGACY_COLUMNS = {
  announcements: ["id", "title", "body_json", "pinned", "status", "publish_at", "expires_at", "archived_at", "created_by", "updated_by", "created_at", "updated_at"],
  audit_log: ["id", "entity_type", "action", "actor_id", "entity_id", "diff_title", "detail_text", "created_at"],
  class_catalog: ["id", "label", "color", "icon_type", "vector_icon", "icon_key", "sort_order", "created_at", "updated_at"],
  class_tag_members: ["tag_id", "class_id"],
  class_tags: ["id", "label", "sort_order", "owner_kind", "owner_id", "created_at", "updated_at"],
  d1_migrations: ["id", "name", "applied_at"],
  error_log: ["id", "source", "level", "message", "request_path", "request_method", "request_id", "stack", "context", "created_at"],
  event_attachments: ["event_id", "media_key", "sort_order"],
  event_class_quotas: ["event_id", "tag_id", "required"],
  event_participants: ["id", "event_id", "user_id", "joined_at"],
  event_poll_options: ["id", "event_id", "label", "sort_order", "created_at"],
  event_poll_votes: ["id", "event_id", "option_id", "user_id", "created_at"],
  event_polls: ["event_id", "results_visibility", "show_voter_names", "created_at", "updated_at"],
  event_raffle_winners: ["id", "event_id", "user_id", "drawn_at"],
  events: ["id", "type", "title", "description", "start_at", "end_at", "capacity", "pinned", "signup_locked", "visible_at", "archived_at", "auto_archive", "auto_archived", "created_by", "updated_by", "series_id", "instance_date", "winner_count", "created_at", "updated_at"],
  gallery_items: ["id", "type", "url", "caption", "uploaded_by", "created_at"],
  game_data: ["id", "data", "version", "uploaded_by", "created_at"],
  invite_links: ["id", "code", "created_by", "role_id", "max_uses", "used_count", "expires_at", "created_at", "revoked_at"],
  login_failures: ["username", "fail_count", "locked_until", "last_failed_at"],
  media_references: ["media_key", "entity_type", "entity_id", "created_at"],
  media_upload_leases: ["media_key", "owner_user_id", "entity_type", "entity_id", "expires_at", "created_at"],
  member_absences: ["id", "user_id", "start_date", "end_date", "note", "created_at"],
  member_badge_assignments: ["badge_id", "user_id", "assigned_by", "assigned_at"],
  member_badges: ["id", "name", "label_html", "color", "description", "sort_order", "created_at", "updated_at"],
  member_onboarding_state: ["user_id", "completed_item_ids_json", "acknowledged_at", "created_at", "updated_at"],
  member_profile_classes: ["user_id", "class_id", "sort_order"],
  member_profile_images: ["user_id", "media_key", "sort_order"],
  member_profiles: ["id", "user_id", "power", "title_html", "bio", "avatar_key", "audio_key", "video_urls", "availability", "notes", "created_at", "updated_at"],
  onboarding_config: ["id", "title", "body_json", "checklist_json", "require_ack", "published_at", "updated_by", "created_at", "updated_at"],
  recurring_template_attachments: ["template_id", "media_key", "sort_order"],
  recurring_template_class_quotas: ["template_id", "tag_id", "required"],
  recurring_templates: ["id", "type", "title", "description", "start_time", "duration_minutes", "capacity", "recurrence_rule", "visibility_offset_minutes", "auto_archive", "paused", "created_by", "last_generated_date", "generation_count", "created_at", "updated_at"],
  role_permissions: ["role_id", "permission", "granted"],
  roles: ["id", "name", "level", "color", "created_at", "updated_at"],
  sessions: ["id", "user_id", "expires_at", "created_at"],
  site_config: ["id", "site_name", "site_logo_url", "feature_flags_json", "media_policy_json", "storage_policy_json", "absence_policy_json", "analytics_settings_json", "created_at", "updated_at"],
  storage_categories: ["id", "storage_id", "name", "created_at"],
  storage_item_images: ["id", "item_id", "r2_key", "created_at"],
  storage_items: ["id", "storage_id", "category_id", "name", "description", "quantity", "allow_member_deposit", "allow_member_withdraw", "created_at", "updated_at"],
  storage_transactions: ["id", "item_id", "type", "quantity_delta", "recipient_user_id", "note", "actor_id", "created_at"],
  storages: ["id", "name", "description", "created_at"],
  system_test_artifacts: ["run_id", "artifact_type", "artifact_key", "created_at"],
  system_test_runs: ["id", "actor_id", "status", "active_requests", "cleanup_attempts", "last_error", "created_at", "updated_at", "completed_at"],
  user_auth_password: ["user_id", "password_hash", "salt", "updated_at"],
  users: ["id", "username", "role", "is_active", "deleted_at", "created_at", "updated_at"],
  war_history: ["id", "event_id", "war_name", "enemy_name", "result", "duration_minutes", "own_stats", "enemy_stats", "notes", "created_by", "updated_by", "created_at", "updated_at"],
  war_pool_members: ["id", "war_history_id", "event_id", "user_id"],
  war_team_members: ["id", "war_team_id", "user_id", "role_tag", "sort_order", "stats", "note"],
  war_teams: ["id", "war_history_id", "event_id", "team_name", "sort_order", "notes", "is_locked"],
  wiki_articles: ["id", "title", "slug", "category_id", "body_json", "sort_order", "pinned", "archived_at", "created_by", "updated_by", "created_at", "updated_at"],
  wiki_categories: ["id", "name", "slug", "sort_order", "parent_id", "created_at", "updated_at"],
  wiki_revisions: ["id", "article_id", "revision", "title", "body_json", "edited_by", "restored_from", "created_at"],
} as const;

export type LegacyTable = keyof typeof LEGACY_COLUMNS;
type LegacyColumn = (typeof LEGACY_COLUMNS)[LegacyTable][number];
type Row = { [K in LegacyColumn]: Scalar } & { [key: string]: Scalar };
type SqlValues = Record<string, Scalar>;
export type LegacySnapshot = Readonly<{
  version: 1;
  schema: typeof LEGACY_SCHEMA;
  schemaFingerprint: typeof SOURCE_SCHEMA_SHA256;
  tables: Readonly<Record<LegacyTable, Readonly<{ columns: readonly string[]; rows: readonly Row[] }>>>;
}>;

type Statement = Readonly<{ id: string; sql: string }>;
type StatementGroup = Readonly<{ phase: number; key: string; statements: readonly Statement[] }>;

export type MigrationRejection = Readonly<{ table: string; rowKey: string; code: string; message: string }>;
export type MigrationBatch = Readonly<{
  index: number;
  fileName: string;
  statementCount: number;
  byteLength: number;
  sha256: string;
  payloadSha256: string;
  afterStatement: string;
  sql: string;
}>;

export type PreservedRecord = Readonly<{
  table: string;
  objectKey: string;
  contentType: "application/x-ndjson";
  rowCount: number;
  byteLength: number;
  sha256: string;
  ndjson: string;
}>;

type MediaPurpose = "member_avatar" | "member_image" | "member_audio" | "gallery_image" | "event_image"
  | "announcement_image" | "wiki_image" | "storage_image" | "class_icon" | "site_logo";
type MediaReference = Readonly<{
  entityType: "member_profile" | "gallery_item" | "event" | "recurring_template" | "announcement" | "wiki_article" | "storage_item" | "class_catalog" | "site_config";
  entityId: string;
  slot: "avatar" | "image" | "audio" | "attachment" | "body" | "icon" | "logo";
  audience: "public" | "authenticated" | "private";
  sortOrder: number;
  attachedAt: string;
}>;

export type MediaRequirement = Readonly<{
  mediaId: string;
  sourceKey: string;
  purpose: MediaPurpose;
  mediaType: "image" | "audio";
  ownerUserId: string | null;
  createdAt: string;
  references: readonly MediaReference[];
  wikiRevisions: readonly Readonly<{ revisionId: string; audience: "public" | "private"; sortOrder: number }>[];
}>;

export type MigrationReport = Readonly<{
  rejections: readonly MigrationRejection[];
  skipped: readonly Readonly<{ table: string; rowCount: number; reason: string }>[];
  transformations: readonly Readonly<{ table: string; rowKey: string; detail: string }>[];
  coverage: readonly Readonly<{ table: LegacyTable; rowCount: number; disposition: string }>[];
  preserved: readonly Omit<PreservedRecord, "ndjson">[];
}>;

export type MigrationBundle = Readonly<{
  phase: "phase-1" | "phase-2";
  ready: boolean;
  sourceDigest: string;
  statementCount: number;
  batches: readonly MigrationBatch[];
  checkpoints: readonly Readonly<{ batch: number; fileName: string; sha256: string; payloadSha256: string; afterStatement: string; applied: false }>[];
  report: MigrationReport;
  mediaPlan: readonly MediaRequirement[];
  preservedRecords: readonly PreservedRecord[];
}>;

export type MigrationOptions = Readonly<{ siteOwnerUserIds: readonly string[] }>;

type Context = {
  snapshot: LegacySnapshot;
  options: MigrationOptions;
  groups: StatementGroup[];
  rejections: MigrationRejection[];
  skipped: { table: string; rowCount: number; reason: string }[];
  transformations: { table: string; rowKey: string; detail: string }[];
  preservedRecords: PreservedRecord[];
  mediaPlan: MediaRequirement[];
  wikiSnapshots: Map<string, readonly Row[]>;
};

const BUILT_IN_ROLES = new Set(["site_owner", "admin", "moderator", "member"]);
const TRANSIENT_TABLES = {
  d1_migrations: "Source migration bookkeeping is replaced by the target core migration ledger",
  invite_links: "Invitation secrets are intentionally rotated at cutover",
  login_failures: "Login lock state is intentionally cleared at cutover",
  media_upload_leases: "Incomplete upload leases are transient and their objects remain outside the referenced copy plan",
  sessions: "Sessions are intentionally invalidated at cutover",
  system_test_artifacts: "System-test artifacts are transient cleanup state",
  system_test_runs: "System-test execution state is transient",
} as const satisfies Partial<Record<LegacyTable, string>>;

const TABLE_DISPOSITION = {
  announcements: "phase-1 domain + phase-2 media",
  audit_log: "phase-1 migrated",
  class_catalog: "phase-1 domain + phase-2 media",
  class_tag_members: "phase-1 migrated",
  class_tags: "phase-1 migrated",
  d1_migrations: "reported source ledger; not copied",
  error_log: "phase-1 migrated + removed context cold-preserved",
  event_attachments: "phase-2 media",
  event_class_quotas: "phase-1 migrated",
  event_participants: "phase-1 migrated",
  event_poll_options: "phase-1 migrated",
  event_poll_votes: "phase-1 migrated",
  event_polls: "phase-1 migrated",
  event_raffle_winners: "phase-1 migrated with draw reconstruction",
  events: "phase-1 migrated",
  gallery_items: "phase-1 domain + phase-2 media",
  game_data: "cold-preserved outside application schema",
  invite_links: "intentionally rotated",
  login_failures: "intentionally reset",
  media_references: "phase-2 media",
  media_upload_leases: "intentionally discarded transient state",
  member_absences: "phase-1 migrated",
  member_badge_assignments: "phase-1 migrated",
  member_badges: "phase-1 migrated",
  member_onboarding_state: "cold-preserved outside application schema",
  member_profile_classes: "phase-1 migrated",
  member_profile_images: "phase-2 media",
  member_profiles: "phase-1 normalized domain + phase-2 media",
  onboarding_config: "cold-preserved outside application schema",
  recurring_template_attachments: "phase-2 media",
  recurring_template_class_quotas: "phase-1 migrated",
  recurring_templates: "phase-1 normalized domain",
  role_permissions: "phase-1 granted permissions migrated",
  roles: "phase-1 migrated against canonical built-ins",
  sessions: "intentionally invalidated",
  site_config: "phase-1 normalized config + phase-2 optional logo",
  storage_categories: "phase-1 migrated",
  storage_item_images: "phase-2 media",
  storage_items: "phase-1 domain + ledger reconciliation",
  storage_transactions: "phase-1 normalized immutable ledger",
  storages: "phase-1 migrated",
  system_test_artifacts: "intentionally discarded transient state",
  system_test_runs: "intentionally discarded transient state",
  user_auth_password: "phase-1 self-contained credential conversion",
  users: "phase-1 migrated with explicit owner promotion",
  war_history: "phase-1 normalized guild-war history",
  war_pool_members: "phase-1 normalized guild-war roster",
  war_team_members: "phase-1 normalized guild-war roster",
  war_teams: "phase-1 normalized guild-war teams",
  wiki_articles: "phase-1 revision reconstruction + phase-2 media",
  wiki_categories: "phase-1 migrated",
  wiki_revisions: "phase-1 immutable history + phase-2 revision media",
} as const satisfies Record<LegacyTable, string>;

const AUDIT_ENTITY_TYPES = new Set([
  "analytics_settings", "announcement", "audit_archive_export", "audit_log_export", "badge", "class_catalog", "class_tag",
  "event", "event_participant", "event_poll_vote", "gallery", "gallery_item", "guild_war", "guild_war_history",
  "guild_war_member_stats", "invite_link", "media_cleanup", "media_asset", "member_absence", "member_badge", "member_profile",
  "recurring_template", "role", "seed", "site_config", "system_test", "storage", "storage_category", "storage_item",
  "storage_transaction", "user", "user_auth", "wiki", "wiki_article", "wiki_category",
]);
const AUDIT_ACTIONS = new Set([
  "admin_create_member", "archive", "adjust", "acknowledge", "assign", "batch_add_by_moderator", "batch_deactivate",
  "batch_delete", "batch_reactivate", "batch_remove_by_moderator", "batch_role_update", "batch_update", "change_password",
  "change_username", "complete", "conclude", "create", "create_video", "deactivate", "delete", "delete_audio", "delete_avatar",
  "delete_images", "distribute", "download_raw_ndjson_gz", "export_filtered_csv", "export_filtered_json", "init", "intake", "join",
  "leave", "login_failed", "move_member", "pause", "publish", "raffle_draw", "reactivate", "register", "reset_login_lock",
  "reset_password", "rollback", "run", "resume", "revoke", "save_teams", "set_role_tag", "share_video", "unassign", "update",
  "update_role", "upload", "upload_audio", "upload_avatar", "upload_icon", "upload_images", "vote",
]);

export function parseLegacySnapshot(input: unknown): LegacySnapshot {
  if (!isRecord(input)) throw new TypeError("Snapshot must be an object");
  assertExactKeys(input, ["version", "schema", "schemaFingerprint", "tables"], "snapshot");
  if (input.version !== 1 || input.schema !== LEGACY_SCHEMA || input.schemaFingerprint !== SOURCE_SCHEMA_SHA256) {
    throw new TypeError("Snapshot version/schema/fingerprint does not match confirmed production schema");
  }
  if (!isRecord(input.tables)) throw new TypeError("Snapshot tables must be an object");
  assertExactKeys(input.tables, Object.keys(LEGACY_COLUMNS), "snapshot tables");
  const tables = {} as Record<LegacyTable, { columns: readonly string[]; rows: readonly Row[] }>;
  for (const table of Object.keys(LEGACY_COLUMNS) as LegacyTable[]) {
    const value = input.tables[table];
    if (!isRecord(value)) throw new TypeError(`Snapshot table ${table} must be an object`);
    assertExactKeys(value, ["columns", "rows"], `snapshot table ${table}`);
    if (!Array.isArray(value.columns) || !sameStringsInOrder(value.columns, LEGACY_COLUMNS[table])) {
      throw new TypeError(`Snapshot table ${table} columns do not exactly match production schema order`);
    }
    if (!Array.isArray(value.rows)) throw new TypeError(`Snapshot table ${table} rows must be an array`);
    const rows = value.rows.map((raw, index) => parseRow(table, raw, index));
    tables[table] = Object.freeze({ columns: Object.freeze([...value.columns] as string[]), rows: Object.freeze(rows) });
  }
  return Object.freeze({
    version: 1,
    schema: LEGACY_SCHEMA,
    schemaFingerprint: SOURCE_SCHEMA_SHA256,
    tables: Object.freeze(tables),
  });
}

export function buildPhase1Migration(snapshotInput: unknown, optionsInput: MigrationOptions, coreSql?: string): MigrationBundle {
  const context = createContext(snapshotInput, optionsInput);
  registerSkipsAndArchives(context);
  mapIdentity(context);
  mapCatalogAndMembers(context);
  mapEventsAndContent(context);
  mapWiki(context);
  mapStorage(context);
  mapGuildWars(context);
  mapSiteConfig(context);
  mapAuditAndErrors(context);
  context.mediaPlan = collectMediaPlan(context);
  return finishBundle(context, "phase-1", coreSql);
}

export type R2Inventory = Readonly<{
  version: 1;
  objects: readonly Readonly<{ sourceKey: string; byteSize: number; contentType: "image/webp" | "audio/ogg"; sha256?: string }>[];
}>;

export type R2CopyManifest = Readonly<{
  version: 1;
  objects: readonly Readonly<{
    mediaId: string;
    variant: "full" | "view";
    sourceKey: string;
    targetKey: string;
    byteSize: number;
    contentType: "image/webp" | "audio/ogg";
    sha256?: string;
  }>[];
}>;

export function buildR2CopyManifest(snapshotInput: unknown, inventoryInput: unknown): R2CopyManifest {
  const snapshot = parseLegacySnapshot(snapshotInput);
  const context = createContext(snapshot, { siteOwnerUserIds: [firstEligibleAdmin(snapshot) ?? "missing"] }, true);
  mapWiki(context);
  const requirements = collectMediaPlan(context);
  if (context.rejections.length > 0) throw new TypeError(formatRejections(context.rejections));
  const inventory = parseInventory(inventoryInput);
  const expectedKeys = new Set(requirements.map((entry) => entry.sourceKey));
  const inventoryByKey = new Map(inventory.objects.map((entry) => [entry.sourceKey, entry]));
  const missing = [...expectedKeys].filter((key) => !inventoryByKey.has(key));
  const unknown = [...inventoryByKey.keys()].filter((key) => !expectedKeys.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    throw new TypeError(`R2 inventory does not exactly match referenced source keys; missing=${missing.join(",") || "none"}; unknown=${unknown.join(",") || "none"}`);
  }
  const objects = requirements.flatMap((requirement) => {
    const source = inventoryByKey.get(requirement.sourceKey)!;
    const expectedType = requirement.mediaType === "audio" ? "audio/ogg" : "image/webp";
    if (source.contentType !== expectedType) throw new TypeError(`R2 source ${source.sourceKey} has ${source.contentType}; expected ${expectedType}`);
    const variants = requirement.mediaType === "audio" ? ["full"] as const : ["full", "view"] as const;
    return variants.map((variant) => Object.freeze({
      mediaId: requirement.mediaId,
      variant,
      sourceKey: source.sourceKey,
      targetKey: requirement.mediaType === "audio"
        ? `media/${requirement.mediaId}/full.opus`
        : `media/${requirement.mediaId}/${variant}.webp`,
      byteSize: source.byteSize,
      contentType: source.contentType,
      ...(source.sha256 ? { sha256: source.sha256 } : {}),
    }));
  }).sort((left, right) => left.targetKey.localeCompare(right.targetKey));
  return Object.freeze({ version: 1, objects: Object.freeze(objects) });
}

export function buildPhase2Migration(
  snapshotInput: unknown,
  optionsInput: MigrationOptions,
  r2ManifestText: string,
  reconciliationInput: unknown,
  coreSql?: string,
): MigrationBundle {
  const context = createContext(snapshotInput, optionsInput);
  const phase1 = buildPhase1Migration(context.snapshot, optionsInput);
  context.mediaPlan = [...phase1.mediaPlan];
  const manifest = parseCopyManifest(JSON.parse(r2ManifestText) as unknown);
  const reportObjects = parseSuccessfulReconciliation(reconciliationInput, digest(r2ManifestText), manifest);
  mapMediaPhase2(context, manifest, reportObjects);
  if (!phase1.ready) context.rejections.push(...phase1.report.rejections);
  return finishBundle(context, "phase-2", coreSql, phase1.batches.flatMap((batch) => statementsFromBatch(batch.sql)));
}

function createContext(snapshotInput: unknown, optionsInput: MigrationOptions, allowMissingOwner = false): Context {
  const snapshot = parseLegacySnapshot(snapshotInput);
  const options = parseOptions(snapshot, optionsInput, allowMissingOwner);
  return {
    snapshot,
    options,
    groups: [],
    rejections: [],
    skipped: [],
    transformations: [],
    preservedRecords: [],
    mediaPlan: [],
    wikiSnapshots: new Map(),
  };
}

function parseOptions(snapshot: LegacySnapshot, input: MigrationOptions, allowMissingOwner: boolean): MigrationOptions {
  if (!isRecord(input) || !Array.isArray(input.siteOwnerUserIds)) throw new TypeError("siteOwnerUserIds must be an array");
  const ownerIds = [...new Set(input.siteOwnerUserIds)];
  if (!allowMissingOwner && ownerIds.length === 0) throw new TypeError("At least one --site-owner-user-id is required");
  const users = indexBy(tableRows(snapshot, "users"), "id");
  for (const id of ownerIds) {
    if (typeof id !== "string" || id.length === 0) throw new TypeError("siteOwnerUserIds must contain non-empty strings");
    const user = users.get(id);
    if (!user && allowMissingOwner) continue;
    if (!user || user.role !== "admin" || user.is_active !== 1 || user.deleted_at !== null) {
      throw new TypeError(`Site owner candidate ${id} must be an active, non-deleted legacy admin`);
    }
  }
  return Object.freeze({ siteOwnerUserIds: Object.freeze(ownerIds.sort()) });
}

function firstEligibleAdmin(snapshot: LegacySnapshot): string | null {
  return tableRows(snapshot, "users")
    .filter((row) => row.role === "admin" && row.is_active === 1 && row.deleted_at === null)
    .map((row) => requiredString(row, "id"))
    .sort()[0] ?? null;
}

function registerSkipsAndArchives(context: Context): void {
  for (const [table, reason] of Object.entries(TRANSIENT_TABLES) as [LegacyTable, string][]) {
    context.skipped.push({ table, rowCount: tableRows(context.snapshot, table).length, reason });
  }
  preserveTable(context, "game_data");
  preserveTable(context, "onboarding_config");
  preserveTable(context, "member_onboarding_state");
  const errorContexts = tableRows(context.snapshot, "error_log")
    .filter((row) => row.context !== null)
    .map((row) => ({ id: row.id, context: row.context } as unknown as Row));
  if (errorContexts.length > 0) preserveRows(context, "error_log_context", errorContexts);
}

function preserveTable(context: Context, table: LegacyTable): void {
  const rows = tableRows(context.snapshot, table);
  if (rows.length > 0) preserveRows(context, table, rows);
}

function preserveRows(context: Context, name: string, rows: readonly Row[]): void {
  const ordered = [...rows].sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  const ndjson = ordered.map(stableStringify).join("\n") + "\n";
  context.preservedRecords.push(Object.freeze({
    table: name,
    objectKey: `migration-preserved/d1/${name}.ndjson`,
    contentType: "application/x-ndjson",
    rowCount: ordered.length,
    byteLength: Buffer.byteLength(ndjson),
    sha256: digest(ndjson),
    ndjson,
  }));
}

function mapIdentity(context: Context): void {
  eachRow(context, "roles", (row, key) => {
    const id = requiredString(row, "id");
    if (BUILT_IN_ROLES.has(id)) {
      context.transformations.push({ table: "roles", rowKey: key, detail: "Retained canonical target built-in role definition" });
      return;
    }
    const level = requiredInteger(row, "level");
    if (level < 1 || level > 999) throw new TypeError("Custom role level must be between 1 and 999");
    addInsert(context, 10, "roles", key, "roles", {
      id, name: row.name, level, color: row.color,
      revision_token: revisionToken("role", id, row), created_at: row.created_at, updated_at: row.updated_at,
    });
  });

  const permissionsByRole = groupBy(tableRows(context.snapshot, "role_permissions"), (row) => requiredString(row, "role_id"));
  for (const [roleId, rows] of sortedEntries(permissionsByRole)) {
    if (BUILT_IN_ROLES.has(roleId)) {
      context.transformations.push({ table: "role_permissions", rowKey: roleId, detail: "Retained canonical target permission set for built-in role; legacy grants were superseded by the new permission model" });
      continue;
    }
    const statements: Statement[] = [statement("role_permissions", roleId, "delete-seed", deleteSql("role_permissions", { role_id: roleId }))];
    for (const row of [...rows].sort(compareRows("permission"))) {
      const granted = requiredInteger(row, "granted");
      if (granted !== 0 && granted !== 1) throw new TypeError(`role_permissions ${roleId} granted must be 0 or 1`);
      if (granted === 1) statements.push(statement("role_permissions", `${roleId}:${row.permission}`, "insert", insertSql("role_permissions", {
        role_id: roleId, permission: row.permission,
      })));
      else context.transformations.push({ table: "role_permissions", rowKey: `${roleId}:${row.permission}`, detail: "Legacy denied permission remains absent in grant-only target table" });
    }
    addGroup(context, 11, roleId, statements);
  }

  const owners = new Set(context.options.siteOwnerUserIds);
  eachRow(context, "users", (row, key) => {
    const promoted = owners.has(requiredString(row, "id"));
    addInsert(context, 12, "users", key, "users", {
      id: row.id,
      username: row.username,
      role_id: promoted ? "site_owner" : row.role,
      is_active: row.is_active,
      deleted_at: row.deleted_at,
      revision_token: revisionToken("user", requiredString(row, "id"), row),
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    if (promoted) context.transformations.push({ table: "users", rowKey: key, detail: "Explicitly promoted selected active legacy admin to site_owner" });
  });

  eachRow(context, "user_auth_password", (row, key) => addInsert(context, 13, "user_auth_password", key, "user_credentials", {
    user_id: row.user_id,
    password_hash: convertLegacyWorkerPasswordHash({
      passwordHash: requiredString(row, "password_hash"),
      salt: requiredString(row, "salt"),
    }),
    updated_at: row.updated_at,
  }));
}

function mapCatalogAndMembers(context: Context): void {
  eachRow(context, "class_catalog", (row, key) => addInsert(context, 20, "class_catalog", key, "class_catalog", {
    id: row.id, label: row.label, color: row.color, icon_type: row.icon_type, vector_icon: row.vector_icon,
    sort_order: row.sort_order, created_at: row.created_at, updated_at: row.updated_at,
  }));
  copyRows(context, 21, "class_tags", "class_tags", LEGACY_COLUMNS.class_tags);
  copyRows(context, 22, "class_tag_members", "class_tag_members", LEGACY_COLUMNS.class_tag_members);
  copyRows(context, 20, "member_badges", "member_badges", LEGACY_COLUMNS.member_badges);

  eachRow(context, "member_profiles", (row, key) => {
    const availability = parseAvailability(row.availability, key);
    if (availability.wasLegacyFormat) context.transformations.push({
      table: "member_profiles",
      rowKey: key,
      detail: "Converted legacy weekly active_times into UTC weekday windows",
    });
    addInsert(context, 21, "member_profiles", key, "member_profiles", {
      user_id: row.user_id, power: row.power, title_html: row.title_html, bio: row.bio,
      availability_timezone: availability.timezone, notes: row.notes,
      revision_token: revisionToken("member_profile", requiredString(row, "user_id"), row),
      created_at: row.created_at, updated_at: row.updated_at,
    });
    for (const window of availability.windows) addInsert(context, 22, "member_profiles", `${key}:availability:${window.weekday}:${window.startMinute}`, "member_availability_windows", {
      user_id: row.user_id, weekday: window.weekday, start_minute: window.startMinute, end_minute: window.endMinute,
    });
    const videos = parseJsonArray(row.video_urls, `member_profiles ${key} video_urls`);
    videos.forEach((url, index) => {
      if (typeof url !== "string" || url.length === 0) throw new TypeError(`member_profiles ${key} video_urls must contain non-empty strings`);
      addInsert(context, 22, "member_profiles", `${key}:video:${index}`, "member_profile_videos", { user_id: row.user_id, url, sort_order: index });
    });
  });
  copyRows(context, 22, "member_profile_classes", "member_profile_classes", LEGACY_COLUMNS.member_profile_classes);
  copyRows(context, 22, "member_absences", "member_absences", LEGACY_COLUMNS.member_absences);
  copyRows(context, 23, "member_badge_assignments", "member_badge_assignments", LEGACY_COLUMNS.member_badge_assignments);
}

function parseAvailability(value: Scalar, key: string): Readonly<{ timezone: string | null; windows: readonly Readonly<{ weekday: number; startMinute: number; endMinute: number }>[]; wasLegacyFormat: boolean }> {
  if (value === null || value === "") return { timezone: null, windows: [], wasLegacyFormat: false };
  if (typeof value !== "string") throw new TypeError(`member_profiles ${key} availability must be JSON text or null`);
  const parsed = parseJsonRecord(value, `member_profiles ${key} availability`);
  if (Object.hasOwn(parsed, "active_times")) return parseLegacyAvailability(parsed, key);
  const allowed = new Set(["timezone", "days", "all_day"]);
  assertOnlyKeys(parsed, allowed, `member_profiles ${key} availability`);
  const timezone = parsed.timezone === undefined ? "UTC" : nonEmptyString(parsed.timezone, "availability timezone");
  if (parsed.all_day === true) {
    if (parsed.days !== undefined) throw new TypeError(`member_profiles ${key} all_day availability cannot also contain days`);
    return { timezone, windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })), wasLegacyFormat: false };
  }
  if (parsed.all_day !== undefined && parsed.all_day !== false) throw new TypeError(`member_profiles ${key} all_day must be boolean`);
  if (!isRecord(parsed.days)) throw new TypeError(`member_profiles ${key} availability days must be an object`);
  const dayNumbers: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  assertExactKeys(parsed.days, Object.keys(dayNumbers), `member_profiles ${key} availability days`);
  const windows: { weekday: number; startMinute: number; endMinute: number }[] = [];
  for (const [day, weekday] of Object.entries(dayNumbers)) {
    const entries = parsed.days[day];
    if (!Array.isArray(entries)) throw new TypeError(`member_profiles ${key} availability ${day} must be an array`);
    for (const [index, entry] of entries.entries()) {
      if (!isRecord(entry)) throw new TypeError(`member_profiles ${key} availability ${day}[${index}] must be an object`);
      assertExactKeys(entry, ["start_utc", "end_utc"], `member_profiles ${key} availability window`);
      const startMinute = parseClock(entry.start_utc, false);
      const endMinute = parseClock(entry.end_utc, true);
      if (startMinute >= endMinute) throw new TypeError(`member_profiles ${key} availability window must have start before end`);
      windows.push({ weekday, startMinute, endMinute });
    }
  }
  return { timezone, windows, wasLegacyFormat: false };
}

function parseLegacyAvailability(parsed: Record<string, unknown>, key: string): Readonly<{ timezone: "UTC"; windows: readonly Readonly<{ weekday: number; startMinute: number; endMinute: number }>[]; wasLegacyFormat: true }> {
  assertExactKeys(parsed, ["active_times"], `member_profiles ${key} legacy availability`);
  if (!Array.isArray(parsed.active_times)) throw new TypeError(`member_profiles ${key} active_times must be an array`);
  const windows: { weekday: number; startMinute: number; endMinute: number }[] = [];
  for (const [index, raw] of parsed.active_times.entries()) {
    if (!isRecord(raw)) throw new TypeError(`member_profiles ${key} active_times[${index}] must be an object`);
    assertExactKeys(raw, ["startDay", "startMin", "endDay", "endMin"], `member_profiles ${key} active_times[${index}]`);
    const startDay = boundedInteger(raw.startDay, 0, 7, "availability startDay");
    const endDay = boundedInteger(raw.endDay, 0, 7, "availability endDay");
    const startMinute = boundedInteger(raw.startMin, 0, 1439, "availability startMin");
    const endMinute = boundedInteger(raw.endMin, 0, 1440, "availability endMin");
    if (endDay < startDay || endDay > startDay + 1) throw new TypeError(`member_profiles ${key} active_times[${index}] spans an unsupported day range`);
    if (endDay === startDay) {
      if (startMinute >= endMinute) throw new TypeError(`member_profiles ${key} active_times[${index}] must have start before end`);
      windows.push({ weekday: startDay % 7, startMinute, endMinute });
      continue;
    }
    windows.push({ weekday: startDay % 7, startMinute, endMinute: 1440 });
    if (endMinute > 0) windows.push({ weekday: endDay % 7, startMinute: 0, endMinute });
  }
  const unique = new Map(windows.map((window) => [`${window.weekday}:${window.startMinute}:${window.endMinute}`, window]));
  return {
    timezone: "UTC",
    windows: Object.freeze([...unique.values()].sort((left, right) => left.weekday - right.weekday || left.startMinute - right.startMinute || left.endMinute - right.endMinute)),
    wasLegacyFormat: true,
  };
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  return Number(value);
}

function parseClock(value: unknown, allowEndOfDay: boolean): number {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) throw new TypeError(`Invalid UTC clock ${String(value)}`);
  const [hour, minute] = value.split(":").map(Number) as [number, number];
  if (hour === 24 && minute === 0 && allowEndOfDay) return 1440;
  if (hour > 23 || minute > 59) throw new TypeError(`Invalid UTC clock ${value}`);
  return hour * 60 + minute;
}

function mapEventsAndContent(context: Context): void {
  eachRow(context, "recurring_templates", (row, key) => {
    const rule = parseRecurrenceRule(row.recurrence_rule, key);
    addInsert(context, 30, "recurring_templates", key, "recurring_templates", {
      id: row.id, type: row.type, title: row.title, description: row.description, start_time: row.start_time,
      duration_minutes: row.duration_minutes, capacity: row.capacity,
      recurrence_frequency: rule.frequency, recurrence_interval: rule.interval,
      recurrence_day_of_month: rule.dayOfMonth, recurrence_end_after: rule.endAfter, recurrence_end_at: rule.endAt,
      visibility_offset_minutes: row.visibility_offset_minutes, auto_archive: row.auto_archive, paused: row.paused,
      created_by: row.created_by, last_generated_date: row.last_generated_date, generation_count: row.generation_count,
      created_at: row.created_at, updated_at: row.updated_at,
    });
    for (const weekday of rule.weekdays) addInsert(context, 31, "recurring_templates", `${key}:weekday:${weekday}`, "recurring_template_weekdays", {
      template_id: row.id, weekday,
    });
  });
  copyRows(context, 32, "recurring_template_class_quotas", "recurring_template_class_quotas", LEGACY_COLUMNS.recurring_template_class_quotas);
  const participantsByEvent = groupBy(tableRows(context.snapshot, "event_participants"), (row) => requiredString(row, "event_id"));
  eachRow(context, "events", (row, key) => {
    const participantCount = participantsByEvent.get(requiredString(row, "id"))?.length ?? 0;
    if (participantCount > 500) throw new TypeError("Target supports at most 500 event participants");
    const staged = participantCount > 0;
    addInsert(context, 33, "events", key, "events", staged ? {
      ...pick(row, LEGACY_COLUMNS.events),
      type: row.type === "poll" || row.type === "raffle" ? "other" : row.type,
      end_at: null,
      capacity: Math.max(typeof row.capacity === "number" ? row.capacity : 0, participantCount) || null,
      archived_at: null,
      winner_count: null,
    } : pick(row, LEGACY_COLUMNS.events));
    if (staged) {
      addStatement(context, 35, "events", `${key}:restore`, "update", updateSql("events", {
        type: row.type, end_at: row.end_at, capacity: row.capacity, archived_at: row.archived_at, winner_count: row.winner_count,
      }, { id: row.id }));
      context.transformations.push({ table: "events", rowKey: key, detail: "Temporarily opened event while importing immutable participant rows, then restored exact state" });
    }
  });
  copyRows(context, 34, "event_class_quotas", "event_class_quotas", LEGACY_COLUMNS.event_class_quotas);
  copyRows(context, 34, "event_participants", "event_participants", LEGACY_COLUMNS.event_participants);
  copyRows(context, 36, "event_polls", "event_polls", LEGACY_COLUMNS.event_polls);
  copyRows(context, 37, "event_poll_options", "event_poll_options", LEGACY_COLUMNS.event_poll_options);
  copyRows(context, 38, "event_poll_votes", "event_poll_votes", ["event_id", "option_id", "user_id", "created_at"]);
  mapRaffleDraws(context);

  eachRow(context, "announcements", (row, key) => addInsert(context, 39, "announcements", key, "announcements", {
    ...pick(row, LEGACY_COLUMNS.announcements), revision_token: revisionToken("announcement", requiredString(row, "id"), row),
  }));
  eachRow(context, "gallery_items", (row, key) => addInsert(context, 39, "gallery_items", key, "gallery_items", {
    id: row.id, type: row.type, url: row.type === "image" ? null : row.url, caption: row.caption,
    uploaded_by: row.uploaded_by, revision_token: revisionToken("gallery_item", requiredString(row, "id"), row), created_at: row.created_at,
  }));
}

function parseRecurrenceRule(value: Scalar, key: string): Readonly<{ frequency: string; interval: number; weekdays: readonly number[]; dayOfMonth: number | null; endAfter: number | null; endAt: string | null }> {
  if (typeof value !== "string") throw new TypeError(`recurring_templates ${key} recurrence_rule must be JSON text`);
  const rule = parseJsonRecord(value, `recurring_templates ${key} recurrence_rule`);
  assertOnlyKeys(rule, new Set(["frequency", "interval", "daysOfWeek", "dayOfMonth", "endAfter", "endDate"]), `recurring_templates ${key} recurrence_rule`);
  const frequency = nonEmptyString(rule.frequency, "recurrence frequency");
  if (!["daily", "weekly", "monthly"].includes(frequency)) throw new TypeError(`recurring_templates ${key} has unsupported recurrence frequency`);
  const interval = positiveInteger(rule.interval, "recurrence interval");
  const weekdays = rule.daysOfWeek === undefined ? [] : integerArray(rule.daysOfWeek, "recurrence daysOfWeek");
  if (weekdays.some((day) => day < 0 || day > 6) || new Set(weekdays).size !== weekdays.length) throw new TypeError(`recurring_templates ${key} has invalid or duplicate weekdays`);
  if (frequency === "weekly" && weekdays.length === 0) throw new TypeError(`recurring_templates ${key} weekly rule has no weekdays`);
  if (frequency !== "weekly" && weekdays.length > 0) throw new TypeError(`recurring_templates ${key} non-weekly rule has weekdays`);
  const dayOfMonth = rule.dayOfMonth === undefined ? null : positiveInteger(rule.dayOfMonth, "recurrence dayOfMonth");
  if ((frequency === "monthly") !== (dayOfMonth !== null) || (dayOfMonth !== null && dayOfMonth > 31)) throw new TypeError(`recurring_templates ${key} has invalid monthly day`);
  const endAfter = rule.endAfter === undefined ? null : positiveInteger(rule.endAfter, "recurrence endAfter");
  const endAt = rule.endDate === undefined ? null : nonEmptyString(rule.endDate, "recurrence endDate");
  if (endAfter !== null && endAt !== null) throw new TypeError(`recurring_templates ${key} cannot have both endAfter and endDate`);
  return { frequency, interval, weekdays: [...weekdays].sort((a, b) => a - b), dayOfMonth, endAfter, endAt };
}

function mapRaffleDraws(context: Context): void {
  const events = indexBy(tableRows(context.snapshot, "events"), "id");
  const groups = groupBy(tableRows(context.snapshot, "event_raffle_winners"), (row) => requiredString(row, "event_id"));
  for (const [eventId, winners] of sortedEntries(groups)) {
    const event = events.get(eventId);
    if (!event) { reject(context, "event_raffle_winners", eventId, "missing_event", "Raffle winners reference a missing event"); continue; }
    const dates = new Set(winners.map((row) => requiredString(row, "drawn_at")));
    if (dates.size !== 1) { reject(context, "event_raffle_winners", eventId, "multiple_draws", "Legacy winners contain multiple draw timestamps"); continue; }
    addInsert(context, 38, "event_raffle_winners", `${eventId}:draw`, "event_raffle_draws", {
      event_id: eventId, winner_count: winners.length, drawn_by: event.updated_by ?? event.created_by,
      drawn_at: [...dates][0]!, mutation_token: stableId("raffle-draw", eventId),
    });
    for (const row of winners) addInsert(context, 39, "event_raffle_winners", rowKey("event_raffle_winners", row, 0), "event_raffle_winners", row);
  }
}

function mapWiki(context: Context): void {
  const categories = orderWikiCategories(context, tableRows(context.snapshot, "wiki_categories"));
  for (const row of categories) addInsert(context, 40, "wiki_categories", requiredString(row, "id"), "wiki_categories", {
    ...pick(row, LEGACY_COLUMNS.wiki_categories), revision_token: revisionToken("wiki_category", requiredString(row, "id"), row),
  });
  if (categories.length > 0) addStatement(context, 41, "wiki_category_state", "state", "update", updateSql("wiki_category_state", {
    revision_token: revisionToken("wiki_category_state", "1", categories),
    updated_at: [...categories].map((row) => requiredString(row, "updated_at")).sort().at(-1)!,
  }, { singleton: 1 }));

  const revisions = groupBy(tableRows(context.snapshot, "wiki_revisions"), (row) => requiredString(row, "article_id"));
  const articleIds = new Set(tableRows(context.snapshot, "wiki_articles").map((row) => requiredString(row, "id")));
  for (const articleId of revisions.keys()) if (!articleIds.has(articleId)) reject(context, "wiki_revisions", articleId, "missing_article", "Revision references a missing article");
  for (const article of [...tableRows(context.snapshot, "wiki_articles")].sort(compareRows("id"))) {
    mapWikiArticle(context, article, revisions.get(requiredString(article, "id")) ?? []);
  }
}

function mapWikiArticle(context: Context, article: Row, revisions: readonly Row[]): void {
  const articleId = requiredString(article, "id");
  const ordered = [...revisions].sort((left, right) => requiredInteger(left, "revision") - requiredInteger(right, "revision") || requiredString(left, "id").localeCompare(requiredString(right, "id")));
  const seen = new Set<number>();
  for (const revision of ordered) {
    const number = requiredInteger(revision, "revision");
    if (number < 1 || seen.has(number)) { reject(context, "wiki_revisions", rowKey("wiki_revisions", revision, 0), "invalid_revision", "Revision numbers must be unique positive integers"); return; }
    if (revision.restored_from !== null && (typeof revision.restored_from !== "number" || !seen.has(revision.restored_from))) {
      reject(context, "wiki_revisions", rowKey("wiki_revisions", revision, 0), "invalid_restore_source", "restored_from must reference an earlier revision"); return;
    }
    seen.add(number);
  }
  const snapshots = [...ordered];
  const last = snapshots.at(-1);
  if (!last || last.title !== article.title || last.body_json !== article.body_json) {
    const revision = last ? requiredInteger(last, "revision") + 1 : 1;
    snapshots.push({
      id: stableId("wiki-revision", `${articleId}:${revision}`), article_id: articleId, revision,
      title: article.title, body_json: article.body_json, edited_by: article.updated_by ?? article.created_by,
      restored_from: null, created_at: article.updated_at,
    } as unknown as Row);
    context.transformations.push({ table: "wiki_articles", rowKey: articleId, detail: last ? "Added final immutable revision for newer article state" : "Created revision 1 for article without legacy history" });
  }
  context.wikiSnapshots.set(articleId, Object.freeze(snapshots.map((row) => Object.freeze({ ...row }))));
  if (ordered.length > 0) context.transformations.push({ table: "wiki_revisions", rowKey: articleId, detail: "Backfilled immutable article metadata into every revision" });
  const first = snapshots[0]!;
  addInsert(context, 42, "wiki_articles", articleId, "wiki_articles", wikiArticleValues(article, first));
  addInsert(context, 42, "wiki_revisions", `${articleId}:${first.revision}`, "wiki_revisions", wikiRevisionValues(article, first));
  for (const revision of snapshots.slice(1)) {
    const number = requiredInteger(revision, "revision");
    addGroup(context, 43, `${articleId}:${String(number).padStart(12, "0")}`, [
      statement("wiki_articles", articleId, `revision-${number}`, updateSql("wiki_articles", { title: revision.title, body_json: revision.body_json, current_revision: number }, { id: articleId })),
      statement("wiki_revisions", `${articleId}:${number}`, "insert", insertSql("wiki_revisions", wikiRevisionValues(article, revision))),
    ]);
  }
}

function wikiArticleValues(article: Row, revision: Row): SqlValues {
  return {
    id: article.id, title: revision.title, slug: article.slug, category_id: article.category_id, body_json: revision.body_json,
    sort_order: article.sort_order, pinned: article.pinned, archived_at: article.archived_at, deleted_at: null,
    created_by: article.created_by, updated_by: article.updated_by, current_revision: revision.revision,
    revision_token: revisionToken("wiki_article", requiredString(article, "id"), article),
    created_at: article.created_at, updated_at: article.updated_at,
  };
}

function wikiRevisionValues(article: Row, revision: Row): SqlValues {
  return {
    id: revision.id, article_id: revision.article_id, revision: revision.revision, title: revision.title,
    slug: article.slug, category_id: article.category_id, body_json: revision.body_json, sort_order: article.sort_order,
    pinned: article.pinned, archived_at: article.archived_at, deleted_at: null, edited_by: revision.edited_by,
    restored_from: revision.restored_from, created_at: revision.created_at,
  };
}

function orderWikiCategories(context: Context, rows: readonly Row[]): Row[] {
  const byId = indexBy(rows, "id");
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (depths.has(id)) return depths.get(id)!;
    if (visiting.has(id)) throw new TypeError(`Wiki category cycle at ${id}`);
    const row = byId.get(id);
    if (!row) throw new TypeError(`Missing wiki category ${id}`);
    visiting.add(id);
    const parent = nullableString(row, "parent_id");
    const result = parent === null ? 0 : depth(parent) + 1;
    visiting.delete(id);
    if (result > 1) throw new TypeError(`Wiki category ${id} exceeds target depth limit`);
    depths.set(id, result);
    return result;
  };
  try { for (const id of [...byId.keys()].sort()) depth(id); }
  catch (error) { reject(context, "wiki_categories", "tree", "invalid_tree", message(error)); return []; }
  return [...rows].sort((left, right) => depth(requiredString(left, "id")) - depth(requiredString(right, "id")) || compareRows("id")(left, right));
}

function mapStorage(context: Context): void {
  copyRows(context, 50, "storages", "storages", LEGACY_COLUMNS.storages);
  copyRows(context, 51, "storage_categories", "storage_categories", LEGACY_COLUMNS.storage_categories);
  eachRow(context, "storage_items", (row, key) => addInsert(context, 52, "storage_items", key, "storage_items", {
    id: row.id, storage_id: row.storage_id, category_id: row.category_id, name: row.name, description: row.description,
    allow_member_deposit: row.allow_member_deposit, allow_member_withdraw: row.allow_member_withdraw,
    created_at: row.created_at, updated_at: row.updated_at,
  }));
  const transactions = [...tableRows(context.snapshot, "storage_transactions")].sort((left, right) => compareTextFields(left, right, ["created_at", "id"]));
  const migrationActor = selectMigrationActor(context.snapshot, context.options.siteOwnerUserIds);
  const byItem = groupBy(transactions, (row) => requiredString(row, "item_id"));
  for (const item of tableRows(context.snapshot, "storage_items")) {
    const itemId = requiredString(item, "id");
    let running = 0;
    let minimum = 0;
    for (const row of byItem.get(itemId) ?? []) { running += requiredNumber(row, "quantity_delta"); minimum = Math.min(minimum, running); }
    const opening = -minimum;
    const closing = requiredNumber(item, "quantity") - opening - running;
    if ((opening !== 0 || closing !== 0) && migrationActor === null) { reject(context, "storage_items", itemId, "missing_migration_actor", "Storage reconciliation requires an active user"); continue; }
    if (opening !== 0) addStorageAdjustment(context, item, migrationActor!, opening, "opening", 53);
    if (closing !== 0) addStorageAdjustment(context, item, migrationActor!, closing, "closing", 56);
  }
  for (const row of transactions) addStorageTransaction(context, row);
}

function addStorageTransaction(context: Context, row: Row): void {
  const id = requiredString(row, "id");
  const delta = requiredNumber(row, "quantity_delta");
  if (delta === 0 || Math.abs(delta) > 1_000_000) { reject(context, "storage_transactions", id, "invalid_delta", "Target ledger delta must be nonzero and at most 1,000,000"); return; }
  const batchId = stableId("storage-batch", id);
  addGroup(context, 55, `${requiredString(row, "created_at")}:${id}`, [
    statement("storage_batches", batchId, "insert", insertSql("storage_batches", {
      id: batchId, actor_id: row.actor_id, idempotency_key: null, access_mode: "stock_admin", transaction_type: row.type,
      recipient_user_id: row.recipient_user_id, note: row.note, created_at: row.created_at,
    })),
    statement("storage_transactions", id, "insert", insertSql("storage_ledger_entries", {
      id, item_id: row.item_id, batch_id: batchId, batch_position: 0, type: row.type, quantity_delta: delta,
      recipient_user_id: row.recipient_user_id, note: row.note, actor_id: row.actor_id, created_at: row.created_at,
    })),
  ]);
}

function addStorageAdjustment(context: Context, item: Row, actorId: string, delta: number, kind: "opening" | "closing", phase: number): void {
  const itemId = requiredString(item, "id");
  let remaining = delta;
  let ordinal = 0;
  while (remaining !== 0) {
    const part = Math.abs(remaining) > 1_000_000 ? Math.sign(remaining) * 1_000_000 : remaining;
    const key = `${itemId}:${kind}:${ordinal++}`;
    const batchId = stableId("storage-reconciliation-batch", key);
    const entryId = stableId("storage-reconciliation-entry", key);
    const note = `Imported ${kind} balance reconciliation`;
    const createdAt = requiredString(item, kind === "opening" ? "created_at" : "updated_at");
    addGroup(context, phase, key, [
      statement("storage_batches", batchId, "insert", insertSql("storage_batches", { id: batchId, actor_id: actorId, idempotency_key: null, access_mode: "stock_admin", transaction_type: "adjust", recipient_user_id: null, note, created_at: createdAt })),
      statement("storage_ledger_entries", entryId, "insert", insertSql("storage_ledger_entries", { id: entryId, item_id: itemId, batch_id: batchId, batch_position: 0, type: "adjust", quantity_delta: part, recipient_user_id: null, note, actor_id: actorId, created_at: createdAt })),
    ]);
    remaining -= part;
  }
  context.transformations.push({ table: "storage_items", rowKey: itemId, detail: `Recorded explicit ${kind} ledger adjustment ${delta}` });
}

function selectMigrationActor(snapshot: LegacySnapshot, preferred: readonly string[]): string | null {
  if (preferred.length > 0) return preferred[0]!;
  return tableRows(snapshot, "users").find((row) => row.is_active === 1 && row.deleted_at === null)?.id as string | undefined ?? null;
}

function mapGuildWars(context: Context): void {
  const events = indexBy(tableRows(context.snapshot, "events"), "id");
  const histories = indexBy(tableRows(context.snapshot, "war_history"), "id");
  const teams = tableRows(context.snapshot, "war_teams");
  const teamById = indexBy(teams, "id");
  const activeEvents = new Set<string>();
  for (const row of [...teams, ...tableRows(context.snapshot, "war_pool_members")]) {
    const eventId = nullableString(row, "event_id");
    if (eventId !== null) activeEvents.add(eventId);
  }
  const activeWarIds = new Map<string, string>();
  for (const eventId of [...activeEvents].sort()) {
    const event = events.get(eventId);
    if (!event) { reject(context, "war_teams", eventId, "missing_event", "Active war references missing event"); continue; }
    const id = stableId("active-war", eventId);
    activeWarIds.set(eventId, id);
    addInsert(context, 60, "guild_wars", id, "guild_wars", guildWarValues({ id, eventId, status: "active", warName: requiredString(event, "title"), history: null, createdBy: requiredString(event, "created_by"), updatedBy: nullableString(event, "updated_by"), createdAt: requiredString(event, "created_at"), updatedAt: requiredString(event, "updated_at") }));
  }
  for (const [id, history] of sortedEntries(histories)) {
    if (history.result === null) { reject(context, "war_history", id, "missing_result", "Concluded legacy war has no result"); continue; }
    const eventId = nullableString(history, "event_id");
    if (eventId !== null && !events.has(eventId)) { reject(context, "war_history", id, "missing_event", "War history references missing event"); continue; }
    addInsert(context, 60, "war_history", id, "guild_wars", guildWarValues({ id, eventId, status: "concluded", warName: requiredString(history, "war_name"), history, createdBy: requiredString(history, "created_by"), updatedBy: nullableString(history, "updated_by"), createdAt: requiredString(history, "created_at"), updatedAt: requiredString(history, "updated_at") }));
  }
  const warForParent = (row: Row): string | null => {
    const historyId = nullableString(row, "war_history_id");
    if (historyId !== null) return histories.has(historyId) ? historyId : null;
    const eventId = nullableString(row, "event_id");
    return eventId === null ? null : activeWarIds.get(eventId) ?? null;
  };
  for (const row of teams) {
    const id = requiredString(row, "id");
    const warId = warForParent(row);
    if (!warId) { reject(context, "war_teams", id, "missing_war", "Team parent could not be mapped"); continue; }
    addInsert(context, 61, "war_teams", id, "war_teams", { id, war_id: warId, team_name: row.team_name, sort_order: row.sort_order, notes: row.notes, is_locked: row.is_locked });
  }
  const seenUsers = new Set<string>();
  for (const row of tableRows(context.snapshot, "war_team_members")) {
    const id = requiredString(row, "id");
    const team = teamById.get(requiredString(row, "war_team_id"));
    const warId = team ? warForParent(team) : null;
    if (!team || !warId) { reject(context, "war_team_members", id, "missing_team", "Team member parent could not be mapped"); continue; }
    const uniqueness = `${warId}:${row.user_id}`;
    if (seenUsers.has(uniqueness)) { reject(context, "war_team_members", id, "duplicate_war_user", "Target war roster allows one row per user"); continue; }
    seenUsers.add(uniqueness);
    addInsert(context, 62, "war_team_members", id, "war_members", warMemberValues(row, warId, requiredString(team, "id")));
  }
  for (const row of tableRows(context.snapshot, "war_pool_members")) {
    const id = requiredString(row, "id");
    const warId = warForParent(row);
    if (!warId) { reject(context, "war_pool_members", id, "missing_war", "Pool member parent could not be mapped"); continue; }
    const uniqueness = `${warId}:${row.user_id}`;
    if (seenUsers.has(uniqueness)) { reject(context, "war_pool_members", id, "duplicate_war_user", "Target war roster allows one row per user"); continue; }
    seenUsers.add(uniqueness);
    addInsert(context, 62, "war_pool_members", id, "war_members", { id, war_id: warId, team_id: null, user_id: row.user_id, role_tag: null, sort_order: 0, kills: null, deaths: null, assists: null, damage: null, healing: null, building_damage: null, credits: null, damage_taken: null, note: null });
  }
}

function guildWarValues(input: Readonly<{ id: string; eventId: string | null; status: "active" | "concluded"; warName: string; history: Row | null; createdBy: string; updatedBy: string | null; createdAt: string; updatedAt: string }>): SqlValues {
  const own = input.history ? parseStatRecord(input.history.own_stats, ["kills", "towers", "base_hp", "credits", "distance"], `war_history ${input.id} own_stats`) : {};
  const enemy = input.history ? parseStatRecord(input.history.enemy_stats, ["kills", "towers", "base_hp", "credits", "distance"], `war_history ${input.id} enemy_stats`) : {};
  return {
    id: input.id, event_id: input.eventId, status: input.status, war_name: input.warName,
    enemy_name: input.history?.enemy_name ?? null, result: input.history?.result ?? null,
    own_kills: own.kills ?? null, own_towers: own.towers ?? null, own_base_hp: own.base_hp ?? null, own_credits: own.credits ?? null, own_distance: own.distance ?? null,
    enemy_kills: enemy.kills ?? null, enemy_towers: enemy.towers ?? null, enemy_base_hp: enemy.base_hp ?? null, enemy_credits: enemy.credits ?? null, enemy_distance: enemy.distance ?? null,
    duration_minutes: input.history?.duration_minutes ?? null, notes: input.history?.notes ?? null, roster_version: 0,
    mutation_token: stableId("guild-war-mutation", input.id), concluded_at: input.status === "concluded" ? input.updatedAt : null,
    created_by: input.createdBy, updated_by: input.updatedBy, created_at: input.createdAt, updated_at: input.updatedAt,
  };
}

function warMemberValues(row: Row, warId: string, teamId: string): SqlValues {
  const stats = parseStatRecord(row.stats, ["kills", "deaths", "assists", "damage", "healing", "building_damage", "credits", "damage_taken"], `war_team_members ${row.id} stats`);
  return { id: row.id, war_id: warId, team_id: teamId, user_id: row.user_id, role_tag: row.role_tag, sort_order: row.sort_order, kills: stats.kills ?? null, deaths: stats.deaths ?? null, assists: stats.assists ?? null, damage: stats.damage ?? null, healing: stats.healing ?? null, building_damage: stats.building_damage ?? null, credits: stats.credits ?? null, damage_taken: stats.damage_taken ?? null, note: row.note };
}

function parseStatRecord(value: Scalar, fields: readonly string[], label: string): Record<string, number> {
  if (value === null || value === "") return {};
  if (typeof value !== "string") throw new TypeError(`${label} must be JSON text or null`);
  const parsed = parseJsonRecord(value, label);
  assertOnlyKeys(parsed, new Set(fields), label);
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(parsed)) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) throw new TypeError(`${label}.${key} must be a finite nonnegative number`);
    result[key] = raw;
  }
  return result;
}

function mapSiteConfig(context: Context): void {
  const rows = tableRows(context.snapshot, "site_config");
  if (rows.length > 1) { reject(context, "site_config", "singleton", "multiple_rows", "Target site config is a singleton"); return; }
  const row = rows[0];
  if (!row) return;
  try {
    const features = parseJsonRecord(requiredString(row, "feature_flags_json"), "site_config feature_flags_json");
    assertOnlyKeys(features, new Set(["announcements", "events", "guildWar", "gallery", "wiki", "tools", "storage", "equipmentCalc"]), "site_config feature_flags_json");
    for (const key of ["announcements", "events", "guildWar", "gallery", "wiki", "tools", "storage"]) if (typeof features[key] !== "boolean") throw new TypeError(`site_config feature ${key} must be boolean`);
    if (features.equipmentCalc !== undefined) context.transformations.push({ table: "site_config", rowKey: requiredString(row, "id"), detail: "Legacy equipmentCalc feature is covered by the consolidated tools feature" });
    const media = parseJsonRecord(requiredString(row, "media_policy_json"), "site_config media_policy_json");
    assertExactKeys(media, ["max_file_size_bytes", "quotas"], "site_config media_policy_json");
    const max = recordValue(media.max_file_size_bytes, "site_config max_file_size_bytes");
    assertOnlyKeys(max, new Set(["site_logo", "profile_image", "profile_audio", "announcement_image", "wiki_image", "event_image", "gallery_image", "storage_image"]), "site_config max_file_size_bytes");
    for (const required of ["profile_image", "profile_audio", "announcement_image", "wiki_image", "event_image", "gallery_image"]) {
      if (!Object.hasOwn(max, required)) throw new TypeError(`site_config max_file_size_bytes is missing ${required}`);
    }
    if (!Object.hasOwn(max, "site_logo") || !Object.hasOwn(max, "storage_image")) context.transformations.push({
      table: "site_config",
      rowKey: requiredString(row, "id"),
      detail: "Filled new site-logo/storage-image limits from canonical target defaults",
    });
    const quotas = recordValue(media.quotas, "site_config quotas");
    assertExactKeys(quotas, ["profile", "announcement", "gallery", "wiki"], "site_config quotas");
    const storage = parseJsonRecord(requiredString(row, "storage_policy_json"), "site_config storage_policy_json");
    assertExactKeys(storage, ["images_per_item"], "site_config storage_policy_json");
    const absence = parseJsonRecord(requiredString(row, "absence_policy_json"), "site_config absence_policy_json");
    assertExactKeys(absence, ["max_span_days", "max_entries_per_user"], "site_config absence_policy_json");
    const analytics = parseJsonRecord(requiredString(row, "analytics_settings_json"), "site_config analytics_settings_json");
    assertExactKeys(analytics, ["reference_duration_minutes", "modifier_weights"], "site_config analytics_settings_json");
    const weights = recordValue(analytics.modifier_weights, "site_config modifier_weights");
    assertExactKeys(weights, ["kills", "towers", "base_hp", "credits", "distance"], "site_config modifier_weights");
    addStatement(context, 80, "site_config", requiredString(row, "id"), "update", updateSql("site_config", {
      site_name: row.site_name,
      site_logo_media_id: null,
      default_site_logo_url: row.site_logo_url,
      feature_announcements: boolInt(features.announcements), feature_events: boolInt(features.events), feature_guild_war: boolInt(features.guildWar),
      feature_gallery: boolInt(features.gallery), feature_wiki: boolInt(features.wiki), feature_tools: boolInt(features.tools), feature_storage: boolInt(features.storage),
      max_site_logo_bytes: max.site_logo === undefined ? LIMITS.media.maxFileSize.siteLogo : jsonFiniteNumber(max.site_logo, "max site_logo"), max_profile_image_bytes: jsonFiniteNumber(max.profile_image, "max profile_image"),
      max_profile_audio_bytes: jsonFiniteNumber(max.profile_audio, "max profile_audio"), max_announcement_image_bytes: jsonFiniteNumber(max.announcement_image, "max announcement_image"),
      max_wiki_image_bytes: jsonFiniteNumber(max.wiki_image, "max wiki_image"), max_event_image_bytes: jsonFiniteNumber(max.event_image, "max event_image"),
      max_gallery_image_bytes: jsonFiniteNumber(max.gallery_image, "max gallery_image"), max_storage_image_bytes: max.storage_image === undefined ? LIMITS.media.maxFileSize.storageImage : jsonFiniteNumber(max.storage_image, "max storage_image"),
      quota_profile: jsonFiniteNumber(quotas.profile, "quota profile"), quota_announcement: jsonFiniteNumber(quotas.announcement, "quota announcement"),
      quota_gallery: jsonFiniteNumber(quotas.gallery, "quota gallery"), quota_wiki: jsonFiniteNumber(quotas.wiki, "quota wiki"),
      storage_images_per_item: jsonFiniteNumber(storage.images_per_item, "storage images_per_item"),
      absence_max_span_days: jsonFiniteNumber(absence.max_span_days, "absence max_span_days"), absence_max_entries_per_user: jsonFiniteNumber(absence.max_entries_per_user, "absence max_entries_per_user"),
      analytics_reference_duration_minutes: jsonFiniteNumber(analytics.reference_duration_minutes, "analytics reference_duration_minutes"),
      analytics_weight_kills: jsonFiniteNumber(weights.kills, "analytics kills"), analytics_weight_towers: jsonFiniteNumber(weights.towers, "analytics towers"),
      analytics_weight_base_hp: jsonFiniteNumber(weights.base_hp, "analytics base_hp"), analytics_weight_credits: jsonFiniteNumber(weights.credits, "analytics credits"),
      analytics_weight_distance: jsonFiniteNumber(weights.distance, "analytics distance"),
      revision_token: revisionToken("site_config", "1", row), created_at: row.created_at, updated_at: row.updated_at,
    }, { singleton: 1 }));
  } catch (error) { reject(context, "site_config", rowKey("site_config", row, 0), "invalid_config", message(error)); }
}

function mapAuditAndErrors(context: Context): void {
  const oversizedDetails: Row[] = [];
  eachRow(context, "audit_log", (row, key) => {
    const legacyEntity = requiredString(row, "entity_type");
    const legacyAction = requiredString(row, "action");
    const entityType = legacyEntity === "gallery_comment" ? "gallery" : legacyEntity === "game_data" ? "site_config" : legacyEntity;
    const action = legacyAction === "add_by_moderator" ? "batch_add_by_moderator" : legacyAction === "remove_by_moderator" ? "batch_remove_by_moderator" : legacyAction;
    if (!AUDIT_ENTITY_TYPES.has(entityType)) throw new TypeError(`Unsupported audit entity type ${legacyEntity}`);
    if (!AUDIT_ACTIONS.has(action)) throw new TypeError(`Unsupported audit action ${legacyAction}`);
    const originalSummary = nullableString(row, "diff_title");
    const summary = originalSummary === null || originalSummary.length === 0 ? null : originalSummary.slice(0, 200);
    const detail = { source_entity_type: legacyEntity, source_action: legacyAction, detail_text: row.detail_text, ...(originalSummary && originalSummary.length > 200 ? { full_diff_title: originalSummary } : {}) };
    let detailJson = JSON.stringify(detail);
    if (detailJson.length > 16_384) {
      oversizedDetails.push(row);
      detailJson = JSON.stringify({
        source_entity_type: legacyEntity,
        source_action: legacyAction,
        preserved_object_key: "migration-preserved/d1/audit_log_oversized_detail.ndjson",
        preserved_row_id: row.id,
      });
      context.transformations.push({ table: "audit_log", rowKey: key, detail: "Cold-preserved oversized legacy audit detail" });
    }
    addInsert(context, 90, "audit_log", key, "audit_log", {
      id: row.id, request_id: stableUuid("audit-request", requiredString(row, "id")), actor_user_id: row.actor_id, entity_type: entityType,
      entity_id: row.entity_id, action, summary, detail_json: detailJson, occurred_at: row.created_at,
    });
  });
  if (oversizedDetails.length > 0) preserveRows(context, "audit_log_oversized_detail", oversizedDetails);
  eachRow(context, "error_log", (row, key) => addInsert(context, 91, "error_log", key, "error_log", {
    id: row.id, source: row.source === "cron" ? "scheduler" : row.source, level: row.level, message: row.message,
    request_path: row.request_path, request_method: row.request_method, request_id: row.request_id, stack: row.stack, created_at: row.created_at,
  }));
}

function collectMediaPlan(context: Context): MediaRequirement[] {
  const references = new Map<string, { sourceKey: string; purpose: MediaPurpose; mediaType: "image" | "audio"; ownerUserId: string | null; createdAt: string; references: MediaReference[]; wikiRevisions: { revisionId: string; audience: "public" | "private"; sortOrder: number }[] }>();
  const add = (input: Omit<MediaRequirement, "mediaId" | "references" | "wikiRevisions"> & { reference?: MediaReference; wikiRevision?: { revisionId: string; audience: "public" | "private"; sortOrder: number } }): void => {
    assertSourceMediaKey(input.sourceKey, input.mediaType);
    const groupKey = `${input.sourceKey}\0${input.purpose}`;
    const existing = references.get(groupKey) ?? { sourceKey: input.sourceKey, purpose: input.purpose, mediaType: input.mediaType, ownerUserId: input.ownerUserId, createdAt: input.createdAt, references: [], wikiRevisions: [] };
    if (existing.mediaType !== input.mediaType || existing.ownerUserId !== input.ownerUserId) throw new TypeError(`Conflicting media identity for ${input.sourceKey}`);
    if (input.reference && !existing.references.some((entry) => stableStringify(entry) === stableStringify(input.reference))) existing.references.push(input.reference);
    if (input.wikiRevision && !existing.wikiRevisions.some((entry) => entry.revisionId === input.wikiRevision!.revisionId)) existing.wikiRevisions.push(input.wikiRevision);
    references.set(groupKey, existing);
  };
  const profiles = indexBy(tableRows(context.snapshot, "member_profiles"), "user_id");
  for (const profile of profiles.values()) {
    const userId = requiredString(profile, "user_id");
    const createdAt = requiredString(profile, "created_at");
    const avatar = nullableString(profile, "avatar_key");
    const audio = nullableString(profile, "audio_key");
    if (avatar) add({ sourceKey: avatar, purpose: "member_avatar", mediaType: "image", ownerUserId: userId, createdAt, reference: mediaReference("member_profile", userId, "avatar", "public", 0, createdAt) });
    if (audio) add({ sourceKey: audio, purpose: "member_audio", mediaType: "audio", ownerUserId: userId, createdAt, reference: mediaReference("member_profile", userId, "audio", "public", 0, createdAt) });
  }
  for (const row of tableRows(context.snapshot, "member_profile_images")) {
    const userId = requiredString(row, "user_id"); const profile = profiles.get(userId);
    if (!profile) { reject(context, "member_profile_images", rowKey("member_profile_images", row, 0), "missing_profile", "Image references missing member profile"); continue; }
    add({ sourceKey: requiredString(row, "media_key"), purpose: "member_image", mediaType: "image", ownerUserId: userId, createdAt: requiredString(profile, "created_at"), reference: mediaReference("member_profile", userId, "image", "public", requiredInteger(row, "sort_order"), requiredString(profile, "created_at")) });
  }
  const events = indexBy(tableRows(context.snapshot, "events"), "id");
  for (const row of tableRows(context.snapshot, "event_attachments")) {
    const entity = events.get(requiredString(row, "event_id")); if (!entity) { reject(context, "event_attachments", rowKey("event_attachments", row, 0), "missing_event", "Attachment references missing event"); continue; }
    add({ sourceKey: requiredString(row, "media_key"), purpose: "event_image", mediaType: "image", ownerUserId: nullableString(entity, "created_by"), createdAt: requiredString(entity, "created_at"), reference: mediaReference("event", requiredString(entity, "id"), "attachment", "public", requiredInteger(row, "sort_order"), requiredString(entity, "created_at")) });
  }
  const templates = indexBy(tableRows(context.snapshot, "recurring_templates"), "id");
  for (const row of tableRows(context.snapshot, "recurring_template_attachments")) {
    const entity = templates.get(requiredString(row, "template_id")); if (!entity) { reject(context, "recurring_template_attachments", rowKey("recurring_template_attachments", row, 0), "missing_template", "Attachment references missing template"); continue; }
    add({ sourceKey: requiredString(row, "media_key"), purpose: "event_image", mediaType: "image", ownerUserId: nullableString(entity, "created_by"), createdAt: requiredString(entity, "created_at"), reference: mediaReference("recurring_template", requiredString(entity, "id"), "attachment", "private", requiredInteger(row, "sort_order"), requiredString(entity, "created_at")) });
  }
  const gallery = indexBy(tableRows(context.snapshot, "gallery_items"), "id");
  for (const entity of gallery.values()) if (entity.type === "image") add({ sourceKey: requiredString(entity, "url"), purpose: "gallery_image", mediaType: "image", ownerUserId: nullableString(entity, "uploaded_by"), createdAt: requiredString(entity, "created_at"), reference: mediaReference("gallery_item", requiredString(entity, "id"), "image", "public", 0, requiredString(entity, "created_at")) });
  const classes = indexBy(tableRows(context.snapshot, "class_catalog"), "id");
  for (const entity of classes.values()) { const key = nullableString(entity, "icon_key"); if (key) add({ sourceKey: key, purpose: "class_icon", mediaType: "image", ownerUserId: null, createdAt: requiredString(entity, "created_at"), reference: mediaReference("class_catalog", requiredString(entity, "id"), "icon", "public", 0, requiredString(entity, "created_at")) }); }
  const storageItems = indexBy(tableRows(context.snapshot, "storage_items"), "id");
  for (const row of tableRows(context.snapshot, "storage_item_images")) { const entity = storageItems.get(requiredString(row, "item_id")); if (!entity) { reject(context, "storage_item_images", rowKey("storage_item_images", row, 0), "missing_item", "Image references missing storage item"); continue; } add({ sourceKey: requiredString(row, "r2_key"), purpose: "storage_image", mediaType: "image", ownerUserId: null, createdAt: requiredString(row, "created_at"), reference: mediaReference("storage_item", requiredString(entity, "id"), "image", "authenticated", storageImageOrder(context.snapshot, row), requiredString(row, "created_at")) }); }
  const announcements = indexBy(tableRows(context.snapshot, "announcements"), "id");
  const articles = indexBy(tableRows(context.snapshot, "wiki_articles"), "id");
  const structured = new Set<string>();
  for (const entry of references.values()) for (const ref of entry.references) structured.add(`${entry.sourceKey}\0${legacyEntityType(ref.entityType, ref.slot)}\0${ref.entityId}`);
  for (const row of tableRows(context.snapshot, "media_references")) {
    const sourceKey = requiredString(row, "media_key"); const entityType = requiredString(row, "entity_type"); const entityId = requiredString(row, "entity_id");
    if (structured.has(`${sourceKey}\0${entityType}\0${entityId}`)) continue;
    const createdAt = requiredString(row, "created_at");
    if (entityType === "announcement") {
      const entity = announcements.get(entityId); if (!entity) { reject(context, "media_references", rowKey("media_references", row, 0), "missing_announcement", "Media reference target is missing"); continue; }
      if (!jsonContainsString(requiredString(entity, "body_json"), sourceKey)) { reject(context, "media_references", sourceKey, "unlocatable_body_media", "Announcement media key is absent from body JSON"); continue; }
      add({ sourceKey, purpose: "announcement_image", mediaType: "image", ownerUserId: nullableString(entity, "created_by"), createdAt, reference: mediaReference("announcement", entityId, "body", entity.status === "published" ? "public" : "private", bodyOrder(requiredString(entity, "body_json"), sourceKey), createdAt) });
    } else if (entityType === "wiki_article") {
      const entity = articles.get(entityId); if (!entity) { reject(context, "media_references", rowKey("media_references", row, 0), "missing_article", "Media reference target is missing"); continue; }
      const snapshots = context.wikiSnapshots.get(entityId) ?? [];
      let used = false;
      for (const revision of snapshots) if (jsonContainsString(requiredString(revision, "body_json"), sourceKey)) { used = true; add({ sourceKey, purpose: "wiki_image", mediaType: "image", ownerUserId: nullableString(entity, "created_by"), createdAt, wikiRevision: { revisionId: requiredString(revision, "id"), audience: entity.archived_at === null ? "public" : "private", sortOrder: bodyOrder(requiredString(revision, "body_json"), sourceKey) } }); }
      if (jsonContainsString(requiredString(entity, "body_json"), sourceKey)) { used = true; add({ sourceKey, purpose: "wiki_image", mediaType: "image", ownerUserId: nullableString(entity, "created_by"), createdAt, reference: mediaReference("wiki_article", entityId, "body", entity.archived_at === null ? "public" : "private", bodyOrder(requiredString(entity, "body_json"), sourceKey), createdAt) }); }
      if (!used) reject(context, "media_references", sourceKey, "unlocatable_revision_media", "Wiki media key is absent from article and revision JSON");
    } else if (!["member_profile", "event", "recurring_template", "gallery_item", "class_icon", "storage_item"].includes(entityType)) {
      reject(context, "media_references", rowKey("media_references", row, 0), "unknown_media_entity", `Unsupported legacy media entity ${entityType}`);
    } else {
      reject(context, "media_references", rowKey("media_references", row, 0), "unmatched_media_reference", "Structured legacy media reference does not match its source row");
    }
  }
  const site = tableRows(context.snapshot, "site_config")[0];
  if (site) { const logoKey = siteLogoKey(nullableString(site, "site_logo_url")); if (logoKey) add({ sourceKey: logoKey, purpose: "site_logo", mediaType: "image", ownerUserId: nullableString(site, "updated_by"), createdAt: requiredString(site, "created_at"), reference: mediaReference("site_config", "site", "logo", "public", 0, requiredString(site, "created_at")) }); }
  const result = [...references.values()].map((entry) => Object.freeze({
    mediaId: mediaId(entry.sourceKey, entry.purpose), sourceKey: entry.sourceKey, purpose: entry.purpose, mediaType: entry.mediaType,
    ownerUserId: entry.ownerUserId, createdAt: entry.createdAt,
    references: Object.freeze([...entry.references].sort((left, right) => `${left.entityType}:${left.entityId}:${left.slot}:${left.sortOrder}`.localeCompare(`${right.entityType}:${right.entityId}:${right.slot}:${right.sortOrder}`))),
    wikiRevisions: Object.freeze([...entry.wikiRevisions].sort((left, right) => left.revisionId.localeCompare(right.revisionId))),
  }));
  for (const entry of result) {
    const positions = new Set<string>();
    for (const ref of entry.references) { const position = `${ref.entityType}:${ref.entityId}:${ref.slot}:${ref.sortOrder}`; if (positions.has(position)) reject(context, "media_references", position, "duplicate_sort_order", "Two media assets occupy one target sort position"); positions.add(position); }
  }
  return result.sort((left, right) => left.mediaId.localeCompare(right.mediaId));
}

function siteLogoKey(url: string | null): string | null {
  if (!url) return null;
  try { const parsed = new URL(url, "https://legacy.invalid"); const key = parsed.searchParams.get("key"); return parsed.pathname === "/api/site-config/logo" && key?.startsWith("site/logo/") ? key : null; }
  catch { return null; }
}

function mediaReference(entityType: MediaReference["entityType"], entityId: string, slot: MediaReference["slot"], audience: MediaReference["audience"], sortOrder: number, attachedAt: string): MediaReference {
  return Object.freeze({ entityType, entityId, slot, audience, sortOrder, attachedAt });
}

function legacyEntityType(entityType: MediaReference["entityType"], slot: MediaReference["slot"]): string {
  return entityType === "class_catalog" && slot === "icon" ? "class_icon" : entityType;
}

function storageImageOrder(snapshot: LegacySnapshot, row: Row): number {
  return [...tableRows(snapshot, "storage_item_images")].filter((candidate) => candidate.item_id === row.item_id)
    .sort((left, right) => compareTextFields(left, right, ["created_at", "id"]))
    .findIndex((candidate) => candidate.id === row.id);
}

function bodyOrder(json: string, key: string): number { return extractJsonStrings(json).indexOf(key); }
function jsonContainsString(json: string, key: string): boolean { return extractJsonStrings(json).includes(key); }
function extractJsonStrings(json: string): string[] {
  let value: unknown; try { value = JSON.parse(json); } catch { throw new TypeError("Body JSON is invalid"); }
  const strings: string[] = [];
  const visit = (input: unknown): void => { if (typeof input === "string") strings.push(input); else if (Array.isArray(input)) input.forEach(visit); else if (isRecord(input)) Object.keys(input).sort().forEach((key) => visit(input[key])); };
  visit(value); return strings;
}

function mapMediaPhase2(context: Context, manifest: R2CopyManifest, objects: readonly ReconciledObject[]): void {
  const byTarget = new Map(objects.map((entry) => [entry.targetKey, entry]));
  const expectedTargets = new Set(manifest.objects.map((entry) => entry.targetKey));
  for (const requirement of context.mediaPlan) {
    const variants = requirement.mediaType === "audio" ? ["full"] as const : ["full", "view"] as const;
    const expected = variants.map((variant) => requirement.mediaType === "audio" ? `media/${requirement.mediaId}/full.opus` : `media/${requirement.mediaId}/${variant}.webp`);
    if (expected.some((target) => !byTarget.has(target))) { reject(context, "r2Objects", requirement.mediaId, "missing_r2_object", "Reconciliation report lacks a required media variant"); continue; }
    addInsert(context, 100, "media_assets", requirement.mediaId, "media_assets", {
      id: requirement.mediaId, owner_user_id: requirement.ownerUserId, purpose: requirement.purpose, media_type: requirement.mediaType,
      state: "attached", original_name: requirement.mediaType === "audio" ? fileName(requirement.sourceKey) : null,
      expires_at: null, delete_claim_token: null, delete_claim_until: null, created_at: requirement.createdAt, updated_at: requirement.createdAt,
    });
    for (const target of expected) { const object = byTarget.get(target)!; addInsert(context, 101, "media_variants", target, "media_variants", { media_id: object.mediaId, variant: object.variant, object_key: object.targetKey, content_type: object.contentType, byte_size: object.byteSize, sha256: object.sha256, width: object.width, height: object.height }); }
    for (const ref of requirement.references) addInsert(context, 102, "media_links", `${requirement.mediaId}:${ref.entityType}:${ref.entityId}:${ref.slot}`, "media_links", { media_id: requirement.mediaId, entity_type: ref.entityType, entity_id: ref.entityId, slot: ref.slot, audience: ref.audience, sort_order: ref.sortOrder, attached_at: ref.attachedAt });
    for (const revision of requirement.wikiRevisions) addInsert(context, 103, "wiki_revision_media", `${requirement.mediaId}:${revision.revisionId}`, "wiki_revision_media", { revision_id: revision.revisionId, media_id: requirement.mediaId, audience: revision.audience, sort_order: revision.sortOrder });
    if (requirement.purpose === "site_logo") addStatement(context, 104, "site_config", "logo", "update", updateSql("site_config", { site_logo_media_id: requirement.mediaId }, { singleton: 1 }));
  }
  for (const target of byTarget.keys()) if (!expectedTargets.has(target)) reject(context, "r2Objects", target, "unknown_r2_object", "Reconciliation contains an object outside the approved copy manifest");
}

type ReconciledObject = Readonly<{ mediaId: string; variant: "full" | "view"; sourceKey: string; targetKey: string; byteSize: number; contentType: "image/webp" | "audio/ogg"; sha256: string; width: number | null; height: number | null }>;

function parseSuccessfulReconciliation(input: unknown, manifestSha256: string, manifest: R2CopyManifest): readonly ReconciledObject[] {
  if (!isRecord(input)) throw new TypeError("R2 reconciliation report must be an object");
  assertExactKeys(input, ["version", "manifestSha256", "summary", "objects", "findings"], "R2 reconciliation report");
  if (input.version !== 1 || input.manifestSha256 !== manifestSha256) throw new TypeError("R2 reconciliation report does not match exact manifest bytes");
  if (!isRecord(input.summary)) throw new TypeError("R2 reconciliation summary must be an object");
  assertExactKeys(input.summary, ["expected", "verified", "findings"], "R2 reconciliation summary");
  if (!Array.isArray(input.findings) || input.findings.length !== 0 || input.summary.findings !== 0 || input.summary.expected !== manifest.objects.length || input.summary.verified !== manifest.objects.length) throw new TypeError("R2 reconciliation report is not fully successful");
  if (!Array.isArray(input.objects) || input.objects.length !== manifest.objects.length) throw new TypeError("R2 reconciliation object count differs from manifest");
  return input.objects.map((raw, index) => {
    if (!isRecord(raw)) throw new TypeError(`R2 reconciliation object ${index} must be an object`);
    assertExactKeys(raw, ["mediaId", "variant", "sourceKey", "targetKey", "byteSize", "contentType", "sha256", "width", "height"], `R2 reconciliation object ${index}`);
    const expected = manifest.objects[index];
    if (!expected || ["mediaId", "variant", "sourceKey", "targetKey", "byteSize", "contentType"].some((key) => raw[key] !== expected[key as keyof typeof expected])) throw new TypeError(`R2 reconciliation object ${index} differs from manifest order/content`);
    if (typeof raw.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.sha256)) throw new TypeError(`R2 reconciliation object ${index} has invalid SHA-256`);
    const image = raw.contentType === "image/webp";
    if (image ? !(Number.isSafeInteger(raw.width) && Number(raw.width) > 0 && Number.isSafeInteger(raw.height) && Number(raw.height) > 0) : !(raw.width === null && raw.height === null)) throw new TypeError(`R2 reconciliation object ${index} has invalid dimensions`);
    return Object.freeze(raw as unknown as ReconciledObject);
  });
}

function parseCopyManifest(input: unknown): R2CopyManifest {
  if (!isRecord(input)) throw new TypeError("R2 copy manifest must be an object");
  assertExactKeys(input, ["version", "objects"], "R2 copy manifest");
  if (input.version !== 1 || !Array.isArray(input.objects)) throw new TypeError("R2 copy manifest version/objects are invalid");
  const objects = input.objects.map((raw, index) => {
    if (!isRecord(raw)) throw new TypeError(`R2 manifest object ${index} must be an object`);
    const keys = raw.sha256 === undefined ? ["mediaId", "variant", "sourceKey", "targetKey", "byteSize", "contentType"] : ["mediaId", "variant", "sourceKey", "targetKey", "byteSize", "contentType", "sha256"];
    assertExactKeys(raw, keys, `R2 manifest object ${index}`);
    if (typeof raw.mediaId !== "string" || !/^[A-Za-z0-9_-]{21}$/.test(raw.mediaId) || (raw.variant !== "full" && raw.variant !== "view") || typeof raw.sourceKey !== "string" || typeof raw.targetKey !== "string" || !Number.isSafeInteger(raw.byteSize) || Number(raw.byteSize) < 1 || (raw.contentType !== "image/webp" && raw.contentType !== "audio/ogg") || (raw.sha256 !== undefined && (typeof raw.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.sha256)))) throw new TypeError(`R2 manifest object ${index} is invalid`);
    return Object.freeze(raw as unknown as R2CopyManifest["objects"][number]);
  });
  return Object.freeze({ version: 1, objects: Object.freeze(objects) });
}

function parseInventory(input: unknown): R2Inventory {
  if (!isRecord(input)) throw new TypeError("R2 inventory must be an object");
  assertExactKeys(input, ["version", "source", "target"], "R2 inventory");
  if (input.version !== 1 || !isRecord(input.source) || !isRecord(input.target)) throw new TypeError("R2 inventory version/source/target are invalid");
  assertExactKeys(input.source, ["count", "objects"], "R2 source inventory");
  assertExactKeys(input.target, ["count", "objects"], "R2 target inventory");
  if (!Array.isArray(input.source.objects) || input.source.count !== input.source.objects.length || input.target.count !== 0 || !Array.isArray(input.target.objects) || input.target.objects.length !== 0) throw new TypeError("R2 inventory counts are invalid or target is not empty");
  const seen = new Set<string>();
  const objects = input.source.objects.map((raw, index) => {
    if (!isRecord(raw)) throw new TypeError(`R2 inventory object ${index} must be an object`);
    assertExactKeys(raw, ["key", "size", "contentType", "etag", "customMetadata", "checksum"], `R2 inventory object ${index}`);
    if (typeof raw.key !== "string" || !Number.isSafeInteger(raw.size) || Number(raw.size) < 1 || (raw.contentType !== "image/webp" && raw.contentType !== "audio/ogg") || typeof raw.etag !== "string" || !isRecord(raw.customMetadata) || raw.checksum !== null) throw new TypeError(`R2 inventory object ${index} is invalid or unexpectedly has a canonical checksum`);
    if (Object.keys(raw.customMetadata).length !== 0) throw new TypeError(`R2 inventory object ${index} has unreviewed custom metadata`);
    if (seen.has(raw.key)) throw new TypeError(`R2 inventory duplicates ${raw.key}`); seen.add(raw.key);
    return Object.freeze({ sourceKey: raw.key, byteSize: raw.size, contentType: raw.contentType } as R2Inventory["objects"][number]);
  });
  return Object.freeze({ version: 1, objects: Object.freeze(objects) });
}

function finishBundle(context: Context, phase: MigrationBundle["phase"], coreSql?: string, validationPrefix: readonly Statement[] = []): MigrationBundle {
  const sourceDigest = digest(stableStringify({ snapshot: context.snapshot, options: context.options, phase }));
  const ordered = [...context.groups].sort((left, right) => left.phase - right.phase || left.key.localeCompare(right.key));
  const limitFailure = checkStatementLimits(ordered); if (limitFailure) context.rejections.push(limitFailure);
  const statements = ordered.flatMap((group) => group.statements);
  if (context.rejections.length === 0 && coreSql !== undefined) {
    const validationFailure = validateAgainstCore(coreSql, [...validationPrefix, ...statements]); if (validationFailure) context.rejections.push(validationFailure);
  }
  const ready = context.rejections.length === 0;
  const batches = ready ? buildBatches(ordered, phase, sourceDigest) : [];
  const preserved = context.preservedRecords.map(({ ndjson: _ndjson, ...record }) => Object.freeze(record));
  const report: MigrationReport = Object.freeze({
    rejections: Object.freeze([...context.rejections].sort(reportOrder)),
    skipped: Object.freeze([...context.skipped].sort((left, right) => left.table.localeCompare(right.table))),
    transformations: Object.freeze([...context.transformations].sort(reportOrder)),
    coverage: Object.freeze((Object.keys(LEGACY_COLUMNS) as LegacyTable[]).sort().map((table) => Object.freeze({ table, rowCount: tableRows(context.snapshot, table).length, disposition: TABLE_DISPOSITION[table] }))),
    preserved: Object.freeze(preserved),
  });
  return Object.freeze({ phase, ready, sourceDigest, statementCount: ready ? statements.length : 0, batches: Object.freeze(batches), checkpoints: Object.freeze(batches.map((batch) => Object.freeze({ batch: batch.index, fileName: batch.fileName, sha256: batch.sha256, payloadSha256: batch.payloadSha256, afterStatement: batch.afterStatement, applied: false as const }))), report, mediaPlan: Object.freeze(context.mediaPlan), preservedRecords: Object.freeze(context.preservedRecords) });
}

function eachRow(context: Context, table: LegacyTable, mapper: (row: Row, key: string, index: number) => void): void {
  tableRows(context.snapshot, table).forEach((row, index) => { const key = rowKey(table, row, index); try { mapper(row, key, index); } catch (error) { reject(context, table, key, "mapping_error", message(error)); } });
}

function copyRows(context: Context, phase: number, source: LegacyTable, target: string, columns: readonly string[]): void {
  eachRow(context, source, (row, key) => addInsert(context, phase, source, key, target, pick(row, columns)));
}

function addInsert(context: Context, phase: number, source: string, key: string, target: string, values: SqlValues): void { addStatement(context, phase, source, key, "insert", insertSql(target, values)); }
function addStatement(context: Context, phase: number, table: string, key: string, operation: string, sql: string): void { addGroup(context, phase, `${table}:${key}`, [statement(table, key, operation, sql)]); }
function addGroup(context: Context, phase: number, key: string, statements: readonly Statement[]): void { context.groups.push(Object.freeze({ phase, key, statements: Object.freeze([...statements]) })); }
function statement(table: string, key: string, operation: string, sql: string): Statement { return Object.freeze({ id: `${table}:${key}:${operation}`, sql }); }

function insertSql(table: string, values: SqlValues): string { const entries = Object.entries(values); return `INSERT INTO ${identifier(table)} (${entries.map(([key]) => identifier(key)).join(", ")}) VALUES (${entries.map(([, value]) => literal(value)).join(", ")});`; }
function updateSql(table: string, values: SqlValues, where: SqlValues): string { return `UPDATE ${identifier(table)} SET ${Object.entries(values).map(([key, value]) => `${identifier(key)} = ${literal(value)}`).join(", ")} WHERE ${whereSql(where)};`; }
function deleteSql(table: string, where: SqlValues): string { return `DELETE FROM ${identifier(table)} WHERE ${whereSql(where)};`; }
function whereSql(where: SqlValues): string { return Object.entries(where).map(([key, value]) => value === null ? `${identifier(key)} IS NULL` : `${identifier(key)} = ${literal(value)}`).join(" AND "); }
function identifier(value: string): string { if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) throw new TypeError(`Invalid SQL identifier ${value}`); return `"${value}"`; }
function literal(value: Scalar): string { if (value === null) return "NULL"; if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("SQL number must be finite"); return String(value); } if (value.includes("\0")) throw new TypeError("SQL string contains NUL"); return `'${value.replaceAll("'", "''")}'`; }

function buildBatches(groups: readonly StatementGroup[], phase: MigrationBundle["phase"], sourceDigest: string): MigrationBatch[] {
  const batches: MigrationBatch[] = []; let pending: Statement[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    const index = batches.length + 1;
    const body = pending.map((entry) => `-- ${entry.id}\n${entry.sql}`).join("\n") + "\n";
    const payloadSha256 = digest(body);
    const checkpointTable = `CREATE TABLE IF NOT EXISTS "${IMPORT_CHECKPOINT_TABLE}" (phase TEXT NOT NULL, batch INTEGER NOT NULL, source_digest TEXT NOT NULL, payload_sha256 TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), PRIMARY KEY (phase, batch));`;
    const marker = insertSql(IMPORT_CHECKPOINT_TABLE, { phase, batch: index, source_digest: sourceDigest, payload_sha256: payloadSha256 });
    const sql = `-- infini-guild ${phase} ${String(index).padStart(4, "0")}\n${checkpointTable}\n-- migration-payload-start\n${body}-- migration-payload-end\n${marker}\n`;
    batches.push(Object.freeze({ index, fileName: `batch-${String(index).padStart(4, "0")}.sql`, statementCount: pending.length + 2, byteLength: Buffer.byteLength(sql), sha256: digest(sql), payloadSha256, afterStatement: pending.at(-1)!.id, sql }));
    pending = [];
  };
  for (const group of groups) { const candidate = [...pending, ...group.statements]; if (pending.length > 0 && (candidate.length + 2 > MAX_BATCH_STATEMENTS || batchBytes(candidate) + 1_024 > MAX_BATCH_BYTES)) flush(); pending.push(...group.statements); } flush(); return batches;
}

function checkStatementLimits(groups: readonly StatementGroup[]): MigrationRejection | null {
  for (const group of groups) { if (group.statements.length + 2 > MAX_BATCH_STATEMENTS || batchBytes(group.statements) + 1_024 > MAX_BATCH_BYTES) return { table: "migration", rowKey: group.key, code: "group_too_large", message: "Atomic group exceeds D1 batch bounds including remote checkpoint statements" }; for (const entry of group.statements) if (Buffer.byteLength(entry.sql) > MAX_STATEMENT_BYTES) return { table: "migration", rowKey: entry.id, code: "statement_too_large", message: `Statement exceeds ${MAX_STATEMENT_BYTES} bytes` }; } return null;
}
function batchBytes(statements: readonly Statement[]): number { return Buffer.byteLength(statements.map((entry) => `-- ${entry.id}\n${entry.sql}`).join("\n")) + 128; }

function validateAgainstCore(coreSql: string, statements: readonly Statement[]): MigrationRejection | null {
  const database = new DatabaseSync(":memory:");
  try { database.exec(coreSql.replaceAll("--> statement-breakpoint", "")); database.exec("PRAGMA foreign_keys = ON"); for (const entry of statements) { try { database.exec(entry.sql); } catch (error) { return { table: "migration", rowKey: entry.id, code: "target_constraint", message: message(error) }; } } const violations = database.prepare("PRAGMA foreign_key_check").all(); return violations.length === 0 ? null : { table: "migration", rowKey: "foreign_key_check", code: "target_constraint", message: stableStringify(violations) }; }
  finally { database.close(); }
}

function statementsFromBatch(sql: string): Statement[] {
  const payload = sql.split("-- migration-payload-start\n")[1]?.split("-- migration-payload-end\n")[0];
  if (payload === undefined) throw new TypeError("Migration batch payload markers are missing");
  const lines = payload.split("\n"); const result: Statement[] = []; let id: string | null = null; let body: string[] = [];
  const flush = (): void => { if (id && body.length > 0) result.push({ id, sql: body.join("\n") }); id = null; body = []; };
  for (const line of lines) { if (line.startsWith("-- ") && !line.startsWith("-- infini-guild")) { flush(); id = line.slice(3); } else if (id) body.push(line); } flush(); return result;
}

function parseRow(table: LegacyTable, raw: unknown, index: number): Row {
  if (!isRecord(raw)) throw new TypeError(`Snapshot ${table}[${index}] must be an object`);
  assertExactKeys(raw, LEGACY_COLUMNS[table], `snapshot ${table}[${index}]`);
  const row: Record<string, Scalar> = {};
  for (const column of LEGACY_COLUMNS[table]) { const value = raw[column]; if (value !== null && typeof value !== "string" && typeof value !== "number") throw new TypeError(`Snapshot ${table}[${index}].${column} is not a D1 scalar`); if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError(`Snapshot ${table}[${index}].${column} is not finite`); row[column] = value as Scalar; }
  return Object.freeze(row) as Row;
}

function tableRows(snapshot: LegacySnapshot, table: LegacyTable): readonly Row[] { return snapshot.tables[table].rows; }
function rowKey(table: LegacyTable, row: Row, index: number): string { for (const column of ["id", "user_id", "username", "event_id", "template_id", "media_key", "role_id", "run_id"]) if (typeof row[column] === "string") return row[column]; return `${index}:${digest(stableStringify([table, row])).slice(0, 16)}`; }
function requiredString(row: Row, column: string): string { const value = row[column]; if (typeof value !== "string" || value.length === 0) throw new TypeError(`${column} must be a non-empty string`); return value; }
function nullableString(row: Row, column: string): string | null { const value = row[column]; if (value === null || value === undefined) return null; if (typeof value !== "string") throw new TypeError(`${column} must be a string or null`); return value; }
function requiredNumber(row: Row, column: string): number { const value = row[column]; if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${column} must be a finite number`); return value; }
function requiredInteger(row: Row, column: string): number { const value = requiredNumber(row, column); if (!Number.isSafeInteger(value)) throw new TypeError(`${column} must be a safe integer`); return value; }
function pick(row: Row, columns: readonly string[]): SqlValues { return Object.fromEntries(columns.map((column) => [column, row[column] ?? null])); }
function indexBy(rows: readonly Row[], column: string): Map<string, Row> { const result = new Map<string, Row>(); for (const row of rows) { const key = requiredString(row, column); if (result.has(key)) throw new TypeError(`Duplicate ${column} ${key}`); result.set(key, row); } return result; }
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> { const result = new Map<string, T[]>(); for (const item of items) { const id = key(item); const group = result.get(id) ?? []; group.push(item); result.set(id, group); } return result; }
function sortedEntries<T>(map: Map<string, T>): [string, T][] { return [...map.entries()].sort(([left], [right]) => left.localeCompare(right)); }
function compareRows(column: string): (left: Row, right: Row) => number { return (left, right) => requiredString(left, column).localeCompare(requiredString(right, column)); }
function compareTextFields(left: Row, right: Row, columns: readonly string[]): number { for (const column of columns) { const result = requiredString(left, column).localeCompare(requiredString(right, column)); if (result !== 0) return result; } return 0; }

function revisionToken(kind: string, id: string, source: unknown): string { return stableUuid(`revision:${kind}`, stableStringify([id, source])); }
function stableId(kind: string, source: string): string { return stableUuid(`id:${kind}`, source); }
function stableUuid(kind: string, source: string): string {
  const bytes = createHash("sha1")
    .update(MIGRATION_UUID_NAMESPACE)
    .update(kind)
    .update("\0")
    .update(source)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function mediaId(sourceKey: string, purpose: MediaPurpose): string { return createHash("sha256").update(`${sourceKey}\0${purpose}`).digest("base64url").slice(0, 21); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function fileName(key: string): string { return decodeURIComponent(key.split("/").at(-1) ?? "imported-audio.ogg").slice(0, 255) || "imported-audio.ogg"; }
function assertSourceMediaKey(key: string, type: "image" | "audio"): void { if (key.length < 1 || key.length > 1024 || key.startsWith("/") || key.endsWith("/") || key.includes("\\") || key.includes("\0") || key.split("/").some((part) => part === "" || part === "." || part === "..")) throw new TypeError(`Unsafe legacy R2 key ${key}`); if (type === "audio" && !key.endsWith(".ogg")) throw new TypeError(`Legacy audio key must end in .ogg: ${key}`); }

function parseJsonRecord(text: string, label: string): Record<string, unknown> { let value: unknown; try { value = JSON.parse(text); } catch { throw new TypeError(`${label} is invalid JSON`); } return recordValue(value, label); }
function parseJsonArray(value: Scalar, label: string): unknown[] { if (value === null || value === "") return []; if (typeof value !== "string") throw new TypeError(`${label} must be JSON text`); let parsed: unknown; try { parsed = JSON.parse(value); } catch { throw new TypeError(`${label} is invalid JSON`); } if (!Array.isArray(parsed)) throw new TypeError(`${label} must be an array`); return parsed; }
function recordValue(value: unknown, label: string): Record<string, unknown> { if (!isRecord(value)) throw new TypeError(`${label} must be an object`); return value; }
function nonEmptyString(value: unknown, label: string): string { if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string`); return value; }
function positiveInteger(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new TypeError(`${label} must be a positive integer`); return Number(value); }
function integerArray(value: unknown, label: string): number[] { if (!Array.isArray(value) || value.some((entry) => !Number.isSafeInteger(entry))) throw new TypeError(`${label} must be an integer array`); return value as number[]; }
function jsonFiniteNumber(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`); return value; }
function boolInt(value: unknown): number { if (typeof value !== "boolean") throw new TypeError("Expected boolean"); return value ? 1 : 0; }

function stableStringify(value: unknown): string { if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value); if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("Cannot canonicalize non-finite number"); return JSON.stringify(value); } if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`; throw new TypeError(`Cannot canonicalize ${typeof value}`); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void { const actual = Object.keys(value); if (!sameStringSet(actual, expected)) throw new TypeError(`${label} fields differ; expected=${[...expected].sort().join(",")}; actual=${actual.sort().join(",")}`); }
function assertOnlyKeys(value: Record<string, unknown>, expected: ReadonlySet<string>, label: string): void { const unknown = Object.keys(value).filter((key) => !expected.has(key)); if (unknown.length > 0) throw new TypeError(`${label} contains unknown fields: ${unknown.sort().join(",")}`); }
function sameStringSet(left: readonly unknown[], right: readonly string[]): boolean { return left.length === right.length && left.every((value) => typeof value === "string") && [...left as string[]].sort().every((value, index) => value === [...right].sort()[index]); }
function sameStringsInOrder(left: readonly unknown[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function reject(context: Context, table: string, rowKeyValue: string, code: string, rejectionMessage: string): void { context.rejections.push(Object.freeze({ table, rowKey: rowKeyValue, code, message: rejectionMessage })); }
function reportOrder(left: { table: string; rowKey: string }, right: { table: string; rowKey: string }): number { return left.table.localeCompare(right.table) || left.rowKey.localeCompare(right.rowKey); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function formatRejections(rejections: readonly MigrationRejection[]): string { return rejections.map((entry) => `${entry.table}/${entry.rowKey}: ${entry.message}`).join("; "); }
