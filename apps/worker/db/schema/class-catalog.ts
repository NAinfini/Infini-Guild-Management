// Domain: Class Catalog
// Tables: class_catalog, class_tags, class_tag_members
// Dependencies: none
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { nowUtc } from "./shared";

export const classCatalog = sqliteTable(
  "class_catalog",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    color: text("color").notNull(),
    iconType: text("icon_type").notNull().default("vector"),
    vectorIcon: text("vector_icon").notNull(),
    iconKey: text("icon_key"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_class_catalog_sort").on(table.sortOrder, table.id),
    uniqueIndex("ux_class_catalog_label_nocase")
      .on(sql`${table.label} COLLATE NOCASE`),
    check(
      "class_catalog_color_hex",
      sql`length(${table.color}) = 7
          AND substr(${table.color}, 1, 1) = '#'
          AND substr(${table.color}, 2) NOT GLOB '*[^0-9A-Fa-f]*'`,
    ),
    check(
      "class_catalog_icon_type_valid",
      sql`${table.iconType} IN ('vector', 'image')`,
    ),
    check(
      "class_catalog_sort_order_nonnegative",
      sql`${table.sortOrder} >= 0`,
    ),
    check(
      "class_catalog_icon_key_consistent",
      sql`(
        (${table.iconType} = 'vector' AND ${table.iconKey} IS NULL) OR
        (${table.iconType} = 'image' AND ${table.iconKey} IS NOT NULL)
      )`,
    ),
  ],
);

/*
 * 职业标签：给一组职业起个名字，活动配额可以整组地要人（「2 个治疗，哪种都行」）。
 * 成员关系不设任何限制——一个职业可进多个标签、标签之间可以重叠、允许空标签。
 */
export const classTags = sqliteTable(
  "class_tags",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_class_tags_sort").on(table.sortOrder, table.id),
    uniqueIndex("ux_class_tags_label_nocase").on(sql`${table.label} COLLATE NOCASE`),
    check("class_tags_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const classTagMembers = sqliteTable(
  "class_tag_members",
  {
    tagId: text("tag_id")
      .notNull()
      .references(() => classTags.id, { onDelete: "cascade" }),
    classId: text("class_id")
      .notNull()
      .references(() => classCatalog.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.tagId, table.classId] }),
    // 删职业时要按 class_id 反查它进过哪些标签。
    index("idx_class_tag_members_class").on(table.classId),
  ],
);
