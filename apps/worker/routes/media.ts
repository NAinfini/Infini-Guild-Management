import { Hono } from "hono";
import type { Bindings } from "../index";
import { getRequestUser } from "../middleware/rbac";
import { MediaService } from "../services/MediaService";
import { MEDIA_VARIANTS, type MediaVariant } from "../services/media-keys";
import { buildError, serveR2Object } from "./_shared";

export const mediaRoutes = new Hono<{ Bindings: Bindings }>();

mediaRoutes.get("/:mediaId/:variant", async (c) => {
  const variantValue = c.req.param("variant");
  if (!(MEDIA_VARIANTS as readonly string[]).includes(variantValue)) {
    return buildError(c, "NOT_FOUND", "Media not found");
  }

  const resolved = await new MediaService(c.env.DB, c.env.MEDIA).resolveReadableVariant({
    mediaId: c.req.param("mediaId"),
    variant: variantValue as MediaVariant,
    session: await getRequestUser(c),
    now: new Date().toISOString(),
  });
  if (!resolved) return buildError(c, "NOT_FOUND", "Media not found");
  return serveR2Object(c, resolved.r2Key, "Media not found", resolved.contentType);
});
