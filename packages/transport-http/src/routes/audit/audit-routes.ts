import type { AuditService } from "@guild/server/modules/audit";
import { AUDIT_ENTITY_TYPES } from "@guild/shared/constants/audit";
import { Hono } from "hono";
import { z } from "zod";
import { jsonWithEtag } from "../../core/etag.js";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { parseQuery, validation } from "../../core/parsing.js";
import { presentAuditExport, presentAuditPage } from "../../presenters/audit/audit-presenter.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RANGE_DAYS = 90;
const MAX_RANGE_DAYS = 365;

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).max(512).optional(),
  entity_type: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entity_id: z.string().trim().min(1).max(200).optional(),
  actor_id: z.string().trim().min(1).max(200).optional(),
  search: z.string().trim().max(200).optional(),
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
});
const auditExportQuerySchema = auditQuerySchema.omit({ limit: true, cursor: true }).extend({
  format: z.enum(["csv", "json"]).default("csv"),
});

type AuditHttpService = Pick<AuditService, "list" | "export" | "recordExport">;

export type AuditRouteDependencies = Readonly<{
  service: AuditHttpService;
}>;

export function createAuditRoutes(dependencies: AuditRouteDependencies): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/audit-log", async (context) => {
    const request = requestContext(context);
    const parsed = parseQuery(context.req.raw, auditQuerySchema, "Invalid audit query");
    const range = resolveDateRange(parsed.start_at, parsed.end_at, request.now);
    const page = await dependencies.service.list(request, {
      limit: parsed.limit,
      ...optional("cursor", parsed.cursor),
      ...optional("subjectType", parsed.entity_type),
      ...optional("subjectId", parsed.entity_id),
      ...optional("actorId", parsed.actor_id),
      ...optional("search", parsed.search),
      startAt: range.startAt,
      endAt: range.endAt,
    });
    return jsonWithEtag(context.req.raw, presentAuditPage(page));
  });

  routes.get("/audit-log/export", async (context) => {
    const request = requestContext(context);
    const parsed = parseQuery(context.req.raw, auditExportQuerySchema, "Invalid audit export query");
    const range = resolveDateRange(parsed.start_at, parsed.end_at, request.now);
    const query = {
      ...optional("subjectType", parsed.entity_type),
      ...optional("subjectId", parsed.entity_id),
      ...optional("actorId", parsed.actor_id),
      ...optional("search", parsed.search),
      startAt: range.startAt,
      endAt: range.endAt,
    };
    await dependencies.service.recordExport(request, parsed.format, query);
    const rows = dependencies.service.export(request, query);
    return presentAuditExport(rows, {
      format: parsed.format,
      startAt: range.startAt,
      endAt: range.endAt,
      exportedAt: request.now,
    });
  });

  return routes;
}

function resolveDateRange(startAt: string | undefined, endAt: string | undefined, now: string) {
  if ((startAt === undefined) !== (endAt === undefined)) {
    throw validation("start_at and end_at must be provided together");
  }
  const resolvedEnd = endAt ?? now;
  const resolvedStart = startAt ?? new Date(Date.parse(now) - DEFAULT_RANGE_DAYS * DAY_MS).toISOString();
  const span = Date.parse(resolvedEnd) - Date.parse(resolvedStart);
  if (span < 0) throw validation("start_at must be earlier than end_at");
  if (span > MAX_RANGE_DAYS * DAY_MS) throw validation(`Date range must be within ${MAX_RANGE_DAYS} days`);
  return { startAt: resolvedStart, endAt: resolvedEnd };
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined || value === "" ? {} : { [key]: value } as { [P in K]?: V };
}
