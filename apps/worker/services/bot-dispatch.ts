import { botTaskSchema, type BotTask } from "@guild/shared";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { botDeliveryLog, botDiscordEventMessages, botWechatEventMessages } from "../db/schema";
import type { Bindings } from "../index";

type BotPlatform = "discord" | "wechat";
type BotTaskType = "event_notify" | "team_comp" | "reminder" | "war_result";
type DeliveryStatus = "queued" | "sending" | "sent" | "failed";

type QueueBotTaskInput = {
  platform: BotPlatform;
  taskType: BotTaskType;
  targetId: string;
  payload: Record<string, unknown>;
  eventId?: string | null;
  idempotencyKey?: string;
  dispatchNow?: boolean;
};

type DeliveryRow = {
  id: string;
  idempotencyKey: string;
  platform: string;
  taskType: string;
  eventId: string | null;
  targetId: string;
  payloadJson: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  sentAt: string | null;
  messageId: string | null;
};

export type DiscordRuntimeChannel = {
  id: string;
  name: string;
  type: string;
};

const MAX_ATTEMPTS = 4;

function getDb(env: Bindings) {
  return drizzle(env.DB);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(signature);
}

function computeBackoffMs(attempt: number): number {
  const schedule = [5_000, 30_000, 120_000] as const;
  const index = Math.min(Math.max(1, attempt) - 1, schedule.length - 1);
  return schedule[index];
}

function coercePlatform(value: string): BotPlatform {
  return value === "wechat" ? "wechat" : "discord";
}

function coerceTaskType(value: string): BotTaskType {
  if (value === "team_comp" || value === "reminder" || value === "war_result") {
    return value;
  }
  return "event_notify";
}

function buildGetSignaturePayload(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return `GET:${pathname}${query ? `?${query}` : ""}`;
}

function toBotTask(row: DeliveryRow, attemptOverride?: number): BotTask {
  const target: Record<string, string> = { id: row.targetId };
  if (row.eventId) {
    target.event_id = row.eventId;
  }

  return botTaskSchema.parse({
    task_id: row.id,
    idempotency_key: row.idempotencyKey,
    platform: coercePlatform(row.platform),
    task_type: coerceTaskType(row.taskType),
    target,
    payload: parsePayload(row.payloadJson),
    attempt: attemptOverride ?? Math.max(1, row.attemptCount),
    created_at: row.createdAt,
  });
}

async function getDeliveryById(env: Bindings, taskId: string): Promise<DeliveryRow | null> {
  const db = getDb(env);
  const row = (
    await db
      .select({
        id: botDeliveryLog.id,
        idempotencyKey: botDeliveryLog.idempotencyKey,
        platform: botDeliveryLog.platform,
        taskType: botDeliveryLog.taskType,
        eventId: botDeliveryLog.eventId,
        targetId: botDeliveryLog.targetId,
        payloadJson: botDeliveryLog.payloadJson,
        status: botDeliveryLog.status,
        attemptCount: botDeliveryLog.attemptCount,
        lastError: botDeliveryLog.lastError,
        nextAttemptAt: botDeliveryLog.nextAttemptAt,
        createdAt: botDeliveryLog.createdAt,
        sentAt: botDeliveryLog.sentAt,
        messageId: botDeliveryLog.messageId,
      })
      .from(botDeliveryLog)
      .where(eq(botDeliveryLog.id, taskId))
      .limit(1)
  )[0];

  return row ?? null;
}

async function getDeliveryByIdempotencyKey(env: Bindings, idempotencyKey: string): Promise<DeliveryRow | null> {
  const db = getDb(env);
  const row = (
    await db
      .select({
        id: botDeliveryLog.id,
        idempotencyKey: botDeliveryLog.idempotencyKey,
        platform: botDeliveryLog.platform,
        taskType: botDeliveryLog.taskType,
        eventId: botDeliveryLog.eventId,
        targetId: botDeliveryLog.targetId,
        payloadJson: botDeliveryLog.payloadJson,
        status: botDeliveryLog.status,
        attemptCount: botDeliveryLog.attemptCount,
        lastError: botDeliveryLog.lastError,
        nextAttemptAt: botDeliveryLog.nextAttemptAt,
        createdAt: botDeliveryLog.createdAt,
        sentAt: botDeliveryLog.sentAt,
        messageId: botDeliveryLog.messageId,
      })
      .from(botDeliveryLog)
      .where(eq(botDeliveryLog.idempotencyKey, idempotencyKey))
      .limit(1)
  )[0];

  return row ?? null;
}

