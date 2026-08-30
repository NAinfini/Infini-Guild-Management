import type { SiteConfigService } from "@guild/server/modules/site-config";
import {
  adminSiteConfigResponseSchema,
  analyticsSettingsSchema,
  publicSiteConfigSchema,
  siteConfigRevisionTokenSchema,
  siteAnalyticsSettingsSchema,
  updateSiteConfigSchema,
} from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { Hono } from "hono";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { parseFormData, parseImageUploads, parseJsonBody, validation } from "../../core/parsing.js";

type PublicSiteConfigHttpService = Pick<SiteConfigService, "getPublic">;
type AdminSiteConfigHttpService = Pick<SiteConfigService, "getAdmin" | "update" | "uploadLogo">;
type AdminAnalyticsSettingsHttpService = Pick<
  SiteConfigService,
  "getAnalyticsSettings" | "updateAnalyticsSettings"
>;

export function createPublicSiteConfigRoutes(
  dependencies: Readonly<{ service: PublicSiteConfigHttpService }>,
): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();
  routes.get("/", async (context) => context.json(
    publicSiteConfigSchema.parse(await dependencies.service.getPublic()),
  ));
  return routes;
}

export function createAdminSiteConfigRoutes(
  dependencies: Readonly<{ service: AdminSiteConfigHttpService }>,
): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/", async (context) => context.json(adminSiteConfigResponseSchema.parse(
    await dependencies.service.getAdmin(requestContext(context)),
  )));

  routes.patch("/", async (context) => context.json(adminSiteConfigResponseSchema.parse(
    await dependencies.service.update(
      requestContext(context),
      await parseJsonBody(context.req.raw, updateSiteConfigSchema, "Invalid site configuration"),
    ),
  )));

  routes.post("/logo", async (context) => {
    const request = requestContext(context);
    request.authorization.require(PERMISSION_ID.ADMIN_SITE_CONFIG_MANAGE);
    const form = await parseFormData(context.req.raw);
    const expectedRevision = siteConfigRevisionTokenSchema.safeParse(form.get("expected_revision_token"));
    if (!expectedRevision.success) throw validation("Invalid site configuration revision");
    const uploads = await parseImageUploads(form);
    if (uploads.length !== 1) throw validation("Exactly one logo is required");
    return context.json(adminSiteConfigResponseSchema.parse(
      await dependencies.service.uploadLogo(request, uploads[0]!, expectedRevision.data),
    ));
  });

  return routes;
}

export function createAdminAnalyticsSettingsRoutes(
  dependencies: Readonly<{ service: AdminAnalyticsSettingsHttpService }>,
): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();
  routes.get("/", async (context) => context.json(siteAnalyticsSettingsSchema.parse(
    await dependencies.service.getAnalyticsSettings(requestContext(context)),
  )));
  routes.patch("/", async (context) => context.json(siteAnalyticsSettingsSchema.parse(
    await dependencies.service.updateAnalyticsSettings(
      requestContext(context),
      await parseJsonBody(context.req.raw, analyticsSettingsSchema, "Invalid analytics settings"),
    ),
  )));
  return routes;
}
