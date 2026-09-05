// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import i18n, { i18nReady, setI18nLocale } from "./index";

describe("runtime locale switching", () => {
  afterAll(async () => {
    await setI18nLocale("en");
  });

  it("lazy-loads each supported locale before switching", async () => {
    await i18nReady;

    await setI18nLocale("zh");
    expect(i18n.t("dashboard:title")).toBe("总览");
    expect(i18n.t("common:nav.events")).toBe("活动");

    await setI18nLocale("en");
    expect(i18n.t("dashboard:title")).toBe("Dashboard");
    expect(i18n.t("common:nav.events")).toBe("Events");
  });
});
