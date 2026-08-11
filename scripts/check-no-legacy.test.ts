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

  it("permits the one-time credential migration tools", () => {
    const file = "scripts/modular-backend/credential-import.ts";
    expect(findLegacyViolations([file], () => "convertLegacyWorkerPasswordHash(input)", () => true)).toEqual([]);
  });
});
