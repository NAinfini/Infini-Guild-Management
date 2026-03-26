import {
  ERROR_STATUS,
  discordLinkStartSchema,
  discordLinkVerifySchema,
  type ErrorCode,
  type StandardErrorResponse,
} from "@guild/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { writeAuditLog } from "../services/audit";
import { publishEntityChanged } from "../services/push";
import { InternalBotService } from "../services/InternalBotService";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

export const internalBotRoutes = new Hono();

function getDb(c: Context) {
  const env = c.env as Bindings;
  return drizzle(env.DB);
}

function getService(c: Context): InternalBotService {
  const env = c.env as Bindings;
  return new InternalBotService(getDb(c), {
    d1: env.DB,
    writeAuditLog: (input) => writeAuditLog(c, input),
    publishEntityChanged: (msg) => publishEntityChanged(env, msg),
  });
}

function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = { error_code: code, message, request_id: requestId, ...(details ? { details } : {}) };
  return c.json(body, ERROR_STATUS[code] as ErrorStatusCode);
}

function handleResult(c: Context, result: { ok: true; data: unknown } | { ok: false; code: ErrorCode; message: string; details?: unknown }, status?: number): Response {
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, status as never);
}

function parseRecord(body: unknown): Record<string, unknown> {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) return body as Record<string, unknown>;
  return {};
}

function parseStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function parseJson(c: Context): Promise<unknown | Response> {
  try { return await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
}

// --- Routes ---

internalBotRoutes.post("/signup", async (c) => {
  const body = await parseJson(c);
  if (body instanceof Response) return body;
  const record = parseRecord(body);
  const eventId = parseStringField(record, "event_id");
  if (!eventId) return buildError(c, "VALIDATION_ERROR", "event_id is required");
  const result = await getService(c).signup(eventId, parseStringField(record, "user_id") ?? undefined, parseStringField(record, "discord_id") ?? undefined, parseStringField(record, "source") ?? "discord");
  return handleResult(c, result);
});

internalBotRoutes.post("/leave", async (c) => {
  const body = await parseJson(c);
  if (body instanceof Response) return body;
  const record = parseRecord(body);
  const eventId = parseStringField(record, "event_id");
  if (!eventId) return buildError(c, "VALIDATION_ERROR", "event_id is required");
  const result = await getService(c).leave(eventId, parseStringField(record, "user_id") ?? undefined, parseStringField(record, "discord_id") ?? undefined, parseStringField(record, "source") ?? "discord");
  return handleResult(c, result);
});

internalBotRoutes.post("/link/start", async (c) => {
  const body = await parseJson(c);
  if (body instanceof Response) return body;
  const baseParsed = discordLinkStartSchema.safeParse(body);
  if (!baseParsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid link start payload", baseParsed.error.flatten());
  const record = parseRecord(body);
  const discordId = parseStringField(record, "discord_id") ?? c.req.header("X-Discord-Id") ?? null;
  if (!discordId) return buildError(c, "VALIDATION_ERROR", "discord_id is required");
  const result = await getService(c).linkStart(baseParsed.data.username, discordId);
  return handleResult(c, result);
});

internalBotRoutes.post("/link/verify", async (c) => {
  const body = await parseJson(c);
  if (body instanceof Response) return body;
  const baseParsed = discordLinkVerifySchema.safeParse(body);
  if (!baseParsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid link verify payload", baseParsed.error.flatten());
  const record = parseRecord(body);
  const discordId = parseStringField(record, "discord_id") ?? c.req.header("X-Discord-Id") ?? null;
  if (!discordId) return buildError(c, "VALIDATION_ERROR", "discord_id is required");
  const result = await getService(c).linkVerify(baseParsed.data.code, discordId);
  return handleResult(c, result);
});

internalBotRoutes.patch("/tasks/:id/status", async (c) => {
  const body = await parseJson(c);
  if (body instanceof Response) return body;
  const record = parseRecord(body);
  const status = parseStringField(record, "status");
  if (!status || !["queued", "sending", "sent", "failed"].includes(status)) return buildError(c, "VALIDATION_ERROR", "status must be queued|sending|sent|failed");
  const result = await getService(c).updateTaskStatus(c.req.param("id"), status, parseStringField(record, "error") ?? undefined, parseStringField(record, "message_id") ?? undefined);
  return handleResult(c, result);
});

internalBotRoutes.get("/events", async (c) => {
  const result = await getService(c).getUpcomingEvents();
  if (!result.ok) return buildError(c, result.code, result.message);
  return c.json({ data: result.data });
});

internalBotRoutes.get("/roster", async (c) => {
  const result = await getService(c).getRoster();
  if (!result.ok) return buildError(c, result.code, result.message);
  return c.json({ data: result.data });
});

internalBotRoutes.get("/teams", async (c) => {
  const result = await getService(c).getLatestWarWithTeams();
  return handleResult(c, result);
});

internalBotRoutes.get("/stats", async (c) => {
  const memberName = c.req.query("member")?.trim();
  const discordId = c.req.query("discord_id")?.trim() ?? c.req.header("X-Discord-Id") ?? "";
  const result = await getService(c).getMemberStats(memberName || undefined, discordId || undefined);
  return handleResult(c, result);
});

internalBotRoutes.post("/reminders", async (c) => {
  const body = await parseJson(c);
  if (body instanceof Response) return body;
  const record = parseRecord(body);
  const mode = parseStringField(record, "mode");
  const discordId = parseStringField(record, "discord_id") ?? c.req.header("X-Discord-Id") ?? null;
  if (!mode || (mode !== "on" && mode !== "off")) return buildError(c, "VALIDATION_ERROR", "mode must be on|off");
  if (!discordId) return buildError(c, "VALIDATION_ERROR", "discord_id is required");
  const result = await getService(c).toggleReminder(discordId, mode);
  return handleResult(c, result);
});
