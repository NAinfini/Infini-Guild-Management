import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import type {
  SystemTestArtifact,
  SystemTestArtifactCleaner,
  SystemTestBeforeImage,
} from "@guild/server/modules/system-test";
import { returnedRowCount } from "./sql-result.js";

export class SqliteSystemTestArtifactCleaner implements SystemTestArtifactCleaner {
  constructor(private readonly sql: SqlExecutor) {}

  async listMediaObjectKeys(mediaId: string): Promise<readonly string[]> {
    return allRows(await this.sql.execute({
      method: "all",
      sql: "SELECT object_key FROM media_variants WHERE media_id = ? ORDER BY variant",
      params: [mediaId],
    })).map((row) => {
      if (typeof row[0] !== "string") throw new Error("Invalid media object key");
      return row[0];
    });
  }

  async deleteArtifact(runId: string, artifact: SystemTestArtifact): Promise<void> {
    const guard = `SELECT 1 FROM system_test_artifacts AS artifacts
      JOIN system_test_runs AS runs ON runs.id = artifacts.run_id
      WHERE artifacts.run_id = ? AND artifacts.artifact_type = ? AND artifacts.artifact_key = ?
        AND runs.status = 'cleaning'`;
    const guardParams = [runId, artifact.type, artifact.key] as const;
    const statements = cleanupStatements(artifact, guard, guardParams);
    statements.push({
      method: "all",
      columns: ["affected"],
      sql: `DELETE FROM system_test_artifacts
        WHERE run_id = ? AND artifact_type = ? AND artifact_key = ?
          AND EXISTS (${guard})
        RETURNING 1 AS affected`,
      params: [runId, artifact.type, artifact.key, ...guardParams],
    });
    const results = await this.sql.batch(statements);
    if (returnedRowCount(results.at(-1)) !== 1) {
      throw new Error("System test artifact cleanup lost its claim");
    }
  }

  async listBeforeImages(runId: string, limit: number): Promise<readonly SystemTestBeforeImage[]> {
    return allRows(await this.sql.execute({
      method: "all",
      sql: `SELECT target_type, target_id
        FROM system_test_before_images
        WHERE run_id = ?
        ORDER BY target_type, target_id
        LIMIT ?`,
      params: [runId, limit],
    })).map(([type, key]) => {
      if (!isBeforeImageType(type) || typeof key !== "string") {
        throw new Error("Invalid system test before-image row");
      }
      return { type, key };
    });
  }

  async restoreBeforeImage(runId: string, image: SystemTestBeforeImage): Promise<void> {
    const table = beforeImageTable(image.type);
    const predicate = "images.run_id = ? AND images.target_type = ? AND images.target_id = ?";
    const params = [runId, image.type, image.key] as const;
    const results = await this.sql.batch([
      {
        method: "all",
        columns: ["affected"],
        sql: `UPDATE ${table}
          SET sort_order = (
                SELECT images.before_sort_order FROM system_test_before_images AS images
                WHERE ${predicate}
              ),
              updated_at = (
                SELECT images.before_updated_at FROM system_test_before_images AS images
                WHERE ${predicate}
              )
          WHERE id = ?
            AND EXISTS (
              SELECT 1
              FROM system_test_before_images AS images
              JOIN system_test_runs AS runs ON runs.id = images.run_id
              WHERE ${predicate}
                AND runs.status = 'cleaning'
                AND ${table}.sort_order = images.expected_sort_order
                AND ${table}.updated_at = images.expected_updated_at
            )
          RETURNING 1 AS affected`,
        params: [...params, ...params, image.key, ...params],
      },
      {
        method: "all",
        columns: ["affected"],
        sql: `DELETE FROM system_test_before_images
          WHERE run_id = ? AND target_type = ? AND target_id = ? AND changes() = 1
          RETURNING 1 AS affected`,
        params,
      },
    ]);
    if (returnedRowCount(results[0]) !== 1 || returnedRowCount(results[1]) !== 1) {
      throw new Error(`System test before-image conflict for ${image.type}:${image.key}`);
    }
  }
}

