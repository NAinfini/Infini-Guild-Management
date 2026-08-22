import type { SqlBatchStatement, SqlExecutor } from "@guild/kernel";
import type { EventGuildWarLifecycleStore } from "@guild/server/modules/events";
import type { GuildWarEventRosterStore } from "@guild/server/modules/guild-war";
import type { AuditEventWrite } from "@guild/server/modules/audit";
import { auditInsertStatement } from "./audit-statement.js";
import { versionGuard, versionUpdate } from "./guild-war-store.js";
import { returnedRowCount, returnedRows } from "./sql-result.js";

function auditWithUserLabels(
  audit: AuditEventWrite,
  userIds: readonly string[],
  labels: ReadonlyMap<string, string>,
): AuditEventWrite {
  return {
    ...audit,
    payload: {
      ...audit.payload,
      context: [
        ...audit.payload.context,
        {
          field: "user_ids",
          value: {
            type: "list",
            value: userIds.map((id) => ({
              type: "reference" as const,
              value: { id, label: labels.get(id)! },
            })),
          },
        },
      ],
    },
  };
}

export class SqliteEventGuildWarLifecycleStore
implements EventGuildWarLifecycleStore, GuildWarEventRosterStore {
  constructor(private readonly sql: SqlExecutor) {}

  async destroyEvent(
    input: Parameters<EventGuildWarLifecycleStore["destroyEvent"]>[0],
  ): ReturnType<EventGuildWarLifecycleStore["destroyEvent"]> {
    const results = await this.sql.batch([
      {
        method: "get",
        columns: ["event_exists", "active_war_exists"],
        sql: `SELECT
          EXISTS(SELECT 1 FROM events WHERE id = ?) AS event_exists,
          EXISTS(SELECT 1 FROM guild_wars WHERE event_id = ? AND status = 'active') AS active_war_exists`,
        params: [input.eventId, input.eventId],
      },
      {
        method: "run",
        sql: "DELETE FROM guild_wars WHERE event_id = ? AND status = 'active' AND ? = 1",
        params: [input.eventId, input.allowActiveWarDelete ? 1 : 0],
      },
      {
        method: "all",
        columns: ["affected"],
        sql: `DELETE FROM events
          WHERE id = ?
            AND (? = 1 OR NOT EXISTS (
              SELECT 1 FROM guild_wars WHERE event_id = ? AND status = 'active'
            ))
          RETURNING 1 AS affected`,
        params: [input.eventId, input.allowActiveWarDelete ? 1 : 0, input.eventId],
      },
      auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" }),
    ]);
    const state = returnedRows(results[0])[0];
    if (!state || state[0] !== 1) return "not_found";
    if (state[1] === 1 && !input.allowActiveWarDelete) {
      return "active_war_permission_required";
    }
    if (returnedRowCount(results[2]) !== 1) {
      throw new Error("Event lifecycle deletion lost its atomic guard");
    }
    return "deleted";
  }

  async moveMembers(input: Parameters<GuildWarEventRosterStore["moveMembers"]>[0]): Promise<boolean> {
    const nextVersion = input.expectedVersion + 1;
    const guard = versionGuard(input.warId, nextVersion, "active", input.audit.eventId);
    const moves = JSON.stringify(input.moves);
    const labelRows = returnedRows(await this.sql.execute({
      method: "all",
      columns: ["id", "username"],
      sql: `SELECT id, username FROM users
        WHERE id IN (SELECT CAST(json_extract(value, '$.userId') AS TEXT) FROM json_each(?))`,
      params: [moves],
    }));
    const labels = new Map(labelRows.flatMap(([id, username]) => (
      typeof id === "string" && typeof username === "string" ? [[id, username] as const] : []
    )));
    if (labels.size !== new Set(input.moves.map(({ userId }) => userId)).size) {
      throw new TypeError("Guild-war roster audit could not resolve every member username");
    }
    const audit = auditWithUserLabels(input.audit, input.moves.map(({ userId }) => userId), labels);
    const expectedVersionGuard = `SELECT 1 FROM guild_wars
      WHERE id = ? AND status = 'active' AND roster_version = ?`;
    const statements: SqlBatchStatement[] = [{
      method: "run",
      sql: `INSERT INTO event_participants (id, event_id, user_id, joined_at)
        SELECT
          CAST(json_extract(value, '$.participantId') AS TEXT),
          ?,
          CAST(json_extract(value, '$.userId') AS TEXT),
          ?
        FROM json_each(?)
        WHERE json_extract(value, '$.participantId') IS NOT NULL
          AND EXISTS (${expectedVersionGuard})
        ON CONFLICT(event_id, user_id) DO NOTHING`,
      params: [input.eventId, input.now, moves, input.warId, input.expectedVersion],
    }, versionUpdate(
      input.warId,
      input.expectedVersion,
      input.actorUserId,
      input.now,
      "active",
      input.audit.eventId,
      { eventId: input.eventId, userIds: input.moves.map(({ userId }) => userId) },
    ), {
      method: "run",
      sql: `DELETE FROM war_members
        WHERE war_id = ?
          AND user_id IN (
            SELECT CAST(json_extract(value, '$.userId') AS TEXT)
            FROM json_each(?)
            WHERE CAST(json_extract(value, '$.to') AS TEXT) = 'remove'
          )
          AND EXISTS (${guard.sql})`,
      params: [input.warId, moves, ...guard.params],
    }, {
      method: "run",
      sql: `DELETE FROM event_participants
        WHERE event_id = ?
          AND user_id IN (
            SELECT CAST(json_extract(value, '$.userId') AS TEXT)
            FROM json_each(?)
            WHERE CAST(json_extract(value, '$.to') AS TEXT) = 'remove'
          )
          AND EXISTS (${guard.sql})`,
      params: [input.eventId, moves, ...guard.params],
    }, {
      method: "run",
      sql: `WITH requested AS (
          SELECT
            CAST(json_extract(value, '$.id') AS TEXT) AS id,
            CAST(json_extract(value, '$.userId') AS TEXT) AS user_id,
            CASE
              WHEN CAST(json_extract(value, '$.to') AS TEXT) = 'pool' THEN NULL
              ELSE CAST(json_extract(value, '$.to') AS TEXT)
            END AS team_id,
            CAST(key AS INTEGER) AS ordinal
          FROM json_each(?)
          WHERE CAST(json_extract(value, '$.to') AS TEXT) <> 'remove'
        ), ranked AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY ordinal) - 1 AS target_offset
          FROM requested
        )
        INSERT INTO war_members (id, war_id, team_id, user_id, sort_order)
        SELECT
          id,
          ?,
          team_id,
          user_id,
          COALESCE((
            SELECT MAX(existing.sort_order) + 1
            FROM war_members existing
            WHERE existing.war_id = ? AND existing.team_id IS ranked.team_id
          ), 0) + target_offset
        FROM ranked
        WHERE EXISTS (${guard.sql})
        ON CONFLICT(war_id, user_id) DO UPDATE SET
          team_id = excluded.team_id,
          sort_order = excluded.sort_order`,
      params: [moves, input.warId, input.warId, ...guard.params],
    }];
    statements.push(auditInsertStatement(audit, guard));
    const results = await this.sql.batch(statements);
    return returnedRowCount(results[1]) === 1;
  }
}
