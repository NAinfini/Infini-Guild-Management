import type { BlobStore } from "@guild/kernel";
import type { AuditEvent } from "@guild/shared";
import { describe, expect, it, vi } from "vitest";
import {
  AUDIT_ARCHIVE_CONTENT_TYPE,
  AuditArchiveService,
  type AuditArchiveStore,
} from "./audit-archive.js";

const NOW = "2026-08-09T12:00:00.000Z";
const BEFORE = "2026-07-01T00:00:00.000Z";

describe("AuditArchiveService streaming", () => {
  it("hashes one entry at a time and uploads one NDJSON chunk per entry", async () => {
    const entries = Array.from({ length: 3 }, (_, index): AuditEvent => ({
      event_id: `audit-${index}`,
      request_id: `request-${index}`,
      actor: { kind: "user", id: "admin-1", label: "admin" },
      subject: { type: "event", id: `event-${index}`, label: `Updated event ${index}` },
      action: "update",
      payload: {
        schema_version: 2,
        changes: [],
        context: [{ field: "notes", value: { type: "text", value: "x".repeat(256) } }],
      },
      occurred_at: `2026-06-0${index + 1}T00:00:00.000Z`,
    }));
    const finalize = vi.fn().mockResolvedValue(true);
    const store = {
      claim: vi.fn().mockResolvedValue({
        id: "archive-1",
        leaseToken: "lease-1",
        objectKey: "audit/2026/08/archive-1.ndjson",
        month: "2026-08",
        entries,
      }),
      finalize,
    } as unknown as AuditArchiveStore;
    const chunkSizes: number[] = [];
    let uploaded: Uint8Array<ArrayBuffer> = new Uint8Array();
    const putIfAbsent = vi.fn(async (key: string, input: Parameters<BlobStore["putIfAbsent"]>[1]) => {
      const chunks: Uint8Array[] = [];
      const reader = input.body.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
        chunkSizes.push(next.value.byteLength);
      }
      uploaded = concat(chunks);
      const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", uploaded)));
      expect(input).toMatchObject({ size: uploaded.byteLength, sha256: digest });
      return {
        key,
        size: input.size,
        contentType: input.contentType,
        sha256: input.sha256,
        etag: digest,
        lastModified: NOW,
      };
    });
    const service = new AuditArchiveService(store, { putIfAbsent } as unknown as BlobStore);

    await expect(service.archiveBatch(BEFORE, NOW, (archiveId, rowCount) => ({
      eventId: "audit-export-1",
      requestId: "scheduled-job",
      actorKind: "system",
      actorId: "system",
      actorLabel: null,
      subjectType: "audit_archive_export",
      subjectId: archiveId,
      subjectLabel: null,
      action: "archive",
      payload: {
        schema_version: 2,
        changes: [],
        context: [{ field: "row_count", value: { type: "number", value: rowCount } }],
      },
      occurredAt: NOW,
    }))).resolves.toEqual({ archived: 3, archiveId: "archive-1" });

    expect(chunkSizes).toHaveLength(entries.length);
    expect(Math.max(...chunkSizes)).toBeLessThan(uploaded.byteLength);
    expect(new TextDecoder().decode(uploaded)).toBe(`${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    expect(putIfAbsent.mock.calls[0]?.[1].contentType).toBe(AUDIT_ARCHIVE_CONTENT_TYPE);
    expect(finalize).toHaveBeenCalledOnce();
  });
});

function concat(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