function cleanupStatements(
  artifact: SystemTestArtifact,
  guard: string,
  guardParams: readonly SqlValue[],
): SqlBatchStatement[] {
  const run = (sql: string, params: readonly SqlValue[]): SqlBatchStatement => ({ method: "run", sql, params });
  const deleteById = (table: string): SqlBatchStatement[] => [run(
    `DELETE FROM ${table} WHERE id = ? AND EXISTS (${guard})`,
    [artifact.key, ...guardParams],
  )];
  const deleteInbox = (entityType: string, sourcePrefix: string): SqlBatchStatement => run(
    `DELETE FROM notification_inbox
      WHERE entity_type = ? AND entity_id = ? AND source_key = ?
        AND EXISTS (${guard})`,
    [entityType, artifact.key, `${sourcePrefix}:${artifact.key}`, ...guardParams],
  );
  switch (artifact.type) {
    case "guild_war":
      return deleteById("guild_wars");
    case "event":
      return [
        deleteInbox("event", "event_created"),
        run(`DELETE FROM media_links WHERE entity_type = 'event' AND entity_id = ? AND EXISTS (${guard})`, [artifact.key, ...guardParams]),
        ...deleteById("events"),
      ];
    case "recurring_template":
      return [run(`DELETE FROM media_links WHERE entity_type = 'recurring_template' AND entity_id = ? AND EXISTS (${guard})`, [artifact.key, ...guardParams]), ...deleteById("recurring_templates")];
    case "storage_batch":
      return [run(`DELETE FROM storage_ledger_entries WHERE batch_id = ? AND EXISTS (${guard})`, [artifact.key, ...guardParams]), ...deleteById("storage_batches")];
    case "storage_item":
      return [
        run(`DELETE FROM storage_ledger_entries WHERE item_id = ? AND EXISTS (${guard})`, [artifact.key, ...guardParams]),
        run(`DELETE FROM media_links WHERE entity_type = 'storage_item' AND entity_id = ? AND EXISTS (${guard})`, [artifact.key, ...guardParams]),
        ...deleteById("storage_items"),
      ];
    case "storage_category": return deleteById("storage_categories");
    case "storage": return deleteById("storages");
    case "wiki_article":
      return [
        deleteInbox("wiki_article", "wiki_article_created"),
        run(`DELETE FROM media_links WHERE entity_type = 'wiki_article' AND entity_id = ? AND EXISTS (${guard})`, [artifact.key, ...guardParams]),
        run(`DELETE FROM wiki_revision_media WHERE revision_id IN (SELECT id FROM wiki_revisions WHERE article_id = ?) AND EXISTS (${guard})`, [artifact.key, ...guardParams]),
        run(`DELETE FROM wiki_revisions WHERE article_id = ? AND EXISTS (${guard})`, [artifact.key, ...guardParams]),
        ...deleteById("wiki_articles"),
      ];
    case "wiki_category": return deleteById("wiki_categories");
    case "announcement":
      return [
        deleteInbox("announcement", "announcement_published"),
        run(`DELETE FROM media_links WHERE entity_type = 'announcement' AND entity_id = ? AND EXISTS (${guard})`, [artifact.key, ...guardParams]),
        ...deleteById("announcements"),
      ];
    case "gallery_item":
      return [run(`DELETE FROM media_links WHERE entity_type = 'gallery_item' AND entity_id = ? AND EXISTS (${guard})`, [artifact.key, ...guardParams]), ...deleteById("gallery_items")];
    case "badge": return deleteById("member_badges");
    case "invite_link": return deleteById("invite_links");
    case "member_absence": return deleteById("member_absences");
    case "user": return [
      deleteInbox("member", "member_joined"),
      run(`DELETE FROM login_failures
        WHERE login_name = lower((SELECT login_name FROM user_credentials WHERE user_id = ?))
          AND EXISTS (${guard})`, [artifact.key, ...guardParams]),
      ...deleteById("users"),
    ];
    case "role": return deleteById("roles");
    case "class_tag": return deleteById("class_tags");
    case "class_catalog": return deleteById("class_catalog");
    case "media_asset": return deleteById("media_assets");
    case "error_log": return deleteById("error_log");
    case "audit_log": return deleteById("audit_log");
  }
}

function allRows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) {
    throw new Error("Invalid SQLite all result");
  }
  return result.rows as readonly (readonly SqlValue[])[];
}

function isBeforeImageType(value: SqlValue | undefined): value is SystemTestBeforeImage["type"] {
  return value === "class_catalog" || value === "class_tag" || value === "badge";
}

function beforeImageTable(type: SystemTestBeforeImage["type"]): "class_catalog" | "class_tags" | "member_badges" {
  switch (type) {
    case "class_catalog": return "class_catalog";
    case "class_tag": return "class_tags";
    case "badge": return "member_badges";
  }
}
