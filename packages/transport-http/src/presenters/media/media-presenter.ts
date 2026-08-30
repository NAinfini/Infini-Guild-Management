import type { BlobRead } from "@guild/kernel";
import { LIMITS } from "@guild/shared";
import type { MediaReadFacts } from "@guild/server/modules/media";
import { formatHttpEtag, ifNoneMatch } from "../../core/etag.js";

export async function presentMedia(
  request: Request,
  object: BlobRead,
  facts: Pick<MediaReadFacts, "audience" | "entityTypes">,
  downloadName?: string,
): Promise<Response> {
  const etag = formatHttpEtag(object.metadata.etag);
  if (ifNoneMatch(request.headers.get("If-None-Match") ?? undefined, etag)) {
    await object.body.cancel().catch(() => undefined);
    return new Response(null, { status: 304, headers: mediaHeaders(object, etag, facts, downloadName) });
  }

  const headers = mediaHeaders(object, etag, facts, downloadName);
  if (request.method === "HEAD") {
    await object.body.cancel().catch(() => undefined);
    return new Response(null, { status: object.range ? 206 : 200, headers });
  }
  return new Response(object.body, { status: object.range ? 206 : 200, headers });
}

function mediaHeaders(
  object: BlobRead,
  etag: string,
  facts: Pick<MediaReadFacts, "audience" | "entityTypes">,
  downloadName?: string,
): Headers {
  const cacheControl = mediaCacheControl(facts, Boolean(object.range));
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

function mediaCacheControl(
  facts: Pick<MediaReadFacts, "audience" | "entityTypes">,
  ranged: boolean,
): string {
  if (facts.audience !== "public" || ranged) return "private, no-store";
  const edgeMaxAge = LIMITS.cache.publicMediaEdgeMaxAgeSeconds;
  const immutable = facts.entityTypes.length > 0 && facts.entityTypes.every(
    (entityType) => entityType === "site_config" || entityType === "class_catalog",
  );
  return immutable
    ? `public, max-age=${LIMITS.cache.immutablePublicMediaBrowserMaxAgeSeconds}, s-maxage=${edgeMaxAge}, immutable`
    : `public, max-age=${LIMITS.cache.publicMediaBrowserMaxAgeSeconds}, s-maxage=${edgeMaxAge}, must-revalidate`;
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
