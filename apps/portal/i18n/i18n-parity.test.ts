// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_ACTIONS, AUDIT_CODE_VALUES, AUDIT_ENTITY_TYPES, AUDIT_FIELDS, AUDIT_SECTION_KEYS } from "@guild/shared/constants/audit";
import { PERMISSIONS } from "@guild/shared/constants/roles";
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
  "visualPresets.json",
  "wiki.json",
] as const;
const AUDIT_VALUE_KEYS = [
  "boolean.false",
  "boolean.true",
  "empty",
  "list.empty",
  "list.more",
  "null.default",
  "null.never",
  "reference.unknown",
  "reference.unknownRole",
  "reference.unknownUser",
  "technicalIdentifier",
  "structuredDetailsUnavailable",
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

function translatedValues(leaves: Record<string, unknown>, prefix: string): string[] {
  return Object.keys(leaves)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .sort();
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

  it("covers every audit entity, action, field, value, and controlled code exactly", () => {
    for (const locale of LOCALES) {
      const leaves = loadLeaves(locale, "admin.json");
      expect(translatedValues(leaves, "audit.entityType."), `${locale} audit entities`)
        .toEqual([...AUDIT_ENTITY_TYPES].sort());
      expect(translatedValues(leaves, "audit.action."), `${locale} audit actions`)
        .toEqual([...AUDIT_ACTIONS].sort());
      expect(translatedValues(leaves, "audit.field."), `${locale} audit fields`)
        .toEqual([...AUDIT_FIELDS].sort());
      expect(translatedValues(leaves, "audit.value."), `${locale} audit values`)
        .toEqual([...AUDIT_VALUE_KEYS].sort());
      expect(translatedValues(leaves, "audit.code."), `${locale} audit codes`)
        .toEqual([...AUDIT_CODE_VALUES].sort());
      expect(translatedValues(leaves, "audit.section."), `${locale} audit sections`)
        .toEqual([...AUDIT_SECTION_KEYS].sort());
      expect(translatedValues(leaves, "roles.permission."), `${locale} permission labels`)
        .toEqual([...PERMISSIONS].sort());
    }
  });

  /* 这些前缀下的每个键都是同一份枚举的一员，会被并排渲染成一份清单（审计详情的字段行、
     实体时间线、接口自检面板）。两个成员共用一句文案时，读的人分不出发生的是哪一件事。 */
  it.each([
    ["audit.entityType.", "admin.json"],
    ["audit.action.", "admin.json"],
    ["audit.field.", "admin.json"],
    ["audit.code.", "admin.json"],
    ["audit.section.", "admin.json"],
    ["audit.sentence.", "admin.json"],
    ["roles.permission.", "admin.json"],
    ["status.api.ep.", "admin.json"],
  ])("gives every %s member its own label", (prefix, file) => {
    for (const locale of LOCALES) {
      const leaves = loadLeaves(locale, file);
      const membersByLabel = new Map<string, string[]>();
      for (const [key, value] of Object.entries(leaves)) {
        if (!key.startsWith(prefix)) continue;
        const shared = membersByLabel.get(String(value)) ?? [];
        shared.push(key.slice(prefix.length));
        membersByLabel.set(String(value), shared);
      }
      const collisions = [...membersByLabel]
        .filter(([, members]) => members.length > 1)
        .map(([label, members]) => `${label} <- ${members.join(", ")}`);
      expect(collisions, `${locale} ${prefix} label collisions`).toEqual([]);
    }
  });

  /* 摘要句是按动作写死的，没有兜底模板：缺一个键，那条日志就只会渲染出键名本身。 */
  it("writes a sentence for every audit action, with and without a subject", () => {
    for (const locale of LOCALES) {
      const leaves = loadLeaves(locale, "admin.json");
      const missing = AUDIT_ACTIONS.flatMap((action) => [
        `audit.sentence.${action}`,
        `audit.sentence.${action}.noSubject`,
      ]).filter((key) => typeof leaves[key] !== "string");
      expect(missing, `${locale} audit sentences`).toEqual([]);
    }
  });

  it("localizes the complete system-test audit presentation", () => {
    for (const locale of LOCALES) {
      const leaves = loadLeaves(locale, "admin.json");
      expect(interpolationVariables(String(leaves["audit.sentence.system_test.run"])))
        .toEqual(["actor", "passed", "total"]);
      for (const field of ["total", "passed", "failed", "errors"] as const) {
        expect(leaves[`audit.field.${field}`], `${locale} system-test ${field} label`).toBeTypeOf("string");
      }
    }
  });

  it("localizes the class icon file-size label", () => {
    const en = loadLeaves("en", "admin.json");
    const zh = loadLeaves("zh", "admin.json");

    expect(en["siteConfig.fileSize.class_icon"]).toBe("Class icon");
    expect(zh["siteConfig.fileSize.class_icon"]).toBe("职业图标");
  });
});
