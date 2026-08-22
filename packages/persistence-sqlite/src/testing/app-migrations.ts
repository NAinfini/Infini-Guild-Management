import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

/*
 * 测试专用：按 manifest 顺序应用全部应用迁移。测试库必须走与生产相同的
 * 迁移序列，硬编码单个迁移文件会在新增迁移后悄然偏离真实 schema。
 */
const migrationSql = (JSON.parse(readFileSync(
  fileURLToPath(new URL("../migrations/generated/manifest.json", import.meta.url)),
  "utf8",
)) as Array<{ file: string }>).map(({ file }) => readFileSync(
  fileURLToPath(new URL(`../migrations/generated/${file}`, import.meta.url)),
  "utf8",
).replaceAll("--> statement-breakpoint", "")).join("\n");

export function applyAppMigrations(database: DatabaseSync): void {
  database.exec(migrationSql);
}
