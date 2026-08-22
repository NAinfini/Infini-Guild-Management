import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_FIELDS } from "@guild/shared/constants/audit";
import { describe, expect, it } from "vitest";
import { AUDIT_COVERAGE } from "./audit-coverage.js";

const auditedEntries = AUDIT_COVERAGE.filter((entry) => entry.classification === "audited");
const auditedSources = [...new Set(auditedEntries.map(({ source }) => source))];

const SOURCE_SAFETY_RULES = [
  {
    name: "serialized data stored as a code",
    pattern: /type:\s*["']code["'][\s\S]{0,160}?value:\s*JSON\.stringify/g,
  },
  {
    name: "an unlabeled business reference",
    pattern: /type:\s*["']reference["'][\s\S]{0,220}?label:\s*null/g,
  },
  {
    name: "a runtime-restricted detail field",
    pattern: /field:\s*["'](?:body|errors)["']/g,
  },
] as const;

const CRITICAL_SOURCE_FIELDS = [
  {
    source: "auth/identity-admin-service.ts",
    additionalSources: ["packages/persistence-sqlite/src/stores/auth-store.ts"],
    fields: ["role_id", "max_uses", "used_count", "expires_at", "status", "failed_attempts", "locked_until"],
  },
  {
    source: "events/events-service.ts",
    additionalSources: ["packages/persistence-sqlite/src/stores/events-store.ts"],
    fields: ["user_count", "user_ids", "winner_count", "winner_user_ids"],
  },
  {
    source: "guild-war/guild-war-service.ts",
    fields: ["user_ids", "destinations", "member_count", "result"],
  },
  {
    source: "storage/storage-service.ts",
    fields: ["storage_id", "item_ids", "transaction_count", "quantity"],
  },
  {
    source: "wiki/wiki-service.ts",
    fields: ["category_id", "revision", "upload_count"],
  },
  {
    source: "site-config/site-config-service.ts",
    fields: [
      "reference_duration_minutes",
      "kills_weight",
      "towers_weight",
      "base_hp_weight",
      "credits_weight",
      "distance_weight",
    ],
  },
  {
    source: "system-test/system-test-service.ts",
    fields: ["total", "passed", "failed"],
  },
] as const;

function readModule(source: string): string {
  const file = fileURLToPath(new URL(`./modules/${source}`, import.meta.url));
  expect(existsSync(file), source).toBe(true);
  return readFileSync(file, "utf8");
}

describe("audit semantic contract", () => {
  it("defines a complete, unique operation/action matrix", () => {
    const matrix = auditedEntries.flatMap((entry) => entry.actions.map((action) => ({
      key: `${entry.operation}:${action}`,
      operation: entry.operation,
      subjectType: entry.subjectType,
      action,
    })));
    expect(matrix.length).toBeGreaterThan(0);
    expect(new Set(matrix.map(({ key }) => key)).size).toBe(matrix.length);
    for (const row of matrix) {
      expect(row.operation).not.toBe("");
      expect(row.subjectType).not.toBe("");
      expect(row.action).not.toBe("");
    }
  });

  it.each(SOURCE_SAFETY_RULES)("does not write $name", ({ pattern }) => {
    const violations = auditedSources
      .filter((source) => source !== "audit/audit.ts")
      .flatMap((source) => [...readModule(source).matchAll(pattern)].map((match) => ({
        source,
        excerpt: match[0].replaceAll(/\s+/g, " ").slice(0, 240),
      })));
    expect(violations).toEqual([]);
  });

  it.each(CRITICAL_SOURCE_FIELDS)("keeps the required business fields in $source", ({ source, fields }) => {
    const entry = CRITICAL_SOURCE_FIELDS.find((candidate) => candidate.source === source)!;
    const text = [
      readModule(source),
      ...("additionalSources" in entry
        ? entry.additionalSources.map((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
        : []),
    ].join("\n");
    for (const field of fields) {
      expect(text, `${source}: ${field}`).toMatch(new RegExp(`["']${field}["']`));
    }
  });

  it("does not define audit fields for credentials, tokens, object keys, URLs, or stacks", () => {
    const unsafe = AUDIT_FIELDS.filter((field) => (
      /password|hash|salt|token|session|invite_code|object_key|url|stack/i.test(field)
    ));
    expect(unsafe).toEqual([]);
  });
});
