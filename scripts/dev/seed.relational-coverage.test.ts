import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import { auditPayloadV2Schema } from "@guild/shared";

const migrationManifest = JSON.parse(readFileSync(resolve(
  process.cwd(),
  "packages/persistence-sqlite/src/migrations/generated/manifest.json",
), "utf8")) as Array<{ file: string }>;
const migrationStatements = migrationManifest.flatMap(({ file }) => statements(readFileSync(resolve(
  process.cwd(),
  "packages/persistence-sqlite/src/migrations/generated",
  file,
), "utf8")));
const seedStatements = statements(readFileSync(resolve(process.cwd(), "scripts/dev/seed.sql"), "utf8"));

describe("development relational seed coverage", () => {
  it("seeds visible relational states and remains idempotent", async () => {
    const miniflare = new Miniflare({
      compatibilityDate: "2026-07-28",
      d1Databases: { DB: "development-relational-seed" },
      modules: true,
      port: 0,
      script: "export default {}",
    });

    try {
      const database = await miniflare.getD1Database("DB");
      await execute(database, migrationStatements);
      await execute(database, seedStatements);
      await database.batch([
        database.prepare(`UPDATE invite_links
          SET expires_at = '2020-01-01T00:00:00.000Z'
          WHERE id = 'dev-invite-active'`),
        database.prepare(`UPDATE login_failures
          SET locked_until = '2020-01-01T00:00:00.000Z'
          WHERE login_name = 'member_08'`),
        database.prepare(`UPDATE announcements
          SET status = 'published', publish_at = '2020-01-01T00:00:00.000Z',
              expires_at = '2020-01-02T00:00:00.000Z'
          WHERE id = 'dev-announcement-scheduled'`),
        database.prepare(`UPDATE member_absences
          SET start_date = '2020-01-01', end_date = '2020-01-02'
          WHERE id = 'dev-absence-member-08'`),
      ]);
      await execute(database, seedStatements);

      const row = await database.prepare(`
        SELECT
          (SELECT count(*) FROM user_credentials WHERE user_id LIKE 'dev-%') AS credentials,
          (SELECT count(*) FROM login_failures
            WHERE login_name = 'member_08' AND fail_count = 6
              AND locked_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS activeLoginLocks,
          (SELECT count(*) FROM invite_links
            WHERE id LIKE 'dev-invite-%' AND revoked_at IS NULL
              AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              AND used_count < max_uses) AS activeInvites,
          (SELECT count(*) FROM invite_links
            WHERE id LIKE 'dev-invite-%' AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              AND revoked_at IS NULL) AS expiredInvites,
          (SELECT count(*) FROM invite_links
            WHERE id LIKE 'dev-invite-%' AND revoked_at IS NOT NULL) AS revokedInvites,
          (SELECT count(*) FROM invite_links
            WHERE id LIKE 'dev-invite-%' AND used_count = max_uses
              AND revoked_at IS NULL) AS exhaustedInvites,
          (SELECT count(*) FROM announcements WHERE status = 'draft') AS draftAnnouncements,
          (SELECT count(*) FROM announcements WHERE status = 'scheduled') AS scheduledAnnouncements,
          (SELECT count(*) FROM announcements
            WHERE id = 'dev-announcement-scheduled' AND status = 'scheduled'
              AND publish_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS futureScheduledAnnouncements,
          (SELECT count(*) FROM announcements WHERE status = 'archived') AS archivedAnnouncements,
          (SELECT count(*) FROM member_absences
            WHERE id = 'dev-absence-member-08' AND start_date > date('now')) AS futureAbsences,
          (SELECT count(DISTINCT type) FROM events WHERE id LIKE 'dev-event-%') AS eventTypes,
          (SELECT count(*) FROM recurring_templates WHERE id LIKE 'dev-template-%') AS recurringTemplates,
          (SELECT count(*) FROM recurring_template_weekdays WHERE template_id LIKE 'dev-template-%') AS recurringWeekdays,
          (SELECT count(*) FROM recurring_template_class_quotas WHERE template_id = 'dev-template-weekly') AS recurringQuotas,
          (SELECT count(*) FROM event_class_quotas WHERE event_id LIKE 'dev-event-%') AS eventQuotas,
          (SELECT count(*) FROM event_poll_options WHERE event_id = 'dev-event-poll') AS pollOptions,
          (SELECT count(*) FROM event_poll_votes WHERE event_id = 'dev-event-poll') AS pollVotes,
          (SELECT count(*) FROM event_raffle_draws WHERE event_id = 'dev-event-raffle') AS raffleDraws,
          (SELECT count(*) FROM event_raffle_winners WHERE event_id = 'dev-event-raffle') AS raffleWinners,
          (SELECT count(*) FROM wiki_revisions WHERE article_id = 'dev-wiki-article-war-playbook') AS playbookRevisions,
          (SELECT count(*) FROM wiki_articles
            WHERE id = 'dev-wiki-article-archived' AND archived_at IS NOT NULL) AS archivedArticles,
          (SELECT count(*) FROM member_profile_videos WHERE user_id LIKE 'dev-%') AS profileVideos,
          (SELECT count(DISTINCT transaction_type) FROM storage_batches WHERE id LIKE 'dev-storage-%') AS storageTransactionTypes,
          (SELECT count(*) FROM guild_wars WHERE id = 'dev-war-history-3' AND result = 'draw') AS drawWars,
          (SELECT count(*) FROM war_teams WHERE id = 'dev-team-active-a' AND is_locked = 1) AS lockedTeams,
          (SELECT count(*) FROM war_members WHERE war_id = 'dev-war-active' AND team_id IS NULL) AS poolMembers,
          (SELECT count(*) FROM gallery_items WHERE id LIKE 'dev-gallery-%') AS galleryItems,
          (SELECT count(*) FROM audit_log WHERE id LIKE 'dev-audit-%') AS auditRows,
          (SELECT count(*) FROM error_log WHERE id LIKE 'dev-error-%') AS errorRows,
          (SELECT count(*) FROM sessions) AS sessions,
          (SELECT count(*) FROM scheduled_job_leases) AS scheduledLeases,
          (SELECT count(*) FROM system_test_runs) AS systemTestRuns,
          (SELECT count(*) FROM invite_links WHERE id LIKE 'dev-invite-%') AS inviteRows,
          (SELECT count(*) FROM login_failures WHERE login_name = 'member_08') AS loginFailureRows,
          (SELECT count(*) FROM announcements WHERE id LIKE 'dev-announcement-%') AS announcementRows,
          (SELECT count(*) FROM member_absences WHERE id = 'dev-absence-member-08') AS absenceRows
      `).first<Record<string, number>>();

      expect(row).toMatchObject({
        credentials: 32,
        activeLoginLocks: 1,
        activeInvites: 1,
        expiredInvites: 1,
        revokedInvites: 1,
        exhaustedInvites: 1,
        draftAnnouncements: 1,
        scheduledAnnouncements: 1,
        futureScheduledAnnouncements: 1,
        archivedAnnouncements: 1,
        futureAbsences: 1,
        eventTypes: 6,
        recurringTemplates: 2,
        recurringWeekdays: 3,
        recurringQuotas: 2,
        eventQuotas: 3,
        pollOptions: 3,
        pollVotes: 20,
        raffleDraws: 1,
        raffleWinners: 2,
        playbookRevisions: 3,
        archivedArticles: 1,
        profileVideos: 3,
        storageTransactionTypes: 3,
        drawWars: 1,
        lockedTeams: 1,
        poolMembers: 3,
        galleryItems: 4,
        auditRows: 4,
        errorRows: 4,
        sessions: 0,
        scheduledLeases: 0,
        systemTestRuns: 0,
        inviteRows: 4,
        loginFailureRows: 1,
        announcementRows: 5,
        absenceRows: 1,
      });

      const auditResult = await database.prepare(`SELECT id, subject_label, payload_json
        FROM audit_log WHERE id LIKE 'dev-audit-%' ORDER BY id`).all<{
          id: string;
          subject_label: string | null;
          payload_json: string;
        }>();
      const auditRows = new Map(auditResult.results.map((audit) => [audit.id, {
        subjectLabel: audit.subject_label,
        payload: auditPayloadV2Schema.parse(JSON.parse(audit.payload_json)),
      }]));
      const requireAudit = (id: string) => {
        const audit = auditRows.get(id);
        if (!audit) throw new Error(`Missing development audit fixture: ${id}`);
        return audit;
      };
      const fields = (id: string) => requireAudit(id).payload.context.map(({ field }) => field);

      expect(requireAudit("dev-audit-seed-init").subjectLabel).toBe("Development database");
      expect(fields("dev-audit-seed-init")).toEqual(["type"]);

      const inviteAudit = requireAudit("dev-audit-invite-create");
      expect(inviteAudit.subjectLabel).toBe("Member");
      expect(fields("dev-audit-invite-create")).toEqual([
        "role_id",
        "role_name",
        "max_uses",
        "used_count",
        "status",
        "expires_at",
      ]);
      expect(inviteAudit.payload.context.find(({ field }) => field === "used_count")?.value)
        .toEqual({ type: "number", value: 0 });
      expect(inviteAudit.payload.context.find(({ field }) => field === "status")?.value)
        .toEqual({ type: "code", value: "active" });
      const inviteExpiry = inviteAudit.payload.context.find(({ field }) => field === "expires_at")?.value;
      expect(inviteExpiry?.type).toBe("datetime");
      if (inviteExpiry?.type === "datetime") expect(Date.parse(inviteExpiry.value)).toBeGreaterThan(Date.now());

      expect(requireAudit("dev-audit-storage-distribute").subjectLabel).toBe("Recovery Potion distribution");
      expect(fields("dev-audit-storage-distribute")).toEqual([
        "transaction_count",
        "type",
        "item_ids",
        "quantity",
        "user_ids",
      ]);

      expect(requireAudit("dev-audit-war-draw").subjectLabel).toBe("Guild War: Frost Reapers");
      expect(fields("dev-audit-war-draw")).toEqual(["event_id", "result", "member_count"]);
    } finally {
      await miniflare.dispose();
    }
  }, 45_000);
});

type DevelopmentDatabase = Awaited<ReturnType<Miniflare["getD1Database"]>>;

async function execute(database: DevelopmentDatabase, sql: readonly string[]): Promise<void> {
  for (let offset = 0; offset < sql.length; offset += 50) {
    await database.batch(sql.slice(offset, offset + 50).map((statement) => database.prepare(statement)));
  }
}

function statements(sql: string): string[] {
  return sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
}
