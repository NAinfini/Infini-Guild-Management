import {
  auditEventCursorResponseSchema,
  auditEventSchema,
  formatCsvCell,
  type AuditEvent,
  type CursorResponse,
} from "@guild/shared";

export function presentAuditPage(value: unknown): CursorResponse<AuditEvent> {
  return auditEventCursorResponseSchema.parse(value);
}

export type AuditExportOptions = Readonly<{
  format: "csv" | "json";
  startAt: string;
  endAt: string;
  exportedAt: string;
}>;

export function presentAuditExport(
  entries: AsyncIterable<AuditEvent>,
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
            ? "event_id,subject_type,action,actor_id,actor_label,subject_id,subject_label,payload,occurred_at"
            : `{"exported_at":${JSON.stringify(options.exportedAt)},"start_at":${JSON.stringify(options.startAt)},"end_at":${JSON.stringify(options.endAt)},"data":[`));
          return;
        }

        const next = await iterator.next();
        if (next.done) {
          if (options.format === "json") controller.enqueue(encoder.encode(`],"total":${total}}`));
          controller.close();
          return;
        }

        const row = auditEventSchema.parse(next.value);
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

function auditCsvRow(row: AuditEvent): string {
  return [
    row.event_id,
    row.subject.type,
    row.action,
    row.actor.id,
    row.actor.label,
    row.subject.id,
    row.subject.label,
    JSON.stringify(row.payload),
    row.occurred_at,
  ].map((value) => formatCsvCell(value)).join(",");
}
