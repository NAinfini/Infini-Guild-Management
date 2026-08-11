import type { SqlExecutor } from "@guild/kernel";
import { describe, expect, it } from "vitest";
import {
  APPLICATION_MIGRATIONS,
  assertApplicationSchema,
  parseMigrationManifest,
} from "./schema-version.js";

const expectedRows = APPLICATION_MIGRATIONS.map(({ id, ordinal, checksum }) => [id, ordinal, checksum]);

describe("application migration ledger gate", () => {
  it("accepts only the complete ordered manifest with matching checksums", async () => {
    await expect(assertApplicationSchema(executor(expectedRows))).resolves.toBeUndefined();
    await expect(assertApplicationSchema(executor([]))).rejects.toThrow(/schema mismatch/i);
    await expect(assertApplicationSchema(executor([["0000_core", 1, APPLICATION_MIGRATIONS[0]!.checksum]])))
      .rejects.toThrow(/schema mismatch/i);
    await expect(assertApplicationSchema(executor([["0000_core", 0, "0".repeat(64)]])))
      .rejects.toThrow(/schema mismatch/i);
  });

  it("rejects a manifest gap and wraps a missing ledger as uninitialized", async () => {
    expect(() => parseMigrationManifest([{
      id: "0001_gap",
      ordinal: 1,
      file: "0001_gap.sql",
      checksum: "0".repeat(64),
    }])).toThrow(/gap|ordinal/i);
    await expect(assertApplicationSchema(executor(new Error("no such table: app_migrations"))))
      .rejects.toThrow(/not initialized/i);
  });
});

function executor(rows: unknown): SqlExecutor {
  return {
    execute: async () => {
      if (rows instanceof Error) throw rows;
      return { rows: rows as never };
    },
    batch: async () => [],
  };
}
