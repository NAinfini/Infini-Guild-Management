import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const INDEX_PATH = "/index.html";
const MAX_INDEX_BYTES = 1024 * 1024;
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const INDEX_CACHE = "no-cache, no-store, must-revalidate, no-transform";

export type StaticSiteBranding = Readonly<{
  siteName: string;
  siteLogoUrl: string;
}>;

export type VpsStaticFilesDependencies = Readonly<{
  distRoot: string;
  getSiteBranding(): StaticSiteBranding | Promise<StaticSiteBranding>;
}>;

export type VpsStaticFilesHandler = (request: Request) => Promise<Response | null>;

type LocatedPath =
  | Readonly<{ kind: "directory"; path: string }>
  | Readonly<{ candidate: string; kind: "file"; path: string }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "outside" }>;

type ByteRange = Readonly<{ start: number; end: number }>;
type OpenedFile = Readonly<{ handle: FileHandle; stats: Stats }>;

export function createVpsStaticFiles(dependencies: VpsStaticFilesDependencies): VpsStaticFilesHandler {
  if (!dependencies.distRoot.trim()) throw new TypeError("Static dist root is required");
  const configuredRoot = path.resolve(dependencies.distRoot);
  let root: Promise<string> | undefined;

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

    const rootPath = await (root ??= realpath(configuredRoot));
    const htmlNavigation = acceptsHtml(request);
    if (pathname === INDEX_PATH) {
      return serveIndex(request, rootPath, dependencies.getSiteBranding);
    }
    if (pathname === "/" || pathname.endsWith("/")) {
      return htmlNavigation
        ? serveIndex(request, rootPath, dependencies.getSiteBranding)
        : staticError(request, 404, "Static asset not found");
    }

    const located = await locate(rootPath, pathname);
    if (located.kind === "outside") return staticError(request, 404, "Static asset not found");
    if (located.kind === "directory" || (located.kind === "missing" && !looksLikeAsset(pathname))) {
      return htmlNavigation
        ? serveIndex(request, rootPath, dependencies.getSiteBranding)
        : staticError(request, 404, "Static asset not found");
    }
    if (located.kind === "missing") return staticError(request, 404, "Static asset not found");
    return serveFile(request, pathname, rootPath, located);
  };
}

export function isImmutableVpsBuildAsset(pathname: string): boolean {
  if (!pathname.startsWith("/assets/")) return false;
  const filename = pathname.split("/").at(-1) ?? "";
  return /(?:^|[-.])[A-Za-z0-9_-]{8,}\.(?:css|js|mjs|woff2?|png|jpe?g|gif|webp|svg)$/i.test(filename);
}

async function locate(root: string, pathname: string): Promise<LocatedPath> {
  const candidate = path.resolve(root, `.${pathname}`);
  if (!isInside(root, candidate)) return { kind: "outside" };
  try {
    const resolved = await realpath(candidate);
    if (!isInside(root, resolved)) return { kind: "outside" };
    const stats = await lstat(resolved);
    if (stats.isSymbolicLink()) return { kind: "outside" };
    if (stats.isFile()) return { candidate, kind: "file", path: resolved };
    if (stats.isDirectory()) return { kind: "directory", path: resolved };
    return { kind: "outside" };
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) return { kind: "missing" };
    if (isErrno(error, "ELOOP")) return { kind: "outside" };
    throw error;
  }
}

