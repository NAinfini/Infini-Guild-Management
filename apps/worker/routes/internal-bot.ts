import {
  ERROR_STATUS,
  discordLinkStartSchema,
  discordLinkVerifySchema,
  type ErrorCode,
  type StandardErrorResponse,
} from "@guild/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import {
  botDeliveryLog,
  discordLinkCodes,
  eventParticipants,
  events,
  memberProfiles,
  users,
} from "../db/schema";
import type { Bindings } from "../index";
import { writeAuditLog } from "../services/audit";
import { publishEntityChanged } from "../services/push";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

type BotUserLookup = {
  userId: string;
  discordId: string | null;
};

export const internalBotRoutes = new Hono();

function getDb(c: Context) {
  const env = c.env as Bindings;
  return drizzle(env.DB);
}

function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = {
    error_code: code,
    message,
    request_id: requestId,
    ...(details ? { details } : {}),
  };
  return c.json(body, ERROR_STATUS[code] as ErrorStatusCode);
}

function parseRecord(body: unknown): Record<string, unknown> {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}

function parseStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

async function parseJson(c: Context): Promise<unknown | Response> {
  try {
    return await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }
}

async function resolveUserForBot(c: Context, body: Record<string, unknown>): Promise<BotUserLookup | Response> {
  const userId = parseStringField(body, "user_id");
  const discordId = parseStringField(body, "discord_id");
  const db = getDb(c);

  if (userId) {
    const user = (
      await db
        .select({
          id: users.id,
          deletedAt: users.deletedAt,
          isActive: users.isActive,
          discordId: memberProfiles.discordId,
        })
        .from(users)
        .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
        .where(eq(users.id, userId))
        .limit(1)
    )[0];

    if (!user || user.deletedAt !== null || !user.isActive) {
      return buildError(c, "NOT_FOUND", "User not found");
    }

    return { userId: user.id, discordId: user.discordId ?? null };
  }

  if (discordId) {
    const linked = (
      await db
        .select({
          userId: memberProfiles.userId,
          discordId: memberProfiles.discordId,
          deletedAt: users.deletedAt,
          isActive: users.isActive,
        })
        .from(memberProfiles)
        .innerJoin(users, eq(users.id, memberProfiles.userId))
        .where(eq(memberProfiles.discordId, discordId))
        .limit(1)
    )[0];

    if (!linked || linked.deletedAt !== null || !linked.isActive) {
      return buildError(c, "NOT_FOUND", "Linked user not found for discord_id");
    }

    return { userId: linked.userId, discordId: linked.discordId ?? discordId };
  }

  return buildError(c, "VALIDATION_ERROR", "Either user_id or discord_id is required");
}

