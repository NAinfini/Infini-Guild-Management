import type { AdminOperationsService } from "@guild/server/modules/admin-operations";
import { Hono } from "hono";
import { requestContext, type HttpEnv } from "../../core/http-env.js";
import { presentAdminOperations } from "../../presenters/admin-operations/admin-operations-presenter.js";

type AdminOperationsHttpService = Pick<AdminOperationsService, "read">;

export function createAdminOperationsRoutes(
  dependencies: Readonly<{ service: AdminOperationsHttpService }>,
): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();
  routes.get("/", async (context) => context.json(presentAdminOperations(
    await dependencies.service.read(requestContext(context)),
  )));
  return routes;
}
