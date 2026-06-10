import { Hono } from "hono";
import type { Bindings } from "../index";
import { runMediaOrphanCleanupCron } from "../crons/media-orphan-cleanup";
import { requirePermission } from "../middleware/rbac";
import { writeAuditLogDurable } from "../services/audit";

// Manual maintenance triggers — intentionally not on a cron schedule.
export const adminMaintenanceRoutes = new Hono();

// Deletes orphaned R2 media and purges soft-deleted users' media; gated by the
// top-level admin permission and recorded durably in the audit log.
adminMaintenanceRoutes.post("/media-orphan-cleanup", async (c) => {
  const sessionUser = await requirePermission(c, "admin.roles.manage");
  const summary = await runMediaOrphanCleanupCron(c.env as Bindings);
  await writeAuditLogDurable(c, {
    entityType: "media_cleanup",
    action: "run",
    actorId: sessionUser.id,
    entityId: "media-orphan-cleanup",
    detailText: JSON.stringify(summary),
  });
  return c.json(summary);
});
