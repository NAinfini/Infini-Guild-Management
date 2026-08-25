import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("RosterPage mobile scroll boundary", () => {
  it("keeps the workspace fixed while the roster region owns vertical scrolling", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/RosterPage.css"),
      "utf8",
    );
    const mobileStart = css.indexOf("@media (max-width: 767px)");
    const workspaceSelector =
      '.page-layout.roster-page[data-workspace-mode="contained"] .page-layout__workspace';
    const workspaceStart = css.indexOf(workspaceSelector, mobileStart);
    const workspaceRule = css.slice(workspaceStart, css.indexOf("}", workspaceStart));
    const rosterRegionRule = css.match(/\.roster-grid-region\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(mobileStart).toBeGreaterThan(-1);
    expect(workspaceStart).toBeGreaterThan(mobileStart);
    expect(workspaceRule).toContain("overflow-y: hidden");
    expect(workspaceRule).toContain("display: flex");
    expect(rosterRegionRule).toContain("overflow-y: auto");
  });
});
