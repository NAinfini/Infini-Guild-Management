// Domain: Wiki
// Tables: wiki_categories, wiki_articles
// Dependencies: auth.users
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { nowUtc } from "./shared";

export const wikiCategories = sqliteTable(
  "wiki_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    sortOrder: integer("sort_order").notNull().default(0),
    parentId: text("parent_id"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxParentSort: index("idx_wiki_categories_parent_sort").on(table.parentId, table.sortOrder, table.name, table.id),
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
    archivedAt: text("archived_at"),
    createdBy: text("created_by").notNull().references(() => users.id),
    updatedBy: text("updated_by").references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxCategoryArchivedSort: index("idx_wiki_articles_category_archived_sort").on(
      table.categoryId,
      table.archivedAt,
      table.sortOrder,
      table.updatedAt,
      table.id,
    ),
    idxArchivedUpdated: index("idx_wiki_articles_archived_updated").on(table.archivedAt, table.updatedAt, table.id),
  }),
);
