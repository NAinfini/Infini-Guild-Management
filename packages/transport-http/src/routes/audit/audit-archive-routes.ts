import type { BlobMetadata, BlobRange } from "@guild/kernel";
import type { AuditArchiveDownloadTokens, AuditArchiveService } from "@guild/server/modules/audit";
import { Hono } from "hono";
import { z } from "zod";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { HttpRangeError } from "../../core/http-range-error.js";
import { parseQuery } from "../../core/parsing.js";
import { parseRange, type RequestedByteRange } from "../../core/range.js";

const DOWNLOAD_TTL_SECONDS = 5 * 60;
const monthQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
const tokenQuerySchema = z.object({ token: z.string().min(16).max(2_048) });

type AuditArchiveHttpService = Pick<AuditArchiveService, "listMonths" | "listFiles" | "head" | "read">;
type AuditArchiveHttpTokens = Pick<AuditArchiveDownloadTokens, "issue" | "verify">;

export function createAuditArchiveRoutes(
  dependencies: Readonly<{ service: AuditArchiveHttpService; tokens: AuditArchiveHttpTokens }>,
): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/audit-archive/months", async (context) => context.json({
    months: await dependencies.service.listMonths(requestContext(context)),
  }));

  routes.get("/audit-archive/download", async (context) => {
    const request = requestContext(context);
    const { month } = parseQuery(context.req.raw, monthQuerySchema, "Invalid audit archive month");
    const files = await dependencies.service.listFiles(request, month);
    const downloads = await Promise.all(files.map(async (file) => ({
      file,
      download: await dependencies.tokens.issue(request, file.id, DOWNLOAD_TTL_SECONDS),
    })));
    return context.json({
      month,
      expires_in_seconds: DOWNLOAD_TTL_SECONDS,
      files: downloads.map(({ file, download }) => ({
        key: file.objectKey,
        row_count: file.rowCount,
        size_bytes: file.sizeBytes,
        expires_at: download.expiresAt,
        url: `/api/admin/audit-archive/download/file?token=${encodeURIComponent(download.token)}`,
      })),
    });
  });

  routes.on(["GET", "HEAD"], "/audit-archive/download/file", async (context) => {
    const request = requestContext(context);
    const { token } = parseQuery(context.req.raw, tokenQuerySchema, "Invalid audit archive download token");
    const archiveId = await dependencies.tokens.verify(request, token);
    const rangeHeader = context.req.header("Range");

    if (context.req.method === "HEAD" || rangeHeader) {
      const metadata = await dependencies.service.head(request, archiveId);
      const range = resolveRange(rangeHeader, metadata.size);
      if (context.req.method === "HEAD") return archiveResponse(archiveId, metadata, null, range);
      const object = await dependencies.service.read(request, archiveId, range ?? undefined);
      return archiveResponse(archiveId, object.metadata, object.body, range);
    }

    const object = await dependencies.service.read(request, archiveId);
    return archiveResponse(archiveId, object.metadata, object.body, null);
  });

  return routes;
}

function archiveResponse(
  archiveId: string,
  metadata: BlobMetadata,
  body: ReadableStream<Uint8Array> | null,
  range: Readonly<BlobRange & { total: number }> | null,
): Response {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename="guild-audit-${archiveId}.ndjson"`,
    "Content-Length": String(range?.length ?? metadata.size),
    "Content-Type": metadata.contentType,
    ETag: `"${metadata.etag}"`,
  });
  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${range.total}`);
  }
  return new Response(body, { status: range ? 206 : 200, headers });
}

function resolveRange(header: string | undefined, total: number): Readonly<BlobRange & { total: number }> | null {
  let requested: RequestedByteRange | null;
  try {
    requested = parseRange(header);
  } catch (error) {
    if (error instanceof HttpRangeError) throw new HttpRangeError(error.message, total);
    throw error;
  }
  if (!requested) return null;
  const offset = requested.kind === "suffix" ? Math.max(0, total - requested.length) : requested.offset;
  if (offset >= total) throw new HttpRangeError("Requested byte range is not satisfiable", total);
  const requestedLength = requested.kind === "open" ? total - offset : requested.length;
  return { offset, length: Math.min(requestedLength, total - offset), total };
}
