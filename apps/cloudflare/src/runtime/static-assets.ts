import type { StaticSiteBranding } from "@guild/application";
import { applyStaticSecurityHeaders } from "@guild/shared/utils/static-security-headers";

const INDEX_PATH = "/index.html";
const MAX_INDEX_BYTES = 1024 * 1024;
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const INDEX_CACHE = "public, max-age=0, s-maxage=60, must-revalidate, no-transform";
const BRANDING_CACHE_MILLISECONDS = 60_000;

export type CloudflareStaticAssetsDependencies = Readonly<{
  assets: { fetch(request: Request): Promise<Response> };
  getSiteBranding(): StaticSiteBranding | Promise<StaticSiteBranding>;
}>;

export type CloudflareStaticAssetsHandler = (request: Request) => Promise<Response | null>;

export function createCloudflareStaticAssets(
  dependencies: CloudflareStaticAssetsDependencies,
): CloudflareStaticAssetsHandler {
  let cachedBranding: Readonly<{
    expiresAt: number;
    value: Promise<StaticSiteBranding>;
  }> | null = null;
  const getSiteBranding = (): Promise<StaticSiteBranding> => {
    const now = Date.now();
    if (cachedBranding && now < cachedBranding.expiresAt) return cachedBranding.value;
    const value = Promise.resolve().then(() => dependencies.getSiteBranding());
    cachedBranding = { expiresAt: now + BRANDING_CACHE_MILLISECONDS, value };
    void value.catch(() => {
      if (cachedBranding?.value === value) cachedBranding = null;
    });
    return value;
  };

  return async (request) => {
    const url = new URL(request.url);
    const pathname = decodePath(url.pathname);
    if (pathname === null) return staticError(request, 400, "Invalid static path");
    if (isRuntimePath(pathname)) return null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const response = staticError(request, 405, "Method not allowed");
      response.headers.set("Allow", "GET, HEAD");
      return response;
    }

    const htmlNavigation = acceptsHtml(request);
    if (pathname === INDEX_PATH) {
      return serveIndex(request, await fetchIndex(dependencies.assets, request), getSiteBranding);
    }
    if (pathname === "/" || pathname.endsWith("/")) {
      if (!htmlNavigation) return staticError(request, 404, "Static asset not found");
      return serveIndex(request, await fetchIndex(dependencies.assets, request), getSiteBranding);
    }

    const asset = await dependencies.assets.fetch(request);
    const contentType = (asset.headers.get("Content-Type") ?? "").toLowerCase();
    if (asset.status === 404) {
      await asset.body?.cancel().catch(() => undefined);
      if (htmlNavigation && !looksLikeAsset(pathname)) {
        return serveIndex(request, await fetchIndex(dependencies.assets, request), getSiteBranding);
      }
      return staticError(request, 404, "Static asset not found");
    }
    if (contentType.includes("text/html") && pathname !== INDEX_PATH) {
      if (asset.ok && htmlNavigation && !looksLikeAsset(pathname)) {
        return serveIndex(request, asset, getSiteBranding);
      }
      await asset.body?.cancel().catch(() => undefined);
      return staticError(request, 404, "Static asset not found");
    }
    return finalizeStaticResponse(request, pathname, asset, false);
  };
}

export function isImmutableCloudflareBuildAsset(pathname: string): boolean {
  if (!pathname.startsWith("/assets/")) return false;
  const filename = pathname.split("/").at(-1) ?? "";
  return /(?:^|[-.])[A-Za-z0-9_-]{8,}\.(?:css|js|mjs|woff2?|png|jpe?g|gif|webp|svg)$/i.test(filename);
}

async function fetchIndex(assets: CloudflareStaticAssetsDependencies["assets"], request: Request): Promise<Response> {
  const url = new URL(INDEX_PATH, request.url);
  return assets.fetch(new Request(url, {
    method: "GET",
    headers: { Accept: "text/html", "Accept-Encoding": "identity" },
  }));
}

