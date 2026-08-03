import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAuditArchiveCron } from "./audit-archive";

type AuditRow = {
  id: string;
  entity_type: string;
  action: string;
  actor_id: string;
  entity_id: string;
  diff_title: string | null;
  detail_text: string | null;
  created_at: string;
};

function row(id: string): AuditRow {
  return {
    id,
    entity_type: "event",
    action: "update",
    actor_id: "actor-1",
    entity_id: `event-${id}`,
    diff_title: null,
    detail_text: null,
    created_at: "2020-01-15T00:00:00.000Z",
  };
}

function createDb(initialRows: AuditRow[]) {
  const rows = [...initialRows];
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => {
      if (sql.startsWith("DELETE FROM audit_log")) return { sql, bindings };
      return {
        all: vi.fn().mockImplementation(async () => {
          if (sql.includes("SELECT DISTINCT substr")) {
            return { results: rows.length > 0 ? [{ month: "2020-01" }] : [] };
          }
          if (sql.includes("FROM audit_log") && sql.includes("ORDER BY created_at ASC")) {
            const createdAtCursor = String(bindings[1]);
            const idCursor = String(bindings[2]);
            const limit = Number(bindings[3]);
            return {
              results: rows
                .filter((entry) => entry.created_at > createdAtCursor || (entry.created_at === createdAtCursor && entry.id > idCursor))
                .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id))
                .slice(0, limit),
            };
          }
          return { results: [] };
        }),
      };
    },
  }));
  const batch = vi.fn().mockImplementation(async (statements: Array<{ bindings: unknown[] }>) => {
    const ids = new Set(statements.flatMap((statement) => statement.bindings.map(String)));
    for (let index = rows.length - 1; index >= 0; index--) if (ids.has(rows[index]!.id)) rows.splice(index, 1);
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  });
  return { prepare, batch, rows };
}

type Stored = {
  bytes: ArrayBuffer;
  etag: string;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string; contentEncoding?: string };
};

async function bytesOf(value: string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream): Promise<ArrayBuffer> {
  if (typeof value === "string") return new TextEncoder().encode(value).buffer;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return copy.buffer;
  }
  return new Response(value as BodyInit).arrayBuffer();
}

function createBucket(options: {
  failPut?: (key: string) => boolean;
  corruptHead?: (key: string) => boolean;
  corruptGet?: (key: string) => boolean;
} = {}) {
  const objects = new Map<string, Stored>();
  const putOrder: string[] = [];
  const put = vi.fn().mockImplementation(async (key: string, value: Parameters<typeof bytesOf>[0], metadata?: Omit<Stored, "bytes" | "etag">) => {
    putOrder.push(key);
    if (options.failPut?.(key)) throw new Error(`put failed: ${key}`);
    const bytes = await bytesOf(value);
    const etag = `etag-${key}-${bytes.byteLength}`;
    objects.set(key, { bytes, etag, ...metadata });
    return { key, size: bytes.byteLength, etag, httpEtag: `"${etag}"`, ...metadata };
  });
  const head = vi.fn().mockImplementation(async (key: string) => {
    const object = objects.get(key);
    if (!object) return null;
    return {
      key,
      size: options.corruptHead?.(key) ? object.bytes.byteLength + 1 : object.bytes.byteLength,
      etag: object.etag,
      httpEtag: `"${object.etag}"`,
      customMetadata: object.customMetadata,
      httpMetadata: object.httpMetadata,
    };
  });
  const get = vi.fn().mockImplementation(async (key: string) => {
    const object = objects.get(key);
    if (!object) return null;
    const bytes = options.corruptGet?.(key) ? new TextEncoder().encode("{}").buffer : object.bytes;
    return {
      key,
      size: bytes.byteLength,
      etag: object.etag,
      httpEtag: `"${object.etag}"`,
      customMetadata: object.customMetadata,
      httpMetadata: object.httpMetadata,
      arrayBuffer: async () => bytes,
      text: async () => new TextDecoder().decode(bytes),
    };
  });
  return { objects, putOrder, put, head, get };
}

function envWith(rows: AuditRow[], bucket = createBucket()) {
  const DB = createDb(rows);
  return { env: { DB, MEDIA: bucket }, DB, bucket };
}

describe("audit archive manifest commit protocol", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("writes and verifies every data part, commits the manifest last, then deletes D1 rows", async () => {
    const fixture = envWith(Array.from({ length: 1001 }, (_, index) => row(String(index).padStart(4, "0"))));

    await runAuditArchiveCron(fixture.env as never);

    expect(fixture.bucket.putOrder.filter((key) => key.endsWith(".ndjson.gz"))).toHaveLength(2);
    expect(fixture.bucket.putOrder.at(-1)).toBe("audit-archive/2020/01/manifest.json");
    expect(fixture.DB.rows).toHaveLength(0);
    expect(fixture.DB.batch).toHaveBeenCalledTimes(1);
    for (const [statements] of fixture.DB.batch.mock.calls) {
      for (const statement of statements) expect(statement.bindings.length).toBeLessThanOrEqual(50);
    }
  });

  it.each([
    ["data put", { failPut: (key: string) => key.endsWith(".ndjson.gz") }],
    ["data HEAD verification", { corruptHead: (key: string) => key.endsWith(".ndjson.gz") }],
    ["manifest put", { failPut: (key: string) => key.endsWith("manifest.json") }],
    ["manifest verification", { corruptGet: (key: string) => key.endsWith("manifest.json") }],
  ])("keeps D1 rows when %s fails", async (_name, options) => {
    const fixture = envWith([row("1")], createBucket(options));

    await expect(runAuditArchiveCron(fixture.env as never)).rejects.toThrow();

    expect(fixture.DB.rows).toHaveLength(1);
    expect(fixture.DB.batch).not.toHaveBeenCalled();
  });

  it("does not treat a pre-existing data object as a commit marker", async () => {
    const bucket = createBucket({ failPut: (key) => key.endsWith(".ndjson.gz") });
    bucket.objects.set("audit-archive/2020/01/audit-2020-01-part-0001.ndjson.gz", {
      bytes: new TextEncoder().encode("untrusted").buffer,
      etag: "old-data",
    });
    const fixture = envWith([row("1")], bucket);

    await expect(runAuditArchiveCron(fixture.env as never)).rejects.toThrow(/put failed/);
    expect(fixture.DB.rows).toHaveLength(1);
    expect(fixture.DB.batch).not.toHaveBeenCalled();
    expect(bucket.objects.has("audit-archive/2020/01/manifest.json")).toBe(false);
  });

  it("keeps the committed manifest and D1 rows retryable when D1 deletion fails", async () => {
    const fixture = envWith([row("1")]);
    fixture.DB.batch.mockRejectedValueOnce(new Error("D1 unavailable"));

    await expect(runAuditArchiveCron(fixture.env as never)).rejects.toThrow("D1 unavailable");

    expect(fixture.bucket.objects.has("audit-archive/2020/01/manifest.json")).toBe(true);
    expect(fixture.DB.rows).toHaveLength(1);
  });
});
