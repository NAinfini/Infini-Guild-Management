import { describe, expect, it } from "vitest";
import { findLegacyViolations } from "./check-no-legacy.mjs";

describe("legacy source guard", () => {
  it("rejects the retired backend and stale runtime references", () => {
    const files = ["apps/worker/index.ts", "apps/cloudflare/src/index.ts"];
    const content = new Map([
      ["apps/worker/index.ts", "export default {}"],
      ["apps/cloudflare/src/index.ts", 'import "../../../apps/worker/index"'],
    ]);
    expect(findLegacyViolations(files, (file) => content.get(file) ?? "", () => true)).toEqual([
      "apps/worker/index.ts: legacy source path",
      "apps/cloudflare/src/index.ts: references apps/worker/",
    ]);
  });

  it("rejects removed credential, migration assembler, audit, and class-catalog paths", () => {
    const files = [
      "scripts/modular-backend/credential-import.ts",
      "scripts/vps/credential-import.ts",
      "packages/persistence-sqlite/scripts/assemble-core-migration.ts",
      "package.json",
      "docs/setup-notes.md",
      "apps/portal/components/feature/admin/AuditLogViewer.tsx",
      "apps/portal/utils/class-catalog.ts",
    ];
    const content = new Map([
      ["apps/portal/components/feature/admin/AuditLogViewer.tsx", "legacy_detail"],
      ["apps/portal/utils/class-catalog.ts", "preservedIds"],
      ["package.json", "db:assemble"],
      ["docs/setup-notes.md", "Regenerate the baseline with db:assemble."],
    ]);
    expect(findLegacyViolations(files, (file) => content.get(file) ?? "", () => true)).toEqual([
      "scripts/modular-backend/credential-import.ts: legacy source path",
      "scripts/vps/credential-import.ts: legacy source path",
      "packages/persistence-sqlite/scripts/assemble-core-migration.ts: legacy source path",
      "package.json: references db:assemble",
      "docs/setup-notes.md: references db:assemble",
      "apps/portal/components/feature/admin/AuditLogViewer.tsx: references legacy_detail",
      "apps/portal/utils/class-catalog.ts: references preservedIds",
    ]);
  });
});
