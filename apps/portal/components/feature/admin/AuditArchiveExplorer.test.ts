import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AuditArchiveExplorer touch targets", () => {
  it("uses the regular button size for both archive actions", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/admin/AuditArchiveExplorer.tsx"),
      "utf8",
    );

    expect(source.match(/size="sm"/g)).toHaveLength(2);
    expect(source).not.toContain('size="compact-sm"');
  });
});
