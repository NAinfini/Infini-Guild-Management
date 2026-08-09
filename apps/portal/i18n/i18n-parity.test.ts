import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const I18N_ROOT = join(process.cwd(), "apps/portal/i18n");
const LOCALES = ["en", "zh"] as const;
const NAMESPACE_FILES = [
  "admin.json",
  "announcements.json",
  "auth.json",
  "common.json",
  "dashboard.json",
  "editor.json",
  "events.json",
  "gallery.json",
  "guild-war.json",
  "profile.json",
  "roster.json",
  "settings.json",
  "storage.json",
  "tools.json",
  "wiki.json",
] as const;

function flattenLeaves(value: unknown, prefix = "", leaves: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length > 0) {
      for (const [key, child] of entries) {
        flattenLeaves(child, prefix ? `${prefix}.${key}` : key, leaves);
      }
      return leaves;
    }
  }
  leaves[prefix] = value;
  return leaves;
}

function loadLeaves(locale: string, file: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(join(I18N_ROOT, locale, file), "utf8")) as unknown;
  return flattenLeaves(parsed);
}

function interpolationVariables(value: string): string[] {
  const variables = new Set<string>();
  for (const match of value.matchAll(/{{\s*([^{}\s]+)\s*}}/g)) variables.add(match[1]!);
  return [...variables].sort();
}

describe("i18n locale parity (en ↔ zh)", () => {
  it("has exactly the required namespace files in every locale", () => {
    for (const locale of LOCALES) {
      const files = readdirSync(join(I18N_ROOT, locale)).filter((file) => file.endsWith(".json")).sort();
      expect(files, `${locale} namespace files`).toEqual([...NAMESPACE_FILES]);
    }
  });

  it.each(NAMESPACE_FILES)("uses identical string leaves and interpolation variables in %s", (file) => {
    const enLeaves = loadLeaves("en", file);
    const zhLeaves = loadLeaves("zh", file);
    expect(Object.keys(enLeaves).sort(), `keys in ${file}`).toEqual(Object.keys(zhLeaves).sort());

    for (const [key, value] of Object.entries(enLeaves)) {
      expect(value, `en leaf must be a string for ${key} (${file})`).toBeTypeOf("string");
    }
    for (const [key, value] of Object.entries(zhLeaves)) {
      expect(value, `zh leaf must be a string for ${key} (${file})`).toBeTypeOf("string");
    }

    for (const key of Object.keys(enLeaves)) {
      const enValue = enLeaves[key];
      const zhValue = zhLeaves[key];
      if (typeof enValue !== "string" || typeof zhValue !== "string") continue;
      expect(
        interpolationVariables(zhValue),
        `interpolation variables differ for ${key} (${file})`,
      ).toEqual(interpolationVariables(enValue));
    }
  });

  it("distinguishes durable member removal from ordinary deactivation", () => {
    const en = loadLeaves("en", "admin.json");
    const zh = loadLeaves("zh", "admin.json");

    expect(en["member.context.delete"]).toBe("Remove member");
    expect(en["member.context.batchDelete"]).toBe("Remove selected");
    expect(en["member.context.delete"]).not.toBe(en["member.deactivate"]);
    expect(zh["member.context.delete"]).toBe("移除成员");
    expect(zh["member.context.batchDelete"]).toBe("移除所选成员");
    expect(zh["member.context.delete"]).not.toBe(zh["member.deactivate"]);
  });
});
