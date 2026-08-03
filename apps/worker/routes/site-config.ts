import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { SiteConfigService, siteLogoKeyFromUrl } from "../services/SiteConfigService";
import { parseMediaKey } from "../services/media-keys";
import { writeAuditLog } from "../services/audit";
import { deleteMediaObject, storeSiteLogo } from "../services/media";
import { buildError, getDb, handleResult, serveR2Object } from "./_shared";

export const siteConfigRoutes = new Hono();

export function getSiteConfigService(c: Context) {
  const env = c.env as Bindings;
  return new SiteConfigService(getDb(c), {
    rawDb: env.DB,
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
  if (parseMediaKey(key)?.kind !== "site_logo") return buildError(c, "FORBIDDEN", "Invalid site logo key");
  const config = await getSiteConfigService(c).getPublicConfig();
  if (!config.ok) return handleResult(c, config);
  if (siteLogoKeyFromUrl(config.data.site_logo_url) !== key) {
    return buildError(c, "NOT_FOUND", "Site logo not found");
  }
  return serveR2Object(c, key, "Site logo not found");
});
