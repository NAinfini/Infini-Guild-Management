// @vitest-environment jsdom
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

vi.mock("@portal/components/effects", () => ({
  StaggerList: ({ children, staggerMs: _staggerMs, ...props }: React.HTMLAttributes<HTMLDivElement> & { staggerMs?: number }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, variants: _variants, ...props }: React.HTMLAttributes<HTMLDivElement> & { variants?: unknown }) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("../../shared/MemberCard", () => ({
  MemberCard: ({ user }: { user: User }) => <button type="button">{user.username}</button>,
}));

vi.mock("../../../utils/media", () => ({
  resolveProfileMediaUrl: (key: string) => key,
}));

const now = "2026-07-29T12:00:00.000Z";
const noPermissions = Object.fromEntries(
  PERMISSIONS.map((permission) => [permission, false]),
) as Record<Permission, boolean>;
const user: User = {
  id: "user-1",
  username: "Aster",
  role: "member",
  role_name: "Member",
  role_color: null,
  role_level: 1,
  permissions: noPermissions,
  is_active: true,
  deleted_at: null,
  created_at: now,
  updated_at: now,
};
const profile: MemberProfile = {
  id: "profile-1",
  user_id: user.id,
  power: 1200,
  classes: [],
  title_html: null,
  bio: null,
  avatar_key: null,
  images: [],
  audio_key: "profiles/user-1/hover.mp3",
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
        columnCount={1}
        staggerKey="all"
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
  it("keeps the full-height interaction wrapper in every virtual grid cell", () => {
    virtualizerHarness.items = [{ key: "row-0", index: 0, start: 0 }];
    const secondUser = { ...user, id: "user-2", username: "Beryl" };
    const secondProfile = { ...profile, id: "profile-2", user_id: secondUser.id };

    const { container } = render(
      <RosterGrid
        rows={[{ user, profile }, { user: secondUser, profile: secondProfile }]}
        shouldVirtualize
        columnCount={2}
        staggerKey="all"
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
    expect(cells.every((cell) => cell.firstElementChild?.classList.contains("roster-card-interaction"))).toBe(true);

    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/RosterPage.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.roster-virtual-cell\s*\{[^}]*height:\s*100%/);
    expect(css).toMatch(/\.roster-card-interaction\s*\{[^}]*height:\s*100%/);
  });

  it("switches the non-virtual roster to one readable column below 576px", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/RosterPage.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");

    expect(css).toMatch(
      /@media \(max-width: 575px\)\s*\{\s*\.roster-card-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });
});
