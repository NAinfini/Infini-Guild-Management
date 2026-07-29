import type { Bindings } from "../index";

export const SYSTEM_TEST_ARTIFACT_TYPES = [
  "user", "invite_link", "role", "event", "event_template", "announcement",
  "gallery_item", "war_history", "wiki_category", "wiki_article", "badge",
  "storage", "storage_category", "storage_item", "storage_item_image", "audit_log", "error_log", "r2_key",
] as const;
export type SystemTestArtifactType = (typeof SYSTEM_TEST_ARTIFACT_TYPES)[number];
export type SystemTestArtifact = { type: SystemTestArtifactType; key: string };
type RunRow = {
  id: string;
  actor_id: string;
  status: string;
  active_requests: number;
  cleanup_attempts: number;
};

const MAX_CLEANUP_ATTEMPTS = 3;
const STALE_RUNNING_MS = 24 * 60 * 60 * 1000;
const STALE_CLEANING_MS = 15 * 60 * 1000;

function now(): string { return new Date().toISOString(); }
function uniqueArtifacts(artifacts: readonly SystemTestArtifact[]): SystemTestArtifact[] {
  const seen = new Set<string>();
  return artifacts.filter(({ type, key }) => {
    const token = `${type}\u0000${key}`;
    if (!key || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

/** Explicit run registry and exact-ID cleanup. No marker, prefix, or time-based content lookup is permitted here. */
export class SystemTestService {
  constructor(private readonly env: Bindings) {}

  async createRun(actorId: string): Promise<string> {
    const id = crypto.randomUUID();
    const timestamp = now();
    await this.env.DB.prepare(
      "INSERT INTO system_test_runs (id, actor_id, status, created_at, updated_at) VALUES (?, ?, 'running', ?, ?)",
    ).bind(id, actorId, timestamp, timestamp).run();
    return id;
  }

  async beginRequest(runId: string): Promise<{ actorId: string } | null> {
    const row = await this.env.DB.prepare(
      "UPDATE system_test_runs SET active_requests = active_requests + 1, updated_at = ? WHERE id = ? AND status = 'running' RETURNING actor_id",
    ).bind(now(), runId).first<{ actor_id: string }>();
    return row ? { actorId: row.actor_id } : null;
  }

  async endRequest(runId: string): Promise<void> {
    await this.env.DB.prepare(
      "UPDATE system_test_runs SET active_requests = CASE WHEN active_requests > 0 THEN active_requests - 1 ELSE 0 END, updated_at = ? WHERE id = ?",
    ).bind(now(), runId).run();
  }

  async isRunOwnedBy(runId: string, actorId: string): Promise<boolean> {
    const row = await this.env.DB.prepare("SELECT id FROM system_test_runs WHERE id = ? AND actor_id = ?").bind(runId, actorId).first<{ id: string }>();
    return Boolean(row);
  }

  async markCleanupFailed(
    runId: string,
    error: string,
    artifacts: readonly SystemTestArtifact[] = [],
  ): Promise<void> {
    const statements = uniqueArtifacts(artifacts).map(({ type, key }) => this.env.DB.prepare(
      "INSERT OR IGNORE INTO system_test_artifacts (run_id, artifact_type, artifact_key) VALUES (?, ?, ?)",
    ).bind(runId, type, key));
    statements.push(this.env.DB.prepare(
      "UPDATE system_test_runs SET status = CASE WHEN status = 'manual_review' THEN status ELSE 'cleanup_failed' END, last_error = ?, completed_at = NULL, updated_at = ? WHERE id = ?",
    ).bind(error.slice(0, 1000), now(), runId));
    await this.env.DB.batch(statements);
  }

  async registerArtifacts(runId: string, artifacts: readonly SystemTestArtifact[]): Promise<void> {
    const entries = uniqueArtifacts(artifacts);
    if (entries.length === 0) return;
    const statements = entries.map(({ type, key }) => this.env.DB.prepare(
      `INSERT INTO system_test_artifacts (run_id, artifact_type, artifact_key)
       SELECT ?, ?, ? FROM system_test_runs WHERE id = ? AND status = 'running'
       ON CONFLICT(run_id, artifact_type, artifact_key)
       DO UPDATE SET artifact_key = excluded.artifact_key`,
    ).bind(runId, type, key, runId));
    const results = await this.env.DB.batch(statements);
    if (
      results.length !== entries.length
      || results.some((result) => (result.meta.changes ?? 0) === 0)
    ) {
      throw new Error("System test run is no longer accepting artifacts");
    }
  }

  /** Best-effort compensation for a response whose exact locators could not be registered. */
  async cleanupExactArtifacts(artifacts: readonly SystemTestArtifact[]): Promise<void> {
    const entries = uniqueArtifacts(artifacts);
    const byType = new Map<SystemTestArtifactType, string[]>();
    for (const entry of entries) byType.set(entry.type, [...(byType.get(entry.type) ?? []), entry.key]);
    const deleteById = async (table: string, type: SystemTestArtifactType) => {
      for (const id of byType.get(type) ?? []) await this.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    };
    // These are exact primary-key deletes only. Foreign-key failure is surfaced
    // to the caller, which then retains the run for manual repair.
    await this.deleteWarHistories(byType.get("war_history") ?? []);
    const templateIds = byType.get("event_template") ?? [];
    await deleteById("recurring_templates", "event_template");
    const eventIds = new Set(byType.get("event") ?? []);
    for (const templateId of templateIds) {
      const generated = await this.env.DB.prepare(
        "SELECT id FROM events WHERE series_id = ?",
      ).bind(templateId).all<{ id: string }>();
      for (const event of generated.results ?? []) eventIds.add(event.id);
    }
    await this.deleteEvents([...eventIds]);
    await deleteById("storage_item_images", "storage_item_image");
    await deleteById("storage_items", "storage_item");
    await deleteById("storage_categories", "storage_category");
    await deleteById("storages", "storage");
    await deleteById("wiki_articles", "wiki_article");
    await deleteById("wiki_categories", "wiki_category");
    await deleteById("announcements", "announcement");
    await deleteById("gallery_items", "gallery_item");
    await deleteById("member_badges", "badge");
    await deleteById("invite_links", "invite_link");
    await deleteById("audit_log", "audit_log");
    await deleteById("error_log", "error_log");
    for (const userId of byType.get("user") ?? []) {
      const user = await this.env.DB.prepare("SELECT username FROM users WHERE id = ?").bind(userId).first<{ username: string }>();
      if (user) await this.env.DB.batch([
        this.env.DB.prepare("DELETE FROM login_failures WHERE username = ?").bind(user.username),
        this.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
      ]);
    }
    await deleteById("roles", "role");
    for (const key of byType.get("r2_key") ?? []) {
      await this.env.DB.prepare("DELETE FROM media_references WHERE media_key = ?").bind(key).run();
      await this.env.MEDIA.delete(key);
    }
  }

  async cleanupRun(runId: string, actorId?: string): Promise<{ status: string; attempts: number }> {
    const run = await this.env.DB.prepare(
      "SELECT id, actor_id, status, active_requests, cleanup_attempts FROM system_test_runs WHERE id = ?",
    ).bind(runId).first<RunRow>();
    if (!run) throw new Error("System test run not found");
    if (actorId && run.actor_id !== actorId) throw new Error("System test run belongs to another actor");
    if (run.status === "completed" || run.status === "manual_review") return { status: run.status, attempts: run.cleanup_attempts };

    const claim = await this.env.DB.prepare(
      "UPDATE system_test_runs SET status = 'cleaning', cleanup_attempts = cleanup_attempts + 1, updated_at = ? WHERE id = ? AND status IN ('running', 'cleanup_failed') AND active_requests = 0",
    ).bind(now(), runId).run();
    if ((claim.meta.changes ?? 0) === 0) {
      const current = await this.env.DB.prepare("SELECT status, cleanup_attempts FROM system_test_runs WHERE id = ?").bind(runId).first<{ status: string; cleanup_attempts: number }>();
      return { status: current?.status ?? "cleanup_failed", attempts: current?.cleanup_attempts ?? run.cleanup_attempts };
    }

    const attempts = run.cleanup_attempts + 1;
    try {
      await this.deleteRegisteredArtifacts(runId);
      await this.env.DB.batch([
        this.env.DB.prepare("DELETE FROM system_test_artifacts WHERE run_id = ?").bind(runId),
        this.env.DB.prepare("UPDATE system_test_runs SET status = 'completed', last_error = NULL, completed_at = ?, updated_at = ? WHERE id = ?").bind(now(), now(), runId),
      ]);
      return { status: "completed", attempts };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
      const status = attempts >= MAX_CLEANUP_ATTEMPTS ? "manual_review" : "cleanup_failed";
      await this.env.DB.prepare(
        "UPDATE system_test_runs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?",
      ).bind(status, message, now(), runId).run();
      return { status, attempts };
    }
  }

  async cleanupStaleRuns(): Promise<{ processed: number; completed: number; manualReview: number }> {
    const timestamp = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
    const cleaningTimestamp = new Date(Date.now() - STALE_CLEANING_MS).toISOString();
    await this.env.DB.prepare(
      `DELETE FROM system_test_runs
       WHERE status = 'completed'
         AND updated_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM system_test_artifacts
           WHERE system_test_artifacts.run_id = system_test_runs.id
         )`,
    ).bind(timestamp).run();
    const rows = await this.env.DB.prepare(
      "SELECT id, status FROM system_test_runs WHERE (status = 'cleanup_failed' AND active_requests = 0) OR (status = 'running' AND updated_at < ?) OR (status = 'cleaning' AND updated_at < ?) ORDER BY updated_at ASC LIMIT 100",
    ).bind(timestamp, cleaningTimestamp).all<{ id: string; status: string }>();
    let completed = 0;
    let manualReview = 0;
    for (const row of rows.results ?? []) {
      // A Worker request cannot legitimately remain active for 24 hours. If an
      // isolate died before releasing its lease, the stale-run threshold is the
      // safe point to reclaim that counter.
      if (row.status === "running") {
        await this.env.DB.prepare(
          "UPDATE system_test_runs SET status = 'cleanup_failed', active_requests = 0, updated_at = ? WHERE id = ? AND status = 'running' AND updated_at < ?",
        ).bind(now(), row.id, timestamp).run();
      }
      // Interrupted cleaners are safely reclaimed as failed before the normal CAS claim.
      if (row.status === "cleaning") {
        await this.env.DB.prepare("UPDATE system_test_runs SET status = 'cleanup_failed', updated_at = ? WHERE id = ? AND status = 'cleaning'").bind(now(), row.id).run();
      }
      const result = await this.cleanupRun(row.id);
      if (result.status === "completed") completed += 1;
      if (result.status === "manual_review") manualReview += 1;
    }
    return { processed: (rows.results ?? []).length, completed, manualReview };
  }

  async finalizeRun(
    runId: string,
    actorId: string,
    summary?: { diffTitle: string; detailText: string },
  ): Promise<void> {
    const completedRunPredicate = `
      id = ? AND actor_id = ? AND status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM system_test_artifacts
        WHERE system_test_artifacts.run_id = system_test_runs.id
      )
    `;
    if (!summary) {
      const result = await this.env.DB.prepare(
        `DELETE FROM system_test_runs WHERE ${completedRunPredicate}`,
      ).bind(runId, actorId).run();
      if ((result.meta.changes ?? 0) !== 1) {
        await this.acceptMissingFinalizedRun(runId, actorId);
      }
      return;
    }

    const auditId = crypto.randomUUID();
    const results = await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO audit_log
           (id, entity_type, action, actor_id, entity_id, diff_title, detail_text)
         SELECT ?, 'system_test', 'run', actor_id, 'admin-console-api', ?, ?
         FROM system_test_runs
         WHERE ${completedRunPredicate}`,
      ).bind(auditId, summary.diffTitle, summary.detailText, runId, actorId),
      this.env.DB.prepare(
        `DELETE FROM system_test_runs WHERE ${completedRunPredicate}`,
      ).bind(runId, actorId),
    ]);
    if (results.length !== 2 || results.some((result) => (result.meta.changes ?? 0) !== 1)) {
      await this.acceptMissingFinalizedRun(runId, actorId);
    }
  }

  private async acceptMissingFinalizedRun(runId: string, actorId: string): Promise<void> {
    const remaining = await this.env.DB.prepare(
      "SELECT actor_id, status FROM system_test_runs WHERE id = ?",
    ).bind(runId).first<{ actor_id: string; status: string }>();
    if (!remaining) return;
    if (remaining.actor_id !== actorId) throw new Error("System test run belongs to another actor");
    throw new Error(`System test run is not ready to finalize (${remaining.status})`);
  }

  private async deleteWarHistories(historyIds: readonly string[]): Promise<void> {
    for (const historyId of historyIds) {
      await this.env.DB.batch([
        this.env.DB.prepare("DELETE FROM war_team_members WHERE war_team_id IN (SELECT id FROM war_teams WHERE war_history_id = ?)").bind(historyId),
        this.env.DB.prepare("DELETE FROM war_pool_members WHERE war_history_id = ?").bind(historyId),
        this.env.DB.prepare("DELETE FROM war_teams WHERE war_history_id = ?").bind(historyId),
        this.env.DB.prepare("DELETE FROM war_history WHERE id = ?").bind(historyId),
      ]);
    }
  }

  private async deleteEvents(eventIds: readonly string[]): Promise<void> {
    for (const eventId of eventIds) {
      await this.env.DB.batch([
        this.env.DB.prepare("DELETE FROM event_poll_votes WHERE event_id = ?").bind(eventId),
        this.env.DB.prepare("DELETE FROM event_raffle_winners WHERE event_id = ?").bind(eventId),
        this.env.DB.prepare("DELETE FROM event_participants WHERE event_id = ?").bind(eventId),
        this.env.DB.prepare("DELETE FROM war_team_members WHERE war_team_id IN (SELECT id FROM war_teams WHERE event_id = ?)").bind(eventId),
        this.env.DB.prepare("DELETE FROM war_pool_members WHERE event_id = ?").bind(eventId),
        this.env.DB.prepare("DELETE FROM war_teams WHERE event_id = ?").bind(eventId),
        this.env.DB.prepare("DELETE FROM events WHERE id = ?").bind(eventId),
      ]);
    }
  }

  private async deleteRegisteredArtifacts(runId: string): Promise<void> {
    const rows = await this.env.DB.prepare(
      "SELECT artifact_type, artifact_key FROM system_test_artifacts WHERE run_id = ?",
    ).bind(runId).all<{ artifact_type: SystemTestArtifactType; artifact_key: string }>();
    const byType = new Map<SystemTestArtifactType, string[]>();
    for (const row of rows.results ?? []) byType.set(row.artifact_type, [...(byType.get(row.artifact_type) ?? []), row.artifact_key]);
    const keys = (type: SystemTestArtifactType) => byType.get(type) ?? [];
    const deleteById = async (table: string, ids: readonly string[]) => {
      for (const id of ids) await this.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    };

    await this.deleteWarHistories(keys("war_history"));
    const templateIds = keys("event_template");
    await deleteById("recurring_templates", templateIds);
    const eventIds = new Set(keys("event"));
    for (const templateId of templateIds) {
      const generated = await this.env.DB.prepare(
        "SELECT id FROM events WHERE series_id = ?",
      ).bind(templateId).all<{ id: string }>();
      for (const event of generated.results ?? []) eventIds.add(event.id);
    }
    await this.deleteEvents([...eventIds]);
    await deleteById("wiki_articles", keys("wiki_article"));
    await deleteById("wiki_categories", keys("wiki_category"));
    await deleteById("storage_item_images", keys("storage_item_image"));
    await deleteById("storage_items", keys("storage_item"));
    await deleteById("storage_categories", keys("storage_category"));
    await deleteById("storages", keys("storage"));
    await deleteById("announcements", keys("announcement"));
    await deleteById("gallery_items", keys("gallery_item"));
    await deleteById("member_badges", keys("badge"));
    await deleteById("invite_links", keys("invite_link"));
    await deleteById("audit_log", keys("audit_log"));
    await deleteById("error_log", keys("error_log"));

    for (const userId of keys("user")) {
      const user = await this.env.DB.prepare("SELECT username FROM users WHERE id = ?").bind(userId).first<{ username: string }>();
      if (!user) continue;
      const unregisteredAudit = await this.env.DB.prepare(
        "SELECT id FROM audit_log WHERE actor_id = ? AND id NOT IN (SELECT artifact_key FROM system_test_artifacts WHERE run_id = ? AND artifact_type = 'audit_log') LIMIT 1",
      ).bind(userId, runId).first<{ id: string }>();
      if (unregisteredAudit) throw new Error(`registered user ${userId} still owns unregistered audit ${unregisteredAudit.id}`);
      await this.env.DB.batch([
        this.env.DB.prepare("DELETE FROM login_failures WHERE username = ?").bind(user.username),
        this.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
      ]);
    }
    await deleteById("roles", keys("role"));

    for (const r2Key of keys("r2_key")) {
      await this.env.DB.prepare("DELETE FROM media_references WHERE media_key = ?").bind(r2Key).run();
      await this.env.MEDIA.delete(r2Key);
    }
  }
}

export function getSystemTestRunId(c: { get(key: string): unknown }): string | null {
  const value = c.get("systemTestRunId");
  return typeof value === "string" ? value : null;
}
