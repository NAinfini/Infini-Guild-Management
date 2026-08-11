import type { PortalReadModelService } from "@guild/server/modules/portal-read-models";
import { Hono } from "hono";
import { z } from "zod";
import { requestContext, type HttpEnv } from "../../core/http-env.js";
import { parseQuery } from "../../core/parsing.js";
import {
  presentDashboardEvents,
  presentDashboardMembers,
  presentDashboardWars,
} from "../../presenters/portal-read-models/portal-read-models-presenter.js";

const projectionQuerySchema = z.object({
  external_view: z.enum(["true", "false"]).optional(),
}).strict();

type DashboardHttpService = Pick<PortalReadModelService,
  "dashboardMembers" | "dashboardEvents" | "dashboardWars"
>;

export function createDashboardRoutes(dependencies: Readonly<{ service: DashboardHttpService }>): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/members", async (context) => context.json(presentDashboardMembers(
    await dependencies.service.dashboardMembers(requestContext(context)),
  )));

  routes.get("/events", async (context) => {
    const request = requestContext(context);
    const query = parseQuery(context.req.raw, projectionQuerySchema);
    return context.json(presentDashboardEvents(
      await dependencies.service.dashboardEvents(request, query.external_view === "true"),
    ));
  });

  routes.get("/wars", async (context) => {
    const request = requestContext(context);
    const query = parseQuery(context.req.raw, projectionQuerySchema);
    return context.json(presentDashboardWars(
      await dependencies.service.dashboardWars(request, query.external_view === "true"),
    ));
  });

  return routes;
}
