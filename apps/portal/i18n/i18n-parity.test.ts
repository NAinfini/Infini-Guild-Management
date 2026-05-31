import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const I18N_ROOT = join(process.cwd(), "apps/portal/i18n");
const LOCALES = ["en", "zh"] as const;

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

function loadKeys(locale: string, file: string): Set<string> {
  const parsed = JSON.parse(readFileSync(join(I18N_ROOT, locale, file), "utf8")) as unknown;
  return new Set(flattenKeys(parsed));
}

describe("i18n locale parity (en ↔ zh)", () => {
  const enFiles = readdirSync(join(I18N_ROOT, "en")).filter((f) => f.endsWith(".json"));

  it("has the same set of namespace files in every locale", () => {
    const reference = new Set(enFiles);
    for (const locale of LOCALES) {
      const files = new Set(readdirSync(join(I18N_ROOT, locale)).filter((f) => f.endsWith(".json")));
      expect([...reference].filter((f) => !files.has(f)), `${locale} missing namespaces`).toEqual([]);
      expect([...files].filter((f) => !reference.has(f)), `${locale} extra namespaces`).toEqual([]);
    }
  });

  it.each(enFiles)("has identical keys across locales in %s", (file) => {
    const enKeys = loadKeys("en", file);
    const zhKeys = loadKeys("zh", file);
    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
    const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
    expect(missingInZh, `keys present in en but missing in zh (${file})`).toEqual([]);
    expect(missingInEn, `keys present in zh but missing in en (${file})`).toEqual([]);
  });
});
