import { describe, expect, it } from "vitest";
import { buildLocaleOptions } from "./locales";

describe("buildLocaleOptions", () => {
  it("returns localized labels for supported locales", () => {
    const en = buildLocaleOptions((key) => {
      const labels: Record<string, string> = {
        "locale.option.en": "English",
        "locale.option.en.description": "Default language",
        "locale.option.zh": "Chinese (Simplified)",
        "locale.option.zh.description": "Chinese interface",
      };

      return labels[key] ?? key;
    });

    const zh = buildLocaleOptions((key) => {
      const labels: Record<string, string> = {
        "locale.option.en": "英语",
        "locale.option.en.description": "英文界面",
        "locale.option.zh": "简体中文",
        "locale.option.zh.description": "中文界面",
      };

      return labels[key] ?? key;
    });

    expect(en).toEqual([
      { value: "en", label: "English", description: "Default language" },
      { value: "zh", label: "Chinese (Simplified)", description: "Chinese interface" },
    ]);
    expect(zh).toEqual([
      { value: "en", label: "英语", description: "英文界面" },
      { value: "zh", label: "简体中文", description: "中文界面" },
    ]);
  });
});
