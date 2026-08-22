import type { PortalReadModelService } from "@guild/server/modules/portal-read-models";
import { LIMITS } from "@guild/shared/config/limits";
import { Hono } from "hono";
import { z } from "zod";
import { requestContext, type HttpEnv } from "../../core/http-env.js";
import { parseQuery } from "../../core/parsing.js";
import { presentSearch } from "../../presenters/portal-read-models/portal-read-models-presenter.js";

const searchQuerySchema = z.object({
  q: z.string().max(80).default(""),
  limit: z.coerce.number().int().min(1).max(LIMITS.pagination.search).default(24),
}).strict();

type SearchHttpService = Pick<PortalReadModelService, "search">;

export function createSearchRoutes(dependencies: Readonly<{ service: SearchHttpService }>): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();
  routes.get("/", async (context) => {
    const query = parseQuery(context.req.raw, searchQuerySchema);
    return context.json(presentSearch(await dependencies.service.search(
      requestContext(context),
      query.q,
      query.limit,
    )));
  });
  return routes;
}
