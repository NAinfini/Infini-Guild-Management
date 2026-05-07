import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const I18N_ROOT = join(process.cwd(), "apps/portal/i18n");
const MOJIBAKE_MARKERS = [
  "\uFFFD",
  "\u93C2",
  "\u7EEE",
  "\u6D93",
  "\u942D",
  "\u9359",
  "\u93B7",
  "\u9352",
  "\u6D5C",
  "\u740C",
  "\u9352",
  "\u5A23",
  "\u7C2D",
  "\u6F36",
];

function flattenValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenValues);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(flattenValues);
  }
  return [];
}

function listLocaleFiles(): string[] {
  return readdirSync(I18N_ROOT)
    .flatMap((entry) => {
      const fullPath = join(I18N_ROOT, entry);
      if (!statSync(fullPath).isDirectory()) return [];
      return readdirSync(fullPath)
        .filter((file) => file.endsWith(".json"))
        .map((file) => join(fullPath, file));
    });
}

describe("i18n locale files", () => {
  it("are valid json without common mojibake markers", () => {
    const failures: string[] = [];

    for (const file of listLocaleFiles()) {
      const content = readFileSync(file, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch (error) {
        failures.push(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }

      const values = flattenValues(parsed);
      const badValue = values.find((value) => MOJIBAKE_MARKERS.some((marker) => value.includes(marker)));
      if (badValue) failures.push(`${file}: suspicious text "${badValue}"`);
    }

    expect(failures).toEqual([]);
  });
});
