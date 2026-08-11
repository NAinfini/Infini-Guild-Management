import type { AdminStatusService } from "@guild/server/modules/portal-read-models";
import { Hono } from "hono";
import { requestContext, type HttpEnv } from "../../core/http-env.js";
import { presentAdminStatus } from "../../presenters/portal-read-models/portal-read-models-presenter.js";

type AdminStatusHttpService = Pick<AdminStatusService, "status">;

export function createAdminStatusRoutes(dependencies: Readonly<{ service: AdminStatusHttpService }>): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();
  routes.get("/", async (context) => context.json(presentAdminStatus(
    await dependencies.service.status(requestContext(context)),
  )));
  return routes;
}
