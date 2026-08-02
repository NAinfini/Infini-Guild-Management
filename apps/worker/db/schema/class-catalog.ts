// Domain: Class Catalog
// Tables: class_catalog
// Dependencies: none
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
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
