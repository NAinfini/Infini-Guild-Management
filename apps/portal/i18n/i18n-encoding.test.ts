// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const I18N_ROOT = join(process.cwd(), "apps/portal/i18n");
const COMMON_LATIN1_MOJIBAKE = /(?:[\u00C2\u00C3\u00E4\u00E5\u00EF][\u0080-\u00BF]|\u00E2(?:\u20AC[\u0080-\u00BF]?|[\u0080-\u00BF])|\u00F0(?:\u0178|[\u0080-\u00BF]))/u;

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

function hasAsciiEllipsisOutsideUrl(value: string): boolean {
  return value.replace(/https:\/\/[^\s"']+/g, "").includes("...");
}

function hasCommonLatin1Mojibake(value: string): boolean {
  return value.includes("\uFFFD") || COMMON_LATIN1_MOJIBAKE.test(value);
}

describe("i18n locale files", () => {
  it("are valid JSON, nonempty, and free of common mojibake", () => {
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
      if (values.length === 0) {
        failures.push(`${file}: no translation strings`);
        continue;
      }
      const emptyValue = values.find((value) => value.trim().length === 0);
      if (emptyValue !== undefined) failures.push(`${file}: empty translation string`);

      const badValue = values.find(hasCommonLatin1Mojibake);
      if (badValue) failures.push(`${file}: suspicious text "${badValue}"`);

      if (file.startsWith(`${join(I18N_ROOT, "zh")}${sep}`)) {
        const asciiEllipsis = values.find(hasAsciiEllipsisOutsideUrl);
        if (asciiEllipsis) failures.push(`${file}: Chinese text contains ASCII ellipsis "${asciiEllipsis}"`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("detects common Latin-1 mojibake without flagging valid Chinese", () => {
    expect(hasCommonLatin1Mojibake("ä½ å¥½")).toBe(true);
    expect(hasCommonLatin1Mojibake("你好，公会成员")).toBe(false);
  });
});
