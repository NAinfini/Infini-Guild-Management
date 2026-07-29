import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readPortalFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Roster MemberCard signature interaction", () => {
  it("keeps the spring tilt, scale and moving specular layer", () => {
    const source = readPortalFile("apps/portal/components/shared/MemberCard.tsx");

    expect(source).toContain("useSpring");
    expect(source).toContain("handlePointerMove");
    expect(source).toContain("handlePointerEnter");
    expect(source).toContain("handlePointerLeave");
    expect(source).toContain("member-card__spec");
    expect(source).toContain("style={{ rotateX, rotateY, scale }}");
  });

  it("keeps reduced-motion handling and the dispersion hover treatment", () => {
    const source = readPortalFile("apps/portal/components/shared/MemberCard.tsx");
    const styles = readPortalFile("apps/portal/components/shared/MemberCard.css");

    expect(source).toContain("useReducedMotion");
    expect(source).toContain('if (prefersReducedMotion || event.pointerType !== "mouse") return');
    expect(styles).toContain(".member-card__frame:hover .member-card--full");
    expect(styles).toContain("--glow-dispersion-cool");
    expect(styles).toContain("--glow-dispersion-mid");
    expect(styles).toContain("--glow-dispersion-warm");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps hover and focus audio owned by the roster controller", () => {
    const page = readPortalFile("apps/portal/components/pages/RosterPage.tsx");
    const controller = readPortalFile("apps/portal/hooks/useRosterPageController.ts");

    expect(page).toContain("onCardMouseEnter={controller.playHoverAudio}");
    expect(page).toContain("onCardFocus={handleCardFocus}");
    expect(controller).toContain("playHoverAudio");
    expect(controller).toContain("stopHoverAudio");
    expect(controller).toContain("audioMuted");
    expect(controller).toContain("audioVolume");
  });

  it("keeps the full card as a native keyboard-focusable button", () => {
    const source = readPortalFile("apps/portal/components/shared/MemberCard.tsx");

    expect(source).toContain("<motion.button");
    expect(source).toContain("onClick={onClick}");
    expect(source).not.toContain("tabIndex={-1}");
  });

  it("keeps mobile hover bleed inside the 12px shell gutter", () => {
    const styles = readPortalFile("apps/portal/components/pages/RosterPage.css");

    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.roster-card-grid,\s*\.roster-virtual-scroll\s*\{[\s\S]*?padding:\s*var\(--space-md\);[\s\S]*?margin:\s*calc\(-1 \* var\(--space-md\)\);/,
    );
  });
});
