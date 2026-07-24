import { updateMemberOnboardingSchema } from "@guild/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { SiteConfigService } from "../services/SiteConfigService";
import { writeAuditLog } from "../services/audit";
import { deleteMediaObject, storeSiteLogo } from "../services/media";
import { buildError, getDb, handleResult, parseJsonBody, requireSessionUser, serveR2Object } from "./_shared";

export const siteConfigRoutes = new Hono();
export const onboardingRoutes = new Hono();

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

onboardingRoutes.get("/", async (c) => {
  const sessionUser = await requireSessionUser(c);
  return handleResult(c, await getSiteConfigService(c).getMemberOnboarding(sessionUser.id));
});

onboardingRoutes.patch("/me", async (c) => {
  const sessionUser = await requireSessionUser(c);
  const parsed = updateMemberOnboardingSchema.safeParse(await parseJsonBody(c));
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid onboarding progress payload", parsed.error.flatten());
  return handleResult(c, await getSiteConfigService(c).updateMemberProgress(sessionUser.id, parsed.data));
});

onboardingRoutes.post("/acknowledge", async (c) => {
  const sessionUser = await requireSessionUser(c);
  return handleResult(c, await getSiteConfigService(c).acknowledgeOnboarding(sessionUser.id));
});
