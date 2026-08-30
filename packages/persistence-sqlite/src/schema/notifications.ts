import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  INBOX_NOTIFICATION_ENTITY_TYPES,
  INBOX_NOTIFICATION_KINDS,
} from "@guild/shared/constants/notifications";
import {
  IMPORTANT_NOTICE_AUDIENCE_SCOPES,
  IMPORTANT_NOTICE_STATUSES,
} from "@guild/shared/constants/important-notices";
import { roles, users } from "./auth.js";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const inboxKinds = INBOX_NOTIFICATION_KINDS as unknown as [string, ...string[]];
const inboxEntityTypes = INBOX_NOTIFICATION_ENTITY_TYPES as unknown as [string, ...string[]];
const importantNoticeStatuses = IMPORTANT_NOTICE_STATUSES as unknown as [string, ...string[]];
const importantNoticeAudienceScopes = IMPORTANT_NOTICE_AUDIENCE_SCOPES as unknown as [string, ...string[]];
const inboxKindValues = sql.raw(INBOX_NOTIFICATION_KINDS.map((value) => `'${value}'`).join(", "));
const inboxEntityTypeValues = sql.raw(INBOX_NOTIFICATION_ENTITY_TYPES.map((value) => `'${value}'`).join(", "));
const importantNoticeStatusValues = sql.raw(IMPORTANT_NOTICE_STATUSES.map((value) => `'${value}'`).join(", "));
const importantNoticeAudienceScopeValues = sql.raw(IMPORTANT_NOTICE_AUDIENCE_SCOPES.map((value) => `'${value}'`).join(", "));

export const notificationInbox = sqliteTable(
  "notification_inbox",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: inboxKinds }).notNull(),
    entityType: text("entity_type", { enum: inboxEntityTypes }).notNull(),
    entityId: text("entity_id").notNull(),
    sourceKey: text("source_key").notNull(),
    payloadJson: text("payload_json").notNull(),
    occurredAt: text("occurred_at").notNull().default(nowUtc),
    readAt: text("read_at"),
  },
  (table) => [
    uniqueIndex("ux_notification_inbox_user_source").on(table.userId, table.sourceKey),
    index("idx_notification_inbox_retention").on(table.occurredAt, table.id),
    index("idx_notification_inbox_user_occurred").on(table.userId, table.occurredAt, table.id),
    index("idx_notification_inbox_user_unread").on(table.userId, table.readAt, table.occurredAt, table.id),
    check("notification_inbox_kind_valid", sql`${table.kind} IN (${inboxKindValues})`),
    check("notification_inbox_entity_type_valid", sql`${table.entityType} IN (${inboxEntityTypeValues})`),
    check("notification_inbox_id_present", sql`length(${table.id}) BETWEEN 16 AND 200`),
    check("notification_inbox_entity_present", sql`length(${table.entityId}) BETWEEN 1 AND 200`),
    check("notification_inbox_source_present", sql`length(${table.sourceKey}) BETWEEN 1 AND 300`),
    check("notification_inbox_payload_json", sql`json_valid(${table.payloadJson})`),
  ],
);

export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    memberJoined: integer("member_joined", { mode: "boolean" }).notNull().default(true),
    announcementPublished: integer("announcement_published", { mode: "boolean" }).notNull().default(true),
    eventCreated: integer("event_created", { mode: "boolean" }).notNull().default(true),
    wikiArticleCreated: integer("wiki_article_created", { mode: "boolean" }).notNull().default(true),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    check("notification_preferences_member_joined_boolean", sql`${table.memberJoined} IN (0, 1)`),
    check("notification_preferences_announcement_published_boolean", sql`${table.announcementPublished} IN (0, 1)`),
    check("notification_preferences_event_created_boolean", sql`${table.eventCreated} IN (0, 1)`),
    check("notification_preferences_wiki_article_created_boolean", sql`${table.wikiArticleCreated} IN (0, 1)`),
  ],
);

export const importantNotices = sqliteTable(
  "important_notices",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    bodyJson: text("body_json").notNull(),
    status: text("status", { enum: importantNoticeStatuses }).notNull(),
    publishAt: text("publish_at"),
    expiresAt: text("expires_at"),
    publicationRevision: integer("publication_revision").notNull().default(0),
    requiresAcknowledgement: integer("requires_acknowledgement", { mode: "boolean" }).notNull().default(false),
    audienceScope: text("audience_scope", { enum: importantNoticeAudienceScopes }).notNull().default("all"),
    revisionToken: text("revision_token").notNull(),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_important_notices_active").on(table.status, table.publishAt, table.expiresAt, table.id),
    index("idx_important_notices_admin").on(table.status, table.updatedAt, table.id),
    check("important_notices_status_valid", sql`${table.status} IN (${importantNoticeStatusValues})`),
    check("important_notices_title_present", sql`length(${table.title}) BETWEEN 1 AND 200`),
    check("important_notices_body_json", sql`json_valid(${table.bodyJson})`),
    check("important_notices_revision_present", sql`length(${table.revisionToken}) >= 16`),
    check("important_notices_publication_revision_valid", sql`${table.publicationRevision} >= 0`),
    check("important_notices_requires_acknowledgement_boolean", sql`${table.requiresAcknowledgement} IN (0, 1)`),
    check("important_notices_audience_scope_valid", sql`${table.audienceScope} IN (${importantNoticeAudienceScopeValues})`),
    check(
      "important_notices_state_consistent",
      sql`(${table.status} = 'draft' AND ${table.publishAt} IS NULL AND ${table.publicationRevision} >= 0)
        OR (${table.status} IN ('scheduled', 'published') AND ${table.publishAt} IS NOT NULL AND ${table.publicationRevision} >= 1)
        OR (${table.status} = 'withdrawn' AND ${table.publicationRevision} >= 1)`,
    ),
    check(
      "important_notices_expiry_after_publish",
      sql`${table.expiresAt} IS NULL OR ${table.publishAt} IS NULL OR ${table.expiresAt} > ${table.publishAt}`,
    ),
  ],
);

export const importantNoticeAudienceRoles = sqliteTable(
  "important_notice_audience_roles",
  {
    noticeId: text("notice_id").notNull().references(() => importantNotices.id, { onDelete: "cascade" }),
    roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.noticeId, table.roleId] }),
    index("idx_important_notice_audience_role").on(table.roleId, table.noticeId),
  ],
);

export const importantNoticeReceipts = sqliteTable(
  "important_notice_receipts",
  {
    noticeId: text("notice_id").notNull().references(() => importantNotices.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    readAt: text("read_at"),
    readPublicationRevision: integer("read_publication_revision").notNull(),
    acknowledgedAt: text("acknowledged_at"),
  },
  (table) => [
    primaryKey({ columns: [table.noticeId, table.userId] }),
    index("idx_important_notice_receipt_user").on(table.userId, table.noticeId),
    check("important_notice_receipt_read_revision_valid", sql`${table.readPublicationRevision} > 0`),
    check("important_notice_receipt_has_state", sql`${table.readAt} IS NOT NULL OR ${table.acknowledgedAt} IS NOT NULL`),
  ],
);
