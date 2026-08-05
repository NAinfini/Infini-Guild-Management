import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AdminPage tab mounting", () => {
  it("does not mount all admin panels at once", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/AdminPage.tsx"),
      "utf8",
    );

    expect(source).toContain("<Tabs");
    expect(source).toContain("keepMounted={false}");
    expect(source).toContain('<Tabs.Panel value="member"');
    /* 紧凑导航仍使用水平 tablist，保留页签语义与当前位置。 */
    expect(source).toContain('orientation={isCompactNavigation ? "horizontal" : "vertical"}');
    expect(source).toContain("admin-page__workspace--compact");
    expect(source).not.toContain("admin-page__compact-domain-select");
    expect(source).not.toContain('value="gameData"');
    expect(source).not.toContain('orientation={isMobile ? "horizontal"');
    expect(source).not.toContain("PageTabs");
  });
});
