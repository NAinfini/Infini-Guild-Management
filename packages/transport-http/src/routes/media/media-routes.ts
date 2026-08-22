import { AppError, type BlobMetadata, type BlobRange, type BlobRead } from "@guild/kernel";
import { MediaRangeError, type MediaHeadResult, type MediaService } from "@guild/server/modules/media";
import { mediaVariantSchema, type MediaVariant } from "@guild/shared";
import { Hono } from "hono";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { HttpRangeError } from "../../core/http-range-error.js";
import { parseRange, type RequestedByteRange } from "../../core/range.js";
import { presentMedia } from "../../presenters/media/media-presenter.js";

type MediaHttpService = Pick<MediaService, "head" | "read">;

export type MediaRouteDependencies = Readonly<{
  service: MediaHttpService;
}>;

export function createMediaRoutes(dependencies: MediaRouteDependencies): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.on(["GET", "HEAD"], "/:mediaId/:variant", async (context) => {
    const variant = parseVariant(context.req.param("variant"));
    const request = context.req.raw;
    const rangeHeader = context.req.header("Range");
    let headResult: MediaHeadResult | undefined;
    try {
      if (request.method === "HEAD") {
        headResult = await dependencies.service.head(
          requestContext(context),
          context.req.param("mediaId"),
          variant,
        );
        const range = resolveRange(parseRange(rangeHeader), headResult.metadata.size);
        return presentMedia(request, metadataOnly(headResult.metadata, range), headResult.audience);
      }
      const result = await dependencies.service.read(
        requestContext(context),
        context.req.param("mediaId"),
        variant,
        parseRange(rangeHeader) ?? undefined,
      );
      return presentMedia(request, result.object, result.audience);
    } catch (error) {
      if (error instanceof MediaRangeError) {
        throw new HttpRangeError(error.message, error.total);
      }
      if (error instanceof HttpRangeError) {
        if (error.total !== undefined || headResult) {
          throw error.total === undefined ? new HttpRangeError(error.message, headResult!.metadata.size) : error;
        }
        const total = await dependencies.service.head(
          requestContext(context),
          context.req.param("mediaId"),
          variant,
        );
        throw new HttpRangeError(error.message, total.metadata.size);
      }
      if (error instanceof RangeError) {
        throw new HttpRangeError("Requested byte range is not satisfiable", headResult?.metadata.size);
      }
      throw error;
    }
  });

  return routes;
}

function parseVariant(value: string): MediaVariant {
  const parsed = mediaVariantSchema.safeParse(value);
  if (!parsed.success) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Media not found" });
  return parsed.data;
}

function resolveRange(requested: RequestedByteRange | null, total: number): BlobRange | undefined {
  if (!requested) return undefined;
  const offset = requested.kind === "suffix" ? Math.max(0, total - requested.length) : requested.offset;
  if (offset >= total) throw new HttpRangeError("Requested byte range is not satisfiable", total);
  const requestedLength = requested.kind === "open" ? total - offset : requested.length;
  const length = Math.min(requestedLength, total - offset);
  return { offset, length };
}

function metadataOnly(metadata: BlobMetadata, range?: BlobRange): BlobRead {
  return {
    metadata,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    ...(range ? { range: { ...range, total: metadata.size } } : {}),
  };
}
