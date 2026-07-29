import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AdminPage tab mounting", () => {
  it("does not mount all eight admin panels at once", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/AdminPage.tsx"),
      "utf8",
    );

    expect(source).toContain("<Tabs");
    expect(source).toContain("keepMounted={false}");
    expect(source).toContain('<Tabs.Panel value="member"');
    expect(source).toContain('className="admin-page__mobile-domain-select"');
    expect(source).toContain('orientation="vertical"');
    expect(source).not.toContain('orientation={isMobile ? "horizontal"');
    expect(source).not.toContain("PageTabs");
  });
});
