// @vitest-environment jsdom
import { PERMISSIONS, type MemberProfile, type Permission, type User } from "@guild/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RosterGrid } from "./RosterGrid";

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