async function postTaskToBotRuntime(env: Bindings, task: BotTask): Promise<{ messageId: string | null }> {
  const runtimeUrl = env.BOT_RUNTIME_URL?.trim();
  const sharedSecret = env.BOT_SHARED_SECRET?.trim();

  if (!runtimeUrl) {
    throw new Error("BOT_RUNTIME_URL is not configured");
  }
  if (!sharedSecret) {
    throw new Error("BOT_SHARED_SECRET is not configured");
  }

  const normalizedRuntimeUrl = runtimeUrl.replace(/\/+$/, "");
  const body = JSON.stringify(task);
  const timestamp = Date.now().toString();
  const signature = await hmacSha256Hex(sharedSecret, `${timestamp}.${body}`);

  const response = await fetch(`${normalizedRuntimeUrl}/internal/bot/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Timestamp": timestamp,
      "X-Signature": signature,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Bot Runtime rejected task: ${response.status}`);
  }

  try {
    const payload = (await response.json()) as { message_id?: unknown };
    return {
      messageId: typeof payload.message_id === "string" ? payload.message_id : null,
    };
  } catch {
    return { messageId: null };
  }
}

export async function fetchDiscordChannelsFromBotRuntime(
  env: Bindings,
  guildId: string,
): Promise<DiscordRuntimeChannel[]> {
  const runtimeUrl = env.BOT_RUNTIME_URL?.trim();
  const sharedSecret = env.BOT_SHARED_SECRET?.trim();
  const normalizedGuildId = guildId.trim();

  if (!runtimeUrl) {
    throw new Error("BOT_RUNTIME_URL is not configured");
  }
  if (!sharedSecret) {
    throw new Error("BOT_SHARED_SECRET is not configured");
  }
  if (!normalizedGuildId) {
    throw new Error("Discord guild_id is required");
  }

  const normalizedRuntimeUrl = runtimeUrl.replace(/\/+$/, "");
  const path = "/internal/bot/discord/channels";
  const params = new URLSearchParams({ guild_id: normalizedGuildId });
  const timestamp = Date.now().toString();
  const signaturePayload = buildGetSignaturePayload(path, params);
  const signature = await hmacSha256Hex(sharedSecret, `${timestamp}.${signaturePayload}`);

  const response = await fetch(`${normalizedRuntimeUrl}${path}?${params.toString()}`, {
    method: "GET",
    headers: {
      "X-Timestamp": timestamp,
      "X-Signature": signature,
    },
  });

  if (!response.ok) {
    throw new Error(`Bot Runtime channel list failed: ${response.status}`);
  }

  const payload = (await response.json()) as { channels?: unknown };
  if (!Array.isArray(payload.channels)) {
    throw new Error("Bot Runtime returned invalid channel payload");
  }

  const channels: DiscordRuntimeChannel[] = [];
  for (const channel of payload.channels) {
    if (!channel || typeof channel !== "object") {
      throw new Error("Bot Runtime returned invalid channel record");
    }
    const record = channel as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      typeof record.type !== "string"
    ) {
      throw new Error("Bot Runtime returned invalid channel fields");
    }
    channels.push({
      id: record.id,
      name: record.name,
      type: record.type,
    });
  }

  return channels;
}

