import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { SiteConfigService } from "../services/SiteConfigService";
import { writeAuditLog } from "../services/audit";
import { deleteMediaObject, storeSiteLogo } from "../services/media";
import { buildError, getDb, handleResult, serveR2Object } from "./_shared";

export const siteConfigRoutes = new Hono();

export function getSiteConfigService(c: Context) {
  const env = c.env as Bindings;
  return new SiteConfigService(getDb(c), {
    writeAuditLog: (input) => writeAuditLog(c, input),
    storeSiteLogo: (file) => storeSiteLogo(c, file),
    deleteMediaObject: (key) => deleteMediaObject(c, key),
    envSiteName: env.SITE_NAME,
    envSiteLogoUrl: env.SITE_LOGO_URL,
  });
}

siteConfigRoutes.get("/", async (c) => {
  return handleResult(c, await getSiteConfigService(c).getPublicConfig());
});

siteConfigRoutes.get("/logo", async (c) => {
  const key = c.req.query("key");
  if (!key) return buildError(c, "VALIDATION_ERROR", "key query parameter required");
  if (!key.startsWith("site/logo/")) return buildError(c, "FORBIDDEN", "Invalid site logo key");
  return serveR2Object(c, key, "Site logo not found");
});
