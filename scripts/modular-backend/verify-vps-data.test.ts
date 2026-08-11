import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { runVpsDataVerification } from "./verify-vps-data.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("read-only VPS data verification", () => {
  it("reports a missing manifest blob and leaves the database unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "guild-verify-"));
    roots.push(root);
    const databasePath = path.join(root, "guild.sqlite");
    const blobPath = path.join(root, "blobs");
    const database = new DatabaseSync(databasePath);
    database.exec((await readFile(new URL(
      "../../packages/persistence-sqlite/src/migrations/generated/0000_core.sql",
      import.meta.url,
    ), "utf8")).replaceAll("--> statement-breakpoint", ""));
    database.prepare(`INSERT INTO audit_archives (
      id, month, status, object_key, row_count, starts_at, ends_at,
      size_bytes, sha256, created_at, completed_at
    ) VALUES (?, ?, 'ready', ?, 1, ?, ?, 7, ?, ?, ?)`).run(
      "archive-1",
      "2026-08",
      "audit/2026/08/archive-1.ndjson",
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:01:00.000Z",
      "a".repeat(64),
      "2026-08-01T00:02:00.000Z",
      "2026-08-01T00:02:00.000Z",
    );
    database.close();
    await import("node:fs/promises").then(({ mkdir }) => mkdir(blobPath));
    const findings: unknown[] = [];

    const result = await runVpsDataVerification([
      "--database", databasePath,
      "--blobs", blobPath,
      "--page-size", "10",
    ], {
      now: "2026-08-09T12:00:00.000Z",
      report: (finding) => findings.push(finding),
    });

    expect(result).toEqual({
      databasePath,
      blobPath,
      scanned: 1,
      findings: 1,
      byKind: { missing_blob: 1, metadata_mismatch: 0, orphan_candidate: 0 },
    });
    expect(findings).toEqual([expect.objectContaining({ kind: "missing_blob" })]);
    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    expect(reopened.prepare("SELECT count(*) AS count FROM audit_archives").get()).toEqual({ count: 1 });
    reopened.close();
  });
});
