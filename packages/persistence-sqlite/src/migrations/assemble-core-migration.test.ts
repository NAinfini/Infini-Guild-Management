import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderCoreMigration, renderMigrationManifest } from "../../scripts/assemble-core-migration.js";

describe("assemble core migration", () => {
  it("is byte-identical after two assemblies", async () => {
    const source = await readFile(
      fileURLToPath(new URL("./generated/0000_core.sql", import.meta.url)),
      "utf8",
    );
    const first = await renderCoreMigration(source);
    const second = await renderCoreMigration(first);
    expect(second).toBe(first);
    expect(renderMigrationManifest(first)).toBe(await readFile(
      fileURLToPath(new URL("./generated/manifest.json", import.meta.url)),
      "utf8",
    ));
    const [entry] = JSON.parse(renderMigrationManifest(first)) as Array<{
      id: string;
      ordinal: number;
      checksum: string;
    }>;
    expect(first).toContain(
      `INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('${entry!.id}', ${entry!.ordinal}, '${entry!.checksum}')`,
    );
    for (const statement of first.split("--> statement-breakpoint")) {
      expect((statement.match(/^\s*CREATE TRIGGER\b/gm) ?? []).length).toBeLessThanOrEqual(1);
    }
  });
});
