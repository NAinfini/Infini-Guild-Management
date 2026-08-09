// Domain: Wiki
// Tables: wiki_categories, wiki_articles, wiki_revisions
// Dependencies: auth.users
import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { canonicalUtcDateTime, nowUtc } from "./shared";

export const wikiCategories = sqliteTable(
  "wiki_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    sortOrder: integer("sort_order").notNull().default(0),
    parentId: text("parent_id").references((): AnySQLiteColumn => wikiCategories.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxParentSort: index("idx_wiki_categories_parent_sort").on(table.parentId, table.sortOrder, table.name, table.id),
    idxSort: index("idx_wiki_categories_sort").on(table.sortOrder, table.name, table.id),
    sortNonnegative: check("wiki_categories_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  }),
);

export const wikiArticles = sqliteTable(
  "wiki_articles",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    categoryId: text("category_id").notNull().references(() => wikiCategories.id),
    bodyJson: text("body_json").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    archivedAt: text("archived_at"),
    createdBy: text("created_by").notNull().references(() => users.id),
    updatedBy: text("updated_by").references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_wiki_articles_category_archived_sort").on(
      table.categoryId,
      table.archivedAt,
      table.pinned,
      table.sortOrder,
      table.updatedAt,
      table.id,
    ),
    index("idx_wiki_articles_archived_updated").on(
      table.archivedAt,
      table.pinned,
      table.updatedAt,
      table.id,
    ),
    index("idx_wiki_articles_created_by").on(table.createdBy),
    index("idx_wiki_articles_updated_by").on(table.updatedBy),
    check("wiki_articles_body_json_object", sql`json_valid(${table.bodyJson}) AND json_type(${table.bodyJson}) = 'object'`),
    check("wiki_articles_sort_nonnegative", sql`${table.sortOrder} >= 0`),
    check("wiki_articles_pinned_boolean", sql`${table.pinned} IN (0, 1)`),
    check(
      "wiki_articles_archived_at_valid",
      sql`${table.archivedAt} IS NULL OR (${canonicalUtcDateTime(table.archivedAt)})`,
    ),
  ],
);

// Per-save content snapshots: revision N holds the article's title/body as of
// that save. Restore = write an old snapshot back as a new revision.
export const wikiRevisions = sqliteTable(
  "wiki_revisions",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id").notNull().references(() => wikiArticles.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    title: text("title").notNull(),
    bodyJson: text("body_json").notNull(),
    editedBy: text("edited_by").notNull().references(() => users.id),
    // Revision number this snapshot was restored from, null for normal edits.
    restoredFrom: integer("restored_from"),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("uq_wiki_revisions_article_revision").on(table.articleId, table.revision),
    index("idx_wiki_revisions_edited_by").on(table.editedBy),
    check("wiki_revisions_body_json_object", sql`json_valid(${table.bodyJson}) AND json_type(${table.bodyJson}) = 'object'`),
    check("wiki_revisions_revision_positive", sql`${table.revision} > 0`),
    check(
      "wiki_revisions_restored_from_positive",
      sql`${table.restoredFrom} IS NULL OR ${table.restoredFrom} > 0`,
    ),
  ],
);