async function serveIndex(
  request: Request,
  asset: Response,
  getSiteBranding: CloudflareStaticAssetsDependencies["getSiteBranding"],
): Promise<Response> {
  if (!asset.ok) {
    await asset.body?.cancel().catch(() => undefined);
    return staticError(request, 500, "Static index unavailable");
  }
  try {
    const branding = await getSiteBranding();
    const siteName = branding.siteName.trim();
    const siteDescription = branding.siteDescription.trim();
    const siteLogoUrl = branding.siteLogoUrl.trim();
    if (!siteName || !siteDescription || !siteLogoUrl) throw new Error("Invalid site branding");
    const html = (await readTextBounded(asset.body, asset.headers.get("Content-Length"), MAX_INDEX_BYTES))
      .replaceAll("{{SITE_NAME}}", () => escapeHtml(siteName))
      .replaceAll("{{SITE_DESCRIPTION}}", () => escapeHtml(siteDescription))
      .replaceAll("{{SITE_LOGO_URL}}", () => escapeHtml(siteLogoUrl));
    const bytes = new TextEncoder().encode(html);
    const etag = `"${await sha256(bytes)}"`;
    const headers = new Headers(asset.headers);
    headers.delete("Accept-Ranges");
    headers.delete("Content-Encoding");
    headers.delete("Content-Range");
    headers.set("Content-Length", String(bytes.byteLength));
    headers.set("Content-Type", "text/html; charset=UTF-8");
    headers.set("ETag", etag);
    const response = ifNoneMatch(request.headers.get("If-None-Match"), etag)
      ? new Response(null, { status: 304, headers })
      : new Response(request.method === "HEAD" ? null : bytes, { status: 200, headers });
    return finalizeStaticResponse(request, INDEX_PATH, response, true);
  } catch {
    await asset.body?.cancel().catch(() => undefined);
    return staticError(request, 500, "Static site configuration unavailable");
  }
}

function finalizeStaticResponse(
  request: Request,
  pathname: string,
  upstream: Response,
  index: boolean,
): Response {
  const headers = new Headers(upstream.headers);
  const cacheable = upstream.ok || upstream.status === 304;
  headers.set("Cache-Control", index ? INDEX_CACHE
    : cacheable && isImmutableCloudflareBuildAsset(pathname) ? IMMUTABLE_CACHE : "no-cache");
  const mime = mimeType(pathname);
  if (mime && upstream.ok) headers.set("Content-Type", mime);
  applyStaticSecurityHeaders(headers, request.url);

  const noBody = request.method === "HEAD" || upstream.status === 204 || upstream.status === 304;
  if (noBody) void upstream.body?.cancel().catch(() => undefined);
  return new Response(noBody ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function staticError(request: Request, status: number, message: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-cache",
    "Content-Type": "text/plain; charset=UTF-8",
  });
  applyStaticSecurityHeaders(headers, request.url);
  return new Response(request.method === "HEAD" ? null : message, { status, headers });
}

async function readTextBounded(
  body: ReadableStream<Uint8Array> | null,
  contentLength: string | null,
  limit: number,
): Promise<string> {
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > limit) {
    await body?.cancel().catch(() => undefined);
    throw new Error("Static index is too large");
  }
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Static index is too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function decodePath(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes("\0") || decoded.includes("\\") || decoded.split("/").some((part) => part === "..")) return null;
    return decoded;
  } catch {
    return null;
  }
}

function isRuntimePath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/") || pathname === "/ws" || pathname.startsWith("/ws/");
}

function looksLikeAsset(pathname: string): boolean {
  return /\/[^/]*\.[^/]+$/.test(pathname);
}

function acceptsHtml(request: Request): boolean {
  const fetchMode = request.headers.get("Sec-Fetch-Mode");
  if (fetchMode !== null && fetchMode.toLowerCase() !== "navigate") return false;
  return request.headers.get("Accept")?.split(",").some((range) => {
    const [mediaType, ...parameters] = range.split(";");
    if (mediaType?.trim().toLowerCase() !== "text/html") return false;
    const quality = parameters.find((parameter) => parameter.trim().toLowerCase().startsWith("q="));
    return quality === undefined || Number(quality.split("=", 2)[1]) > 0;
  }) ?? false;
}

function ifNoneMatch(value: string | null, etag: string): boolean {
  const current = etag.replace(/^W\//, "");
  return value?.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized.replace(/^W\//, "") === current;
  }) ?? false;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mimeType(pathname: string): string | null {
  const extension = /\.([^.\/]+)$/.exec(pathname)?.[1]?.toLowerCase();
  return extension ? MIME_TYPES[extension] ?? "application/octet-stream" : null;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  css: "text/css; charset=UTF-8",
  gif: "image/gif",
  html: "text/html; charset=UTF-8",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=UTF-8",
  json: "application/json; charset=UTF-8",
  map: "application/json; charset=UTF-8",
  mjs: "text/javascript; charset=UTF-8",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  otf: "font/otf",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  txt: "text/plain; charset=UTF-8",
  wasm: "application/wasm",
  webm: "video/webm",
  webmanifest: "application/manifest+json",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xml: "application/xml; charset=UTF-8",
};
