// Domain: Equipment Calculator
// Tables: game_data
// Dependencies: auth (users)
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { nowUtc } from "./shared";
import { users } from "./auth";

export const gameData = sqliteTable(
  "game_data",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    data: text("data").notNull(),
    version: text("version").notNull(),
    uploadedBy: text("uploaded_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxCreatedAt: index("idx_game_data_created_at").on(table.createdAt),
  }),
);
