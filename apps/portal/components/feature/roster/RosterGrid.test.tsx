import { PERMISSIONS, type MemberProfile, type Permission, type User } from "@guild/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RosterGrid } from "./RosterGrid";

const virtualizerHarness = vi.hoisted(() => ({
  items: [] as Array<{ key: string; index: number; start: number }>,
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => virtualizerHarness.items,
    getTotalSize: () => 280,
    measureElement: vi.fn(),
  }),
}));

vi.mock("../../shared/MemberCard", () => ({
  MemberCard: ({ user }: { user: User }) => <button type="button">{user.display_name}</button>,
}));

vi.mock("../../../utils/media", () => ({
  resolveMediaUrl: (mediaId: string) => mediaId,
}));

const now = "2026-07-29T12:00:00.000Z";
const noPermissions = Object.fromEntries(
  PERMISSIONS.map((permission) => [permission, false]),
) as Record<Permission, boolean>;
const user: User = {
  id: "user-1",
  display_name: "Aster",
  role: "member",
  role_name: "Member",
  role_color: null,
  role_level: 1,
  permissions: noPermissions,
  is_active: true,
  deleted_at: null,
  created_at: now,
  updated_at: now,
  last_login_at: null,
};
const profile: MemberProfile = {
  user_id: user.id,
  power: 1200,
  classes: [],
  title_html: null,
  bio: null,
  avatar_media_id: null,
  images: [],
  audio_media_id: "audio1234567890abcdef",
  audio_name: "hover.ogg",
  video_urls: [],
  availability: null,
  vacation_start: null,
  vacation_end: null,
  notes: null,
  created_at: now,
  updated_at: now,
};
beforeEach(() => {
  virtualizerHarness.items = [];
});

describe("RosterGrid audio input boundaries", () => {
  it("plays hover audio only for a mouse pointer while retaining keyboard focus audio", () => {
    const onCardMouseEnter = vi.fn();
    const onCardFocus = vi.fn();

    render(
      <RosterGrid
        rows={[{ user, profile }]}
        shouldVirtualize={false}
        ariaLabel="Roster"
        onCardClick={vi.fn()}
        onCardMouseEnter={onCardMouseEnter}
        onCardMouseLeave={vi.fn()}
        onCardFocus={onCardFocus}
        onCardBlur={vi.fn()}
      />,
    );

    const card = screen.getByRole("button", { name: "Aster" });
    const interactionBoundary = card.parentElement;
    expect(interactionBoundary).not.toBeNull();

    fireEvent.pointerEnter(interactionBoundary!, { pointerType: "touch" });
    expect(onCardMouseEnter).not.toHaveBeenCalled();

    fireEvent.pointerEnter(interactionBoundary!, { pointerType: "mouse" });
    expect(onCardMouseEnter).toHaveBeenCalledTimes(1);

    fireEvent.focus(card);
    expect(onCardFocus).toHaveBeenCalledTimes(1);
  });
});

describe("RosterGrid card sizing", () => {
  it("keeps the roster surface as a full-height scroll region below the pinned filters", () => {
    const { container } = render(
      <RosterGrid
        rows={[{ user, profile }]}
        shouldVirtualize={false}
        ariaLabel="Roster"
        onCardClick={vi.fn()}
        onCardMouseEnter={vi.fn()}
        onCardMouseLeave={vi.fn()}
        onCardFocus={vi.fn()}
        onCardBlur={vi.fn()}
      />,
    );

    expect(container.querySelector('[role="list"]')).toHaveClass("roster-grid-region");

    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/RosterPage.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const page = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/RosterPage.tsx"),
      "utf8",
    );

    expect(css).toMatch(/\.roster-page\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/);
    expect(css).toMatch(
      /\.roster-page__body\s*\{[^}]*height:\s*100%[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*min-width:\s*0[^}]*width:\s*100%[^}]*max-width:\s*100%/,
    );
    expect(page).toMatch(
      /<PageLayout\s+className="roster-page"\s+workspaceMode="contained"\s+toolbar=\{/,
    );
    expect(css).toMatch(
      /\.roster-grid-region\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*min-width:\s*0[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*box-sizing:\s*border-box[^}]*overflow-x:\s*clip[^}]*overflow-y:\s*auto/,
    );
  });

  it("keeps the full-height interaction wrapper in every virtual grid cell", () => {
    virtualizerHarness.items = [{ key: "row-0", index: 0, start: 0 }];
    const secondUser = { ...user, id: "user-2", display_name: "Beryl" };
    const secondProfile = { ...profile, user_id: secondUser.id };

    const { container } = render(
      <RosterGrid
        rows={[{ user, profile }, { user: secondUser, profile: secondProfile }]}
        shouldVirtualize
        ariaLabel="Roster"
        onCardClick={vi.fn()}
        onCardMouseEnter={vi.fn()}
        onCardMouseLeave={vi.fn()}
        onCardFocus={vi.fn()}
        onCardBlur={vi.fn()}
      />,
    );

    const cells = [...container.querySelectorAll(".roster-virtual-cell")];
    expect(cells).toHaveLength(2);
    expect(container.querySelector(".roster-virtual-scroll")).toHaveClass("roster-grid-region");
    expect(cells.every((cell) => cell.firstElementChild?.classList.contains("roster-card-interaction"))).toBe(true);

    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/RosterPage.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.roster-virtual-cell\s*\{[^}]*height:\s*100%/);
    expect(css).toMatch(/\.roster-card-interaction\s*\{[^}]*height:\s*100%/);
  });

  it("keeps two browseable cards at 390px without changing the MemberCard interaction wrappers", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/RosterPage.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");

    expect(css).toMatch(
      /@media \(min-width: 390px\) and \(max-width: 767px\)\s*\{\s*\.roster-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(150px,\s*1fr\)\)/,
    );
    expect(css).not.toMatch(/@media \(max-width: 575px\)\s*\{\s*\.roster-card-grid/);
  });
});
