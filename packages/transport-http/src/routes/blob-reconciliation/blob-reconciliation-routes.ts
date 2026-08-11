import type {
  BlobReconciliationCheckpoint,
  BlobReconciliationService,
} from "@guild/server/modules/blob-reconciliation";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { Hono } from "hono";
import { z } from "zod";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { parseQuery } from "../../core/parsing.js";
import { presentBlobReconciliationPage } from "../../presenters/blob-reconciliation/blob-reconciliation-presenter.js";

const querySchema = z.object({
  phase: z.enum(["manifest", "inventory"]).default("manifest"),
  prefix: z.enum(["media/", "audit/"]).optional(),
  checkpoint: z.string().min(1).max(4_096).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
}).strict().superRefine((value, context) => {
  if (value.phase === "inventory" && value.prefix === undefined) {
    context.addIssue({ code: "custom", message: "Inventory prefix is required", path: ["prefix"] });
  }
  if (value.phase === "manifest" && value.prefix !== undefined) {
    context.addIssue({ code: "custom", message: "Manifest scans do not accept a prefix", path: ["prefix"] });
  }
});

type BlobReconciliationHttpService = Pick<BlobReconciliationService, "scanPage">;

export function createBlobReconciliationRoutes(
  dependencies: Readonly<{ service: BlobReconciliationHttpService }>,
): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();
  routes.get("/blob-reconciliation", async (context) => {
    const request = requestContext(context);
    requireReadPermission(request);
    const query = parseQuery(context.req.raw, querySchema, "Invalid blob reconciliation query");
    return context.json(presentBlobReconciliationPage(await dependencies.service.scanPage({
      now: request.now,
      limit: query.limit,
      checkpoint: reconciliationCheckpoint(query),
    })));
  });
  return routes;
}

function reconciliationCheckpoint(query: z.output<typeof querySchema>): BlobReconciliationCheckpoint {
  if (query.phase === "manifest") {
    return { phase: "manifest", ...(query.checkpoint ? { checkpoint: query.checkpoint } : {}) };
  }
  return {
    phase: "inventory",
    prefix: query.prefix!,
    ...(query.checkpoint ? { checkpoint: query.checkpoint } : {}),
  };
}

function requireReadPermission(context: ReturnType<typeof requestContext>): void {
  context.authorization.requireAuthenticated();
  if (
    !context.authorization.has(PERMISSION_ID.ADMIN_STATUS_VIEW)
    && !context.authorization.has(PERMISSION_ID.ADMIN_AUDIT_EXPORT)
  ) {
    context.authorization.require(PERMISSION_ID.ADMIN_STATUS_VIEW);
  }
}