async function serveIndex(
  request: Request,
  root: string,
  getSiteBranding: VpsStaticFilesDependencies["getSiteBranding"],
): Promise<Response> {
  const located = await locate(root, INDEX_PATH);
  if (located.kind !== "file") return staticError(request, 500, "Static index unavailable");

  let handle: FileHandle | null = null;
  try {
    const opened = await openVerifiedFile(root, located);
    if (!opened) return staticError(request, 500, "Static index unavailable");
    handle = opened.handle;
    const html = await readIndexBounded(handle);
    await handle.close();
    handle = null;

    const branding = await getSiteBranding();
    const siteName = branding.siteName.trim();
    const siteLogoUrl = branding.siteLogoUrl.trim();
    if (!siteName || !siteLogoUrl) throw new Error("Invalid site branding");
    const bytes = Buffer.from(html
      .replaceAll("{{SITE_NAME}}", () => escapeHtml(siteName))
      .replaceAll("{{SITE_LOGO_URL}}", () => escapeHtml(siteLogoUrl)), "utf8");
    const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
    const headers = new Headers({
      "Cache-Control": INDEX_CACHE,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": "text/html; charset=UTF-8",
      ETag: etag,
    });
    applySecurityHeaders(headers, request.url);
    if (ifNoneMatch(request.headers.get("If-None-Match"), etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(request.method === "HEAD" ? null : bytes, { status: 200, headers });
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (isErrno(error, "ENOENT") || isErrno(error, "ELOOP")) {
      return staticError(request, 500, "Static index unavailable");
    }
    if (error instanceof RangeError || (error instanceof Error && error.message === "Invalid site branding")) {
      return staticError(request, 500, "Static site configuration unavailable");
    }
    return staticError(request, 500, "Static site configuration unavailable");
  }
}

async function serveFile(
  request: Request,
  pathname: string,
  root: string,
  located: Extract<LocatedPath, { kind: "file" }>,
): Promise<Response> {
  let handle: FileHandle | null = null;
  try {
    const opened = await openVerifiedFile(root, located);
    if (!opened) return staticError(request, 404, "Static asset not found");
    ({ handle } = opened);
    const { stats } = opened;

    const etag = `W/"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": isImmutableVpsBuildAsset(pathname) ? IMMUTABLE_CACHE : "no-cache",
      "Content-Length": String(stats.size),
      "Content-Type": mimeType(pathname),
      ETag: etag,
      "Last-Modified": stats.mtime.toUTCString(),
    });
    applySecurityHeaders(headers, request.url);

    if (ifNoneMatch(request.headers.get("If-None-Match"), etag)) {
      await handle.close();
      handle = null;
      return new Response(null, { status: 304, headers });
    }

    const rangeHeader = request.headers.get("Range");
    const range = rangeHeader === null ? null : parseRange(rangeHeader, stats.size);
    if (rangeHeader !== null && range === null) {
      await handle.close();
      handle = null;
      headers.set("Content-Range", `bytes */${stats.size}`);
      headers.set("Content-Length", "0");
      return new Response(null, { status: 416, headers });
    }

    const status = range ? 206 : 200;
    if (range) {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stats.size}`);
      headers.set("Content-Length", String(range.end - range.start + 1));
    }
    if (request.method === "HEAD" || stats.size === 0) {
      await handle.close();
      handle = null;
      return new Response(null, { status, headers });
    }

    const stream = handle.createReadStream({
      ...(range ? { start: range.start, end: range.end } : {}),
      autoClose: true,
    });
    handle = null;
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (isErrno(error, "ENOENT") || isErrno(error, "ELOOP")) {
      return staticError(request, 404, "Static asset not found");
    }
    throw error;
  }
}

async function openVerifiedFile(
  root: string,
  located: Extract<LocatedPath, { kind: "file" }>,
): Promise<OpenedFile | null> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(located.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const handleIdentity = await handle.stat({ bigint: true });
    if (!handleIdentity.isFile() || handleIdentity.ino === 0n) return null;

    for (let verification = 0; verification < 2; verification += 1) {
      const currentPath = await realpath(located.candidate);
      if (!isInside(root, currentPath)) return null;
      const currentIdentity = await lstat(currentPath, { bigint: true });
      if (
        !currentIdentity.isFile()
        || currentIdentity.isSymbolicLink()
        || currentIdentity.dev !== handleIdentity.dev
        || currentIdentity.ino !== handleIdentity.ino
      ) {
        return null;
      }
    }

    const stats = await handle.stat();
    const opened = { handle, stats };
    handle = null;
    return opened;
  } catch (error) {
    if (isPathRejection(error)) return null;
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readIndexBounded(handle: FileHandle): Promise<string> {
  const stats = await handle.stat();
  if (!stats.isFile()) throw new Error("Static index is not a file");
  if (stats.size > MAX_INDEX_BYTES) throw new RangeError("Static index is too large");
  const bytes = Buffer.allocUnsafe(MAX_INDEX_BYTES + 1);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  if (offset > MAX_INDEX_BYTES) throw new RangeError("Static index is too large");
  return bytes.subarray(0, offset).toString("utf8");
}

function parseRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size === 0) return null;
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (!startText && !endText) return null;

  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
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

function applySecurityHeaders(headers: Headers, requestUrl: string): void {
  const url = new URL(requestUrl);
  const socketSource = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    `connect-src 'self' ${socketSource}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src https://www.youtube-nocookie.com https://player.bilibili.com https://player.vimeo.com https://www.tiktok.com",
    "frame-ancestors 'none'",
  ].join("; "));
}

function staticError(request: Request, status: number, message: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-cache",
    "Content-Type": "text/plain; charset=UTF-8",
  });
  applySecurityHeaders(headers, request.url);
  return new Response(request.method === "HEAD" ? null : message, { status, headers });
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isPathRejection(error: unknown): boolean {
  return ["EACCES", "ELOOP", "ENOENT", "ENOTDIR", "EPERM"].some((code) => isErrno(error, code));
}

function mimeType(pathname: string): string {
  const extension = path.extname(pathname).slice(1).toLowerCase();
  return MIME_TYPES[extension] ?? "application/octet-stream";
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
