// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function readPortalFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("shared overlay motion contract", () => {
  it("uses the scale motion tokens with Base UI transition-state attributes", () => {
    const material = readPortalFile("apps/portal/components/ui/overlay-material.ts");
    const dialog = readPortalFile("apps/portal/components/ui/dialog.tsx");
    const alertDialog = readPortalFile("apps/portal/components/ui/alert-dialog.tsx");

    expect(material).toContain("--motion-overlay");
    expect(material).toContain("--motion-panel");
    expect(material).toContain("--motion-state");
    expect(material).toContain("data-starting-style:opacity-0");
    expect(material).toContain("data-ending-style:opacity-0");
    expect(material).toContain("motion-reduce:transition-none");

    for (const source of [dialog, alertDialog]) {
      expect(source).toContain("OVERLAY_BACKDROP_MOTION_CLASS_NAME");
      expect(source).toContain("OVERLAY_SURFACE_MOTION_CLASS_NAME");
      expect(source).not.toMatch(/data-(?:open|closed):animate/);
    }
  });

  it("moves sheets by a full panel from each real edge", () => {
    const sheet = readPortalFile("apps/portal/components/ui/sheet.tsx");

    expect(sheet).toContain("OVERLAY_EDGE_MOTION_CLASS_NAME");
    expect(sheet).toContain("data-[side=bottom]:data-starting-style:translate-y-full");
    expect(sheet).toContain("data-[side=top]:data-starting-style:translate-y-[-100%]");
    expect(sheet).toContain("data-[side=left]:data-starting-style:translate-x-[-100%]");
    expect(sheet).toContain("data-[side=right]:data-starting-style:translate-x-full");
    expect(sheet).not.toContain("2.5rem");
  });

  it("keeps Drawer swipe state selectors while shortening non-swipe exit", () => {
    const drawer = readPortalFile("apps/portal/components/ui/drawer.tsx");

    expect(drawer).toContain("[transition:transform_var(--motion-panel),height_var(--motion-panel),opacity_var(--motion-panel)]");
    expect(drawer).toContain("data-ending-style:[transition:transform_var(--motion-state),height_var(--motion-state),opacity_var(--motion-state)]");
    expect(drawer).toContain("data-swiping:transition-none");
    expect(drawer).toContain("data-ending-style:data-swiping:[transition:");
    expect(drawer).toContain("motion-reduce:data-starting-style:[transform:none]");
    expect(drawer).toContain("motion-reduce:data-ending-style:[transform:none]");
    expect(drawer).not.toContain("transition-[transform,height,opacity,filter]");
  });
});
