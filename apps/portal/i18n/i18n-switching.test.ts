import { afterAll, describe, expect, it } from "vitest";
import i18n, { i18nReady } from "./index";

describe("runtime locale switching", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("keeps both supported locale resources available after initialization", async () => {
    await i18nReady;

    await i18n.changeLanguage("zh");
    expect(i18n.t("dashboard:title")).toBe("仪表盘");
    expect(i18n.t("common:nav.events")).toBe("活动");

    await i18n.changeLanguage("en");
    expect(i18n.t("dashboard:title")).toBe("Dashboard");
    expect(i18n.t("common:nav.events")).toBe("Events");
  });
});
