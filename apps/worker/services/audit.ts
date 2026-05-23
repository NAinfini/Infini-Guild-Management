import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { nanoid } from "nanoid";
import { auditLog } from "../db/schema";
import type { Bindings } from "../index";
import { createLogger } from "../utils/logger";
import type { AuditEntityType, AuditAction } from "@guild/shared/constants/audit";

const dbCache = new WeakMap<object, ReturnType<typeof drizzle>>();
function getDb(d1: D1Database): ReturnType<typeof drizzle> {
  let db = dbCache.get(d1);
  if (!db) {
    db = drizzle(d1);
    dbCache.set(d1, db);
  }
  return db;
}

export type WriteAuditLogInput = {
  entityType: AuditEntityType;
  action: AuditAction;
  actorId: string;
  entityId: string;
  diffTitle?: string | null;
  detailText?: string | null;
};

export async function writeAuditLog(c: Context, input: WriteAuditLogInput): Promise<void> {
  const env = c.env as Bindings;
  const db = getDb(env.DB);
  const log = createLogger(c.get("requestId") as string | undefined);
  const task = db.insert(auditLog).values({
    id: nanoid(),
    entityType: input.entityType,
    action: input.action,
    actorId: input.actorId,
    entityId: input.entityId,
    diffTitle: input.diffTitle ?? null,
    detailText: input.detailText ?? null,
  }).catch((err) => {
    log.error("writeAuditLog failed", { action: input.action, entityType: input.entityType, error: String(err) });
  });
  c.executionCtx.waitUntil(task);
}

export async function writeAuditLogDurable(c: Context, input: WriteAuditLogInput): Promise<void> {
  const env = c.env as Bindings;
  const db = getDb(env.DB);
  await db.insert(auditLog).values({
    id: nanoid(),
    entityType: input.entityType,
    action: input.action,
    actorId: input.actorId,
    entityId: input.entityId,
    diffTitle: input.diffTitle ?? null,
    detailText: input.detailText ?? null,
  });
}
