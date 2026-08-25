import type { BlobRead } from "@guild/kernel";
import { LIMITS } from "@guild/shared";
import type { MediaReadFacts } from "@guild/server/modules/media";
import { formatHttpEtag, ifNoneMatch } from "../../core/etag.js";

export async function presentMedia(
  request: Request,
  object: BlobRead,
  audience: MediaReadFacts["audience"],
  downloadName?: string,
): Promise<Response> {
  const etag = formatHttpEtag(object.metadata.etag);
  if (ifNoneMatch(request.headers.get("If-None-Match") ?? undefined, etag)) {
    await object.body.cancel().catch(() => undefined);
    return new Response(null, { status: 304, headers: mediaHeaders(object, etag, audience, downloadName) });
  }

  const headers = mediaHeaders(object, etag, audience, downloadName);
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
  downloadName?: string,
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
  if (downloadName) headers.set("Content-Disposition", contentDisposition(downloadName));
  return headers;
}

function contentDisposition(name: string): string {
  const fallback = name
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/[\\"]/g, "_")
    .trim()
    .slice(0, 120) || "attachment";
  const encodedName = encodeURIComponent(name).replace(/[\'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodedName}`;
}