internalBotRoutes.post("/signup", async (c) => {
  const body = await parseJson(c);
  if (body instanceof Response) {
    return body;
  }

  const record = parseRecord(body);
  const eventId = parseStringField(record, "event_id");
  if (!eventId) {
    return buildError(c, "VALIDATION_ERROR", "event_id is required");
  }

  const resolvedUser = await resolveUserForBot(c, record);
  if (resolvedUser instanceof Response) {
    return resolvedUser;
  }

  const participantId = nanoid();
  const env = c.env as Bindings;
  const insertResult = await env.DB.prepare(
    `
      INSERT INTO event_participants (id, event_id, user_id)
      SELECT ?1, ?2, ?3
      WHERE EXISTS (
        SELECT 1
        FROM events e
        WHERE e.id = ?2
          AND e.archived_at IS NULL
          AND e.signup_locked = 0
          AND (
            e.capacity IS NULL
            OR (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id) < e.capacity
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM event_participants p
        WHERE p.event_id = ?2 AND p.user_id = ?3
      )
    `,
  )
    .bind(participantId, eventId, resolvedUser.userId)
    .run();

  if ((insertResult.meta?.changes ?? 0) !== 1) {
    const db = getDb(c);
    const eventRow = (
      await db
        .select({
          id: events.id,
          archivedAt: events.archivedAt,
          signupLocked: events.signupLocked,
          capacity: events.capacity,
        })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1)
    )[0];

    if (!eventRow) {
      return buildError(c, "NOT_FOUND", "Event not found");
    }
    if (eventRow.archivedAt !== null) {
      return buildError(c, "CONFLICT", "Event is archived");
    }
    if (eventRow.signupLocked) {
      return buildError(c, "CONFLICT", "Event signup is locked");
    }

    const existing = (
      await db
        .select({ id: eventParticipants.id })
        .from(eventParticipants)
        .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, resolvedUser.userId)))
        .limit(1)
    )[0];
    if (existing) {
      return buildError(c, "CONFLICT", "Already joined");
    }

    if (eventRow.capacity !== null) {
      const countRow = (
        await db
          .select({ count: sql<number>`count(*)` })
          .from(eventParticipants)
          .where(eq(eventParticipants.eventId, eventId))
      )[0];
      if (Number(countRow?.count ?? 0) >= eventRow.capacity) {
        return buildError(c, "CONFLICT", "Event is full");
      }
    }

    return buildError(c, "SERVER_ERROR", "Failed to join event");
  }

  await writeAuditLog(c, {
    entityType: "event_participant",
    action: "join_by_bot",
    actorId: resolvedUser.userId,
    entityId: `${eventId}:${resolvedUser.userId}`,
    detailText: JSON.stringify({
      event_id: eventId,
      user_id: resolvedUser.userId,
      source: parseStringField(record, "source") ?? "discord",
    }),
  });

  await publishEntityChanged(c.env as Bindings, {
    entityType: "event",
    entityId: eventId,
    hint: "participant_joined",
  });

  return c.json({ ok: true, event_id: eventId, user_id: resolvedUser.userId });
});

internalBotRoutes.post("/leave", async (c) => {
  const body = await parseJson(c);
  if (body instanceof Response) {
    return body;
  }

  const record = parseRecord(body);
  const eventId = parseStringField(record, "event_id");
  if (!eventId) {
    return buildError(c, "VALIDATION_ERROR", "event_id is required");
  }

  const resolvedUser = await resolveUserForBot(c, record);
  if (resolvedUser instanceof Response) {
    return resolvedUser;
  }

  const db = getDb(c);
  const existing = (
    await db
      .select({ id: eventParticipants.id })
      .from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, resolvedUser.userId)))
      .limit(1)
  )[0];

  await db
    .delete(eventParticipants)
    .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, resolvedUser.userId)));

  if (existing) {
    await writeAuditLog(c, {
      entityType: "event_participant",
      action: "leave_by_bot",
      actorId: resolvedUser.userId,
      entityId: `${eventId}:${resolvedUser.userId}`,
      detailText: JSON.stringify({
        event_id: eventId,
        user_id: resolvedUser.userId,
        source: parseStringField(record, "source") ?? "discord",
      }),
    });

    await publishEntityChanged(c.env as Bindings, {
      entityType: "event",
      entityId: eventId,
      hint: "participant_left",
    });
  }

  return c.json({ ok: true, event_id: eventId, user_id: resolvedUser.userId });
});

