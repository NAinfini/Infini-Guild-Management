import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { SiteConfigService } from "../services/SiteConfigService";
import { writeAuditLog } from "../services/audit";
import { getDb, handleResult } from "./_shared";
import { withMedia } from "./service-factory";

export const siteConfigRoutes = new Hono();

export function getSiteConfigService(c: Context) {
  const env = c.env as Bindings;
  return new SiteConfigService(getDb(c), {
    mediaService: withMedia(c).mediaService,
    writeAuditLog: (input) => writeAuditLog(c, input),
    envSiteLogoUrl: env.SITE_LOGO_URL,
  });
}

siteConfigRoutes.get("/", async (c) => {
  return handleResult(c, await getSiteConfigService(c).getPublicConfig());
});
