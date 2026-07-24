import { Hono } from "hono";
import { SearchService } from "../services/SearchService";
import { getDb, handleResult } from "./_shared";
import { getFeatureFlags } from "./service-factory";

export const searchRoutes = new Hono();

searchRoutes.get("/", async (c) => {
  // Public global search only indexes guest-visible content; private tools,
  // profile edits, storage, mod, and admin actions are not exposed here.
  const service = new SearchService(getDb(c));
  const result = await service.search({
    query: c.req.query("q"),
    limit: c.req.query("limit"),
    features: await getFeatureFlags(c),
  });
  return handleResult(c, result);
});
