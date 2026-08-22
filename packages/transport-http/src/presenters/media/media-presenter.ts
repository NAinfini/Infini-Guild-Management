import type { BlobRead } from "@guild/kernel";
import { LIMITS } from "@guild/shared";
import type { MediaReadFacts } from "@guild/server/modules/media";
import { formatHttpEtag, ifNoneMatch } from "../../core/etag.js";

export async function presentMedia(
  request: Request,
  object: BlobRead,
  audience: MediaReadFacts["audience"],
): Promise<Response> {
  const etag = formatHttpEtag(object.metadata.etag);
  if (ifNoneMatch(request.headers.get("If-None-Match") ?? undefined, etag)) {
    await object.body.cancel().catch(() => undefined);
    return new Response(null, { status: 304, headers: mediaHeaders(object, etag, audience) });
  }

  const headers = mediaHeaders(object, etag, audience);
  if (request.method === "HEAD") {
    await object.body.cancel().catch(() => undefined);
    return new Response(null, { status: object.range ? 206 : 200, headers });
  }
  return new Response(object.body, { status: object.range ? 206 : 200, headers });
}

function mediaHeaders(
  object: BlobRead,
  etag: string,
  audience: MediaReadFacts["audience"],
): Headers {
  const cacheControl = audience === "public" && !object.range
    ? `public, max-age=${LIMITS.cache.mediaMaxAgeSeconds}, s-maxage=${LIMITS.cache.publicMediaEdgeMaxAgeSeconds}`
    : `private, max-age=${LIMITS.cache.mediaMaxAgeSeconds}`;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    "Content-Length": String(object.range?.length ?? object.metadata.size),
    "Content-Type": object.metadata.contentType,
    "ETag": etag,
    "Last-Modified": new Date(object.metadata.lastModified).toUTCString(),
  });
  if (object.range) {
    headers.set(
      "Content-Range",
      `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.range.total}`,
    );
  }
  return headers;
}
