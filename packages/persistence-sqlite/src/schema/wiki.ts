import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { mediaAssets } from "./media";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const wikiCategoryState = sqliteTable(
  "wiki_category_state",
  {
    singleton: integer("singleton").primaryKey(),
    revisionToken: text("revision_token").notNull(),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    check("wiki_category_state_singleton", sql`${table.singleton} = 1`),
    check("wiki_category_state_revision_present", sql`length(${table.revisionToken}) >= 16`),
  ],
);

export const wikiCategories = sqliteTable(
  "wiki_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    parentId: text("parent_id").references((): AnySQLiteColumn => wikiCategories.id, { onDelete: "restrict" }),
    revisionToken: text("revision_token").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("ux_wiki_categories_slug").on(table.slug),
    index("idx_wiki_categories_tree_order").on(table.parentId, table.sortOrder, table.name, table.id),
    check("wiki_categories_name_bounded", sql`length(trim(${table.name})) BETWEEN 1 AND 120`),
    check("wiki_categories_slug_bounded", sql`length(${table.slug}) BETWEEN 1 AND 120`),
    check("wiki_categories_not_self_parent", sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`),
    check("wiki_categories_revision_present", sql`length(${table.revisionToken}) >= 16`),
  ],
);

export const wikiArticles = sqliteTable(
  "wiki_articles",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    categoryId: text("category_id").notNull().references(() => wikiCategories.id, { onDelete: "restrict" }),
    bodyJson: text("body_json").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    archivedAt: text("archived_at"),
    deletedAt: text("deleted_at"),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    currentRevision: integer("current_revision").notNull().default(1),
    revisionToken: text("revision_token").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
    // body_json 的纯文本投影，供搜索 LIKE 使用；声明必须保持末位以匹配
    // ALTER TABLE ADD COLUMN 的物理列序。
    searchText: text("search_text").notNull().default(""),
  },
  (table) => [
    uniqueIndex("ux_wiki_articles_slug").on(table.slug),
    index("idx_wiki_articles_category_curated").on(table.categoryId, table.archivedAt, table.pinned, table.sortOrder, table.title, table.id),
    index("idx_wiki_articles_public_curated").on(
      table.deletedAt,
      table.archivedAt,
      sql`${table.pinned} DESC`,
      table.sortOrder,
      table.title,
      table.id,
    ),
    index("idx_wiki_articles_admin_curated").on(
      table.deletedAt,
      sql`${table.pinned} DESC`,
      table.sortOrder,
      table.title,
      table.id,
    ),
    index("idx_wiki_articles_admin_updated").on(table.deletedAt, table.updatedAt, table.id),
    index("idx_wiki_articles_visibility_updated").on(table.archivedAt, table.updatedAt, table.id),
    index("idx_wiki_articles_deleted").on(table.deletedAt, table.id),
    check("wiki_articles_title_bounded", sql`length(trim(${table.title})) BETWEEN 1 AND 200`),
    check("wiki_articles_body_bounded", sql`length(${table.bodyJson}) BETWEEN 1 AND 500000`),
    check("wiki_articles_pinned_boolean", sql`${table.pinned} IN (0, 1)`),
    check("wiki_articles_delete_is_archived", sql`${table.deletedAt} IS NULL OR ${table.archivedAt} IS NOT NULL`),
    check("wiki_articles_revision_positive", sql`${table.currentRevision} >= 1`),
    check("wiki_articles_revision_present", sql`length(${table.revisionToken}) >= 16`),
  ],
);

export const wikiRevisions = sqliteTable(
  "wiki_revisions",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id").notNull().references(() => wikiArticles.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    categoryId: text("category_id").notNull(),
    bodyJson: text("body_json").notNull(),
    sortOrder: integer("sort_order").notNull(),
    pinned: integer("pinned", { mode: "boolean" }).notNull(),
    archivedAt: text("archived_at"),
    deletedAt: text("deleted_at"),
    editedBy: text("edited_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    restoredFrom: integer("restored_from"),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("ux_wiki_revisions_article_revision").on(table.articleId, table.revision),
    check("wiki_revisions_revision_positive", sql`${table.revision} >= 1`),
    check("wiki_revisions_title_bounded", sql`length(trim(${table.title})) BETWEEN 1 AND 200`),
    check("wiki_revisions_body_bounded", sql`length(${table.bodyJson}) BETWEEN 1 AND 500000`),
    check("wiki_revisions_slug_bounded", sql`length(${table.slug}) BETWEEN 1 AND 120`),
    check("wiki_revisions_pinned_boolean", sql`${table.pinned} IN (0, 1)`),
    check("wiki_revisions_delete_is_archived", sql`${table.deletedAt} IS NULL OR ${table.archivedAt} IS NOT NULL`),
    check("wiki_revisions_restore_positive", sql`${table.restoredFrom} IS NULL OR ${table.restoredFrom} >= 1`),
  ],
);

export const wikiRevisionMedia = sqliteTable(
  "wiki_revision_media",
  {
    revisionId: text("revision_id").notNull().references(() => wikiRevisions.id, { onDelete: "cascade" }),
    mediaId: text("media_id").notNull().references(() => mediaAssets.id, { onDelete: "restrict" }),
    audience: text("audience", { enum: ["public", "authenticated", "private"] }).notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({ name: "pk_wiki_revision_media", columns: [table.revisionId, table.mediaId] }),
    uniqueIndex("ux_wiki_revision_media_order").on(table.revisionId, table.sortOrder),
    index("idx_wiki_revision_media_asset").on(table.mediaId, table.revisionId),
    check("wiki_revision_media_audience_valid", sql`${table.audience} IN ('public', 'authenticated', 'private')`),
    check("wiki_revision_media_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);
