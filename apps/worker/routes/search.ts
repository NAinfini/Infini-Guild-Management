import { Hono } from "hono";
import { SearchService } from "../services/SearchService";
import { getDb, handleResult, requireSessionUser } from "./_shared";

export const searchRoutes = new Hono();

searchRoutes.get("/", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;

  const service = new SearchService(getDb(c));
  const result = await service.search({
    query: c.req.query("q"),
    limit: c.req.query("limit"),
  });
  return handleResult(c, result);
});
