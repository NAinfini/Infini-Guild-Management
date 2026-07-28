import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AdminPage tab mounting", () => {
  it("does not mount all eight admin panels at once", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/AdminPage.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /<PageTabs\s+defaultValue="member"\s+tabs=\{tabs\}\s+keepMounted=\{false\}>/,
    );
  });
});