internalBotRoutes.post("/link/start", async (c) => {
  const body = await parseJson(c);
  if (body instanceof Response) {
    return body;
  }

  const baseParsed = discordLinkStartSchema.safeParse(body);
  if (!baseParsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid link start payload", baseParsed.error.flatten());
  }

  const record = parseRecord(body);
  const discordId = parseStringField(record, "discord_id") ?? c.req.header("X-Discord-Id") ?? null;
  if (!discordId) {
    return buildError(c, "VALIDATION_ERROR", "discord_id is required");
  }

  const db = getDb(c);
  const user = (
    await db
      .select({
        id: users.id,
        deletedAt: users.deletedAt,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.username, baseParsed.data.username))
      .limit(1)
  )[0];

  if (!user || user.deletedAt !== null || !user.isActive) {
    return buildError(c, "NOT_FOUND", "Username not found");
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await db
    .update(discordLinkCodes)
    .set({ used: true })
    .where(and(eq(discordLinkCodes.discordId, discordId), eq(discordLinkCodes.used, false)));

  await db.insert(discordLinkCodes).values({
    id: nanoid(),
    userId: user.id,
    discordId,
    code,
    expiresAt,
    used: false,
  });

  await writeAuditLog(c, {
    entityType: "discord_link",
    action: "link_start",
    actorId: user.id,
    entityId: user.id,
    detailText: JSON.stringify({ discord_id: discordId }),
  });

  return c.json({ code, expires_at: expiresAt, user_id: user.id });
});

internalBotRoutes.post("/link/verify", async (c) => {
  const body = await parseJson(c);
  if (body instanceof Response) {
    return body;
  }

  const baseParsed = discordLinkVerifySchema.safeParse(body);
  if (!baseParsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid link verify payload", baseParsed.error.flatten());
  }

  const record = parseRecord(body);
  const discordId = parseStringField(record, "discord_id") ?? c.req.header("X-Discord-Id") ?? null;
  if (!discordId) {
    return buildError(c, "VALIDATION_ERROR", "discord_id is required");
  }

  const nowIso = new Date().toISOString();
  const db = getDb(c);
  const linkCode = (
    await db
      .select({
        id: discordLinkCodes.id,
        userId: discordLinkCodes.userId,
      })
      .from(discordLinkCodes)
      .where(
        and(
          eq(discordLinkCodes.code, baseParsed.data.code),
          eq(discordLinkCodes.discordId, discordId),
          eq(discordLinkCodes.used, false),
          sql`${discordLinkCodes.expiresAt} > ${nowIso}`,
        ),
      )
      .limit(1)
  )[0];

  if (!linkCode) {
    return buildError(c, "UNAUTHORIZED", "Invalid or expired code");
  }

  const hasProfile = (
    await db
      .select({ id: memberProfiles.id })
      .from(memberProfiles)
      .where(eq(memberProfiles.userId, linkCode.userId))
      .limit(1)
  )[0];

  if (!hasProfile) {
    await db.insert(memberProfiles).values({
      id: nanoid(),
      userId: linkCode.userId,
      power: 0,
      classes: "[]",
      images: "[]",
      videoUrls: "[]",
      discordReminderOptOut: false,
    });
  }

  await db.update(discordLinkCodes).set({ used: true }).where(eq(discordLinkCodes.id, linkCode.id));
  await db
    .update(memberProfiles)
    .set({
      discordId,
      updatedAt: nowIso,
    })
    .where(eq(memberProfiles.userId, linkCode.userId));

  await writeAuditLog(c, {
    entityType: "discord_link",
    action: "link_verify",
    actorId: linkCode.userId,
    entityId: linkCode.userId,
    detailText: JSON.stringify({ discord_id: discordId }),
  });

  return c.json({ ok: true, user_id: linkCode.userId, discord_id: discordId });
});

internalBotRoutes.patch("/tasks/:id/status", async (c) => {
  const taskId = c.req.param("id");
  const body = await parseJson(c);
  if (body instanceof Response) {
    return body;
  }

  const record = parseRecord(body);
  const status = parseStringField(record, "status");
  if (!status || !["queued", "sending", "sent", "failed"].includes(status)) {
    return buildError(c, "VALIDATION_ERROR", "status must be queued|sending|sent|failed");
  }

  const errorMessage = parseStringField(record, "error");
  const messageId = parseStringField(record, "message_id");
  const nowIso = new Date().toISOString();

  const db = getDb(c);
  const existing = (
    await db
      .select({ id: botDeliveryLog.id })
      .from(botDeliveryLog)
      .where(eq(botDeliveryLog.id, taskId))
      .limit(1)
  )[0];

  if (!existing) {
    return buildError(c, "NOT_FOUND", "Task not found");
  }

  const patch: Partial<typeof botDeliveryLog.$inferInsert> = {
    status: status as typeof botDeliveryLog.status.enumValues[number],
  };

  if (status === "sent") {
    patch.sentAt = nowIso;
    patch.lastError = null;
    patch.nextAttemptAt = null;
    if (messageId) {
      patch.messageId = messageId;
    }
  }

  if (status === "failed") {
    patch.lastError = errorMessage ?? "bot runtime delivery failure";
    patch.nextAttemptAt = new Date(Date.now() + 2 * 60_000).toISOString();
  }

  if (status === "queued" || status === "sending") {
    patch.lastError = null;
  }

  await db.update(botDeliveryLog).set(patch).where(eq(botDeliveryLog.id, taskId));

  return c.json({ ok: true });
});

internalBotRoutes.get("/events", async (c) => {
  const nowIso = new Date().toISOString();
  const endIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const env = c.env as Bindings;
  const result = await env.DB.prepare(
    `
      SELECT id, title, type, start_at, capacity
      FROM events
      WHERE archived_at IS NULL
        AND start_at >= ?1
        AND start_at <= ?2
      ORDER BY start_at ASC
      LIMIT 30
    `,
  )
    .bind(nowIso, endIso)
    .all();

  const rows = (result.results ?? []) as Array<{
    id: string;
    title: string;
    type: string;
    start_at: string;
    capacity: number | null;
  }>;

  return c.json({ data: rows });
});

internalBotRoutes.get("/roster", async (c) => {
  const env = c.env as Bindings;
  const result = await env.DB.prepare(
    `
      SELECT
        u.id AS user_id,
        u.username AS username,
        mp.wechat_name AS wechat_name,
        coalesce(mp.power, 0) AS power,
        json_extract(coalesce(mp.classes, '[]'), '$[0]') AS class_name
      FROM users u
      LEFT JOIN member_profiles mp ON mp.user_id = u.id
      WHERE u.deleted_at IS NULL
        AND u.is_active = 1
      ORDER BY coalesce(mp.power, 0) DESC, u.username ASC
      LIMIT 120
    `,
  ).all();

  const rows = (result.results ?? []) as Array<{
    user_id: string;
    username: string;
    wechat_name: string | null;
    power: number;
    class_name: string | null;
  }>;

  return c.json({ data: rows });
});

internalBotRoutes.get("/teams", async (c) => {
  const env = c.env as Bindings;
  const latestWarResult = await env.DB.prepare(
    `
      SELECT id, war_name, created_at
      FROM war_history
      ORDER BY created_at DESC
      LIMIT 1
    `,
  ).all();
  const latestWar = (latestWarResult.results?.[0] ?? null) as
    | { id: string; war_name: string; created_at: string }
    | null;

  if (!latestWar) {
    return c.json({ war: null, teams: [] });
  }

  const teamsResult = await env.DB.prepare(
    `
      SELECT id, team_name, notes, is_locked
      FROM war_teams
      WHERE war_history_id = ?1
      ORDER BY sort_order ASC, team_name ASC
    `,
  )
    .bind(latestWar.id)
    .all();
  const teams = (teamsResult.results ?? []) as Array<{
    id: string;
    team_name: string;
    notes: string | null;
    is_locked: number | boolean;
  }>;

  const enrichedTeams = await Promise.all(
    teams.map(async (team) => {
      const membersResult = await env.DB.prepare(
        `
          SELECT
            tm.user_id,
            tm.role_tag,
            u.username,
            mp.wechat_name,
            coalesce(mp.power, 0) AS power,
            mp.classes
          FROM war_team_members tm
          INNER JOIN users u ON u.id = tm.user_id
          LEFT JOIN member_profiles mp ON mp.user_id = u.id
          WHERE tm.war_team_id = ?1
          ORDER BY tm.sort_order ASC, u.username ASC
        `,
      )
        .bind(team.id)
        .all();

      const members = ((membersResult.results ?? []) as Array<{
        user_id: string;
        role_tag: string | null;
        username: string;
        wechat_name: string | null;
        power: number;
        classes: string | null;
      }>).map((member) => {
        const classes = parseJsonStringArray(member.classes);
        return {
          user_id: member.user_id,
          username: member.username,
          wechat_name: member.wechat_name,
          power: Number(member.power ?? 0),
          class_name: classes[0] ?? null,
          role_tag: member.role_tag,
        };
      });

      return {
        id: team.id,
        team_name: team.team_name,
        notes: team.notes,
        is_locked: Boolean(team.is_locked),
        members,
      };
    }),
  );

  return c.json({
    war: latestWar,
    teams: enrichedTeams,
  });
});

internalBotRoutes.get("/stats", async (c) => {
  const query = c.req.query();
  const memberName = query.member?.trim();
  const discordId = query.discord_id?.trim() ?? c.req.header("X-Discord-Id") ?? "";
  const env = c.env as Bindings;

  let target: { user_id: string; username: string } | null = null;
  if (memberName) {
    const byNameResult = await env.DB.prepare(
      `
        SELECT id AS user_id, username
        FROM users
        WHERE deleted_at IS NULL
          AND lower(username) = lower(?1)
        LIMIT 1
      `,
    )
      .bind(memberName)
      .all();
    target = (byNameResult.results?.[0] ?? null) as { user_id: string; username: string } | null;
  } else if (discordId) {
    const byDiscordResult = await env.DB.prepare(
      `
        SELECT u.id AS user_id, u.username
        FROM users u
        INNER JOIN member_profiles mp ON mp.user_id = u.id
        WHERE u.deleted_at IS NULL
          AND mp.discord_id = ?1
        LIMIT 1
      `,
    )
      .bind(discordId)
      .all();
    target = (byDiscordResult.results?.[0] ?? null) as { user_id: string; username: string } | null;
  }

  if (!target) {
    return buildError(c, "NOT_FOUND", "Target member not found");
  }

  const rowsResult = await env.DB.prepare(
    `
      SELECT
        wh.id AS war_id,
        wh.war_name,
        wh.created_at,
        tm.damage,
        tm.healing,
        tm.building_damage,
        tm.kills,
        tm.deaths,
        tm.assists,
        tm.credits
      FROM war_team_members tm
      INNER JOIN war_teams wt ON wt.id = tm.war_team_id
      INNER JOIN war_history wh ON wh.id = wt.war_history_id
      WHERE tm.user_id = ?1
      ORDER BY wh.created_at DESC
      LIMIT 5
    `,
  )
    .bind(target.user_id)
    .all();

  const wars = (rowsResult.results ?? []) as Array<{
    war_id: string;
    war_name: string;
    created_at: string;
    damage: number | null;
    healing: number | null;
    building_damage: number | null;
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    credits: number | null;
  }>;

  return c.json({
    member: target,
    wars,
  });
});

internalBotRoutes.post("/reminders", async (c) => {
  const body = await parseJson(c);
  if (body instanceof Response) {
    return body;
  }

  const record = parseRecord(body);
  const mode = parseStringField(record, "mode");
  const discordId = parseStringField(record, "discord_id") ?? c.req.header("X-Discord-Id") ?? null;
  if (!mode || (mode !== "on" && mode !== "off")) {
    return buildError(c, "VALIDATION_ERROR", "mode must be on|off");
  }
  if (!discordId) {
    return buildError(c, "VALIDATION_ERROR", "discord_id is required");
  }

  const db = getDb(c);
  const linked = (
    await db
      .select({
        userId: memberProfiles.userId,
      })
      .from(memberProfiles)
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .where(and(eq(memberProfiles.discordId, discordId), isNull(users.deletedAt)))
      .limit(1)
  )[0];

  if (!linked) {
    return buildError(c, "NOT_FOUND", "Linked member not found");
  }

  await db
    .update(memberProfiles)
    .set({
      discordReminderOptOut: mode === "off",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(memberProfiles.userId, linked.userId));

  await writeAuditLog(c, {
    entityType: "member_profile",
    action: "toggle_discord_reminder",
    actorId: linked.userId,
    entityId: linked.userId,
    detailText: JSON.stringify({ mode, source: "bot_command" }),
  });

  return c.json({ ok: true, mode });
});
