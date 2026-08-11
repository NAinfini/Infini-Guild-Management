import { auditLogSchema, type AuditLogEntry, type PaginatedResponse } from "@guild/shared";
import { z } from "zod";

const auditPageSchema = z.object({
  data: z.array(auditLogSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total_pages: z.number().int().nonnegative(),
});

export function presentAuditPage(value: unknown): PaginatedResponse<AuditLogEntry> {
  return auditPageSchema.parse(value);
}

export type AuditExportOptions = Readonly<{
  format: "csv" | "json";
  startAt: string;
  endAt: string;
  exportedAt: string;
}>;

export function presentAuditExport(
  entries: AsyncIterable<AuditLogEntry>,
  options: AuditExportOptions,
): Response {
  const iterator = entries[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let started = false;
  let first = true;
  let total = 0;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(encoder.encode(options.format === "csv"
            ? "id,entity_type,action,actor_id,actor_username,entity_id,diff_title,detail,created_at"
            : `{"exported_at":${JSON.stringify(options.exportedAt)},"start_at":${JSON.stringify(options.startAt)},"end_at":${JSON.stringify(options.endAt)},"data":[`));
          return;
        }

        const next = await iterator.next();
        if (next.done) {
          if (options.format === "json") controller.enqueue(encoder.encode(`],"total":${total}}`));
          controller.close();
          return;
        }

        const row = auditLogSchema.parse(next.value);
        total += 1;
        if (options.format === "csv") {
          controller.enqueue(encoder.encode(`\n${auditCsvRow(row)}`));
        } else {
          controller.enqueue(encoder.encode(`${first ? "" : ","}${JSON.stringify(row)}`));
          first = false;
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  const filename = `guild-audit-${options.startAt.slice(0, 10)}-to-${options.endAt.slice(0, 10)}.${options.format}`;
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": options.format === "csv"
        ? "text/csv; charset=UTF-8"
        : "application/json; charset=UTF-8",
    },
  });
}

function auditCsvRow(row: AuditLogEntry): string {
  return [
    row.id,
    row.entity_type,
    row.action,
    row.actor_id,
    row.actor_username ?? null,
    row.entity_id,
    row.diff_title,
    row.detail === null ? null : JSON.stringify(row.detail),
    row.created_at,
  ].map(csvCell).join(",");
}

function csvCell(value: string | null): string {
  if (value === null) return "";
  const safe = /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll("\"", "\"\"")}"` : safe;
}
