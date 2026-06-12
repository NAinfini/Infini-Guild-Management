import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { nanoid } from "nanoid";
import { auditLog } from "../db/schema";
import type { Bindings } from "../index";
import { createLogger } from "../utils/logger";
import type { AuditEntityType, AuditAction } from "@guild/shared/constants/audit";

const dbCache = new WeakMap<object, ReturnType<typeof drizzle>>();
const SYSTEM_TEST_HEADER = "X-System-Test";
const SYSTEM_TEST_AUDIT_HEADER = "X-System-Test-Audit";
const SYSTEM_TEST_HEADER_VALUE = "admin-console-api";

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

function shouldSuppressSystemTestAudit(c: Context): boolean {
  return c.req.header(SYSTEM_TEST_HEADER) === SYSTEM_TEST_HEADER_VALUE
    && c.req.header(SYSTEM_TEST_AUDIT_HEADER) === "suppress";
}

export async function writeAuditLog(c: Context, input: WriteAuditLogInput): Promise<void> {
  if (shouldSuppressSystemTestAudit(c)) {
    return;
  }
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
  if (shouldSuppressSystemTestAudit(c)) {
    return;
  }
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
