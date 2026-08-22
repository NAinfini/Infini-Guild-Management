import { existsSync, globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCHEDULED_JOB_NAMES } from "./modules/jobs/public.js";
import { AUDIT_COVERAGE } from "./audit-coverage.js";

const modulesRoot = fileURLToPath(new URL("./modules", import.meta.url));

describe("audit coverage contract", () => {
  it("classifies every declared operation and every scheduled job", () => {
    expect(new Set(AUDIT_COVERAGE.map(({ operation }) => operation)).size).toBe(AUDIT_COVERAGE.length);
    for (const entry of AUDIT_COVERAGE) {
      expect(entry.operation).not.toBe("");
      expect(entry.source).not.toBe("");
      expect(existsSync(fileURLToPath(new URL(`./modules/${entry.source}`, import.meta.url))), entry.source).toBe(true);
      if (entry.classification === "audited") {
        expect(entry.actions.length).toBeGreaterThan(0);
        expect(entry.transactionOwner).not.toBe("");
      } else {
        expect(entry.reason).not.toBe("");
      }
    }
    const scheduled = AUDIT_COVERAGE.flatMap((entry) => entry.scheduledJob ?? []);
    expect([...scheduled].sort()).toEqual([...SCHEDULED_JOB_NAMES].sort());
  });

  it("has a coverage entry for every production source that creates an audit event", () => {
    const coveredSources = new Set(AUDIT_COVERAGE.map(({ source }) => source));
    const unclassified = globSync("**/*.ts", { cwd: modulesRoot })
      .map((source) => source.replaceAll("\\", "/"))
      .filter((source) => !source.endsWith(".test.ts") && source !== "audit/audit.ts")
      .filter((source) => /\bcreateAuditEvent(?:ForActor|ForUser)?\s*\(/.test(
        readFileSync(fileURLToPath(new URL(`./modules/${source}`, import.meta.url)), "utf8"),
      ))
      .filter((source) => !coveredSources.has(source));
    expect(unclassified).toEqual([]);
  });
});