export async function createBotTask(env: Bindings, input: QueueBotTaskInput): Promise<BotTask> {
  const db = getDb(env);
  const idempotencyKey =
    input.idempotencyKey ??
    `${input.taskType}:${input.platform}:${input.targetId}:${input.eventId ?? "none"}:${Date.now()}:${nanoid(6)}`;
  const taskId = nanoid();

  try {
    await db.insert(botDeliveryLog).values({
      id: taskId,
      idempotencyKey,
      platform: input.platform,
      taskType: input.taskType,
      eventId: input.eventId ?? null,
      targetId: input.targetId,
      payloadJson: JSON.stringify(input.payload),
      status: "queued",
      attemptCount: 0,
      lastError: null,
      nextAttemptAt: nowIso(),
      sentAt: null,
      messageId: null,
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  const row = await getDeliveryByIdempotencyKey(env, idempotencyKey);
  if (!row) {
    throw new Error("Failed to enqueue bot task");
  }

  if (input.dispatchNow !== false) {
    await dispatchBotTask(env, row.id);
  }

  const refreshed = (await getDeliveryById(env, row.id)) ?? row;
  return toBotTask(refreshed);
}

export async function dispatchBotTask(env: Bindings, taskId: string): Promise<void> {
  const db = getDb(env);
  const row = await getDeliveryById(env, taskId);
  if (!row) {
    return;
  }

  if (row.status === "sent") {
    return;
  }

  if (row.attemptCount >= MAX_ATTEMPTS) {
    return;
  }

  const attempt = row.attemptCount + 1;
  const sendingAt = nowIso();
  await db
    .update(botDeliveryLog)
    .set({
      status: "sending" satisfies DeliveryStatus,
      attemptCount: attempt,
      nextAttemptAt: null,
      lastError: null,
    })
    .where(eq(botDeliveryLog.id, taskId));

  const sendingRow = (await getDeliveryById(env, taskId)) ?? {
    ...row,
    attemptCount: attempt,
    status: "sending",
    nextAttemptAt: null,
    lastError: null,
  };

  try {
    const task = toBotTask(sendingRow, attempt);
    const runtimeResult = await postTaskToBotRuntime(env, task);
    if (
      sendingRow.platform === "discord" &&
      sendingRow.taskType === "event_notify" &&
      sendingRow.eventId &&
      runtimeResult.messageId
    ) {
      try {
        await db.insert(botDiscordEventMessages).values({
          id: nanoid(),
          eventId: sendingRow.eventId,
          channelId: sendingRow.targetId,
          messageId: runtimeResult.messageId,
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
        await db
          .update(botDiscordEventMessages)
          .set({
            messageId: runtimeResult.messageId,
            createdAt: sendingAt,
          })
          .where(
            and(
              eq(botDiscordEventMessages.eventId, sendingRow.eventId),
              eq(botDiscordEventMessages.channelId, sendingRow.targetId),
            ),
          );
      }
    }

    if (
      sendingRow.platform === "wechat" &&
      sendingRow.taskType === "event_notify" &&
      sendingRow.eventId &&
      runtimeResult.messageId
    ) {
      try {
        await db.insert(botWechatEventMessages).values({
          id: nanoid(),
          eventId: sendingRow.eventId,
          roomId: sendingRow.targetId,
          messageId: runtimeResult.messageId,
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
        await db
          .update(botWechatEventMessages)
          .set({
            messageId: runtimeResult.messageId,
            createdAt: sendingAt,
          })
          .where(
            and(
              eq(botWechatEventMessages.eventId, sendingRow.eventId),
              eq(botWechatEventMessages.roomId, sendingRow.targetId),
            ),
          );
      }
    }

    await db
      .update(botDeliveryLog)
      .set({
        status: "sent" satisfies DeliveryStatus,
        sentAt: sendingAt,
        messageId: runtimeResult.messageId,
        lastError: null,
        nextAttemptAt: null,
      })
      .where(eq(botDeliveryLog.id, taskId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown bot dispatch failure";
    const retryAt = new Date(Date.now() + computeBackoffMs(attempt)).toISOString();

    await db
      .update(botDeliveryLog)
      .set({
        status: "failed" satisfies DeliveryStatus,
        lastError: message,
        nextAttemptAt: attempt >= MAX_ATTEMPTS ? null : retryAt,
      })
      .where(eq(botDeliveryLog.id, taskId));
  }
}

export async function retryDueBotTasks(
  env: Bindings,
  options: { limit?: number } = {},
): Promise<{ attempted: number; sent: number; failed: number }> {
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const db = getDb(env);
  const now = nowIso();

  const dueRows = await db
    .select({
      id: botDeliveryLog.id,
      status: botDeliveryLog.status,
    })
    .from(botDeliveryLog)
    .where(
      and(
        or(eq(botDeliveryLog.status, "queued"), eq(botDeliveryLog.status, "failed")),
        or(isNull(botDeliveryLog.nextAttemptAt), lte(botDeliveryLog.nextAttemptAt, now)),
      ),
    )
    .orderBy(asc(botDeliveryLog.createdAt), asc(botDeliveryLog.id))
    .limit(limit);

  let attempted = 0;
  let sent = 0;
  let failed = 0;

  for (const row of dueRows) {
    attempted += 1;
    await dispatchBotTask(env, row.id);
    const refreshed = await getDeliveryById(env, row.id);
    if (refreshed?.status === "sent") {
      sent += 1;
    } else if (refreshed?.status === "failed") {
      failed += 1;
    }
  }

  return { attempted, sent, failed };
}
