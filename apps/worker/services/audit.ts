import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { nanoid } from "nanoid";
import { auditLog } from "../db/schema";
import type { Bindings } from "../index";

type WriteAuditLogInput = {
  entityType: string;
  action: string;
  actorId: string;
  entityId: string;
  diffTitle?: string | null;
  detailText?: string | null;
};

export async function writeAuditLog(c: Context, input: WriteAuditLogInput): Promise<void> {
  const env = c.env as Bindings;
  const db = drizzle(env.DB);
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
