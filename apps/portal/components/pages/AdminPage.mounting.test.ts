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
    /* 窄屏不再塌成 Select：同一个 tablist 换成横向胶囊条，语义和当前位置都保留。 */
    expect(source).toContain('orientation={isCompactNavigation ? "horizontal" : "vertical"}');
    expect(source).toContain("admin-page__workspace--compact");
    expect(source).not.toContain("admin-page__compact-domain-select");
    expect(source).not.toContain('value="gameData"');
    expect(source).not.toContain('orientation={isMobile ? "horizontal"');
    expect(source).not.toContain("PageTabs");
  });
});
