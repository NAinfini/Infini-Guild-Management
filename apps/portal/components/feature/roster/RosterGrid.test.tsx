import { type MemberProfile, type MemberSummary } from "@guild/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RosterGrid } from "./RosterGrid";

vi.mock("../../shared/MemberCard", () => ({
  MemberCard: ({ user }: { user: MemberSummary }) => <button type="button">{user.display_name}</button>,
}));

vi.mock("../../../utils/media", () => ({
  resolveMediaUrl: (mediaId: string) => mediaId,
}));

const now = "2026-07-29T12:00:00.000Z";
const user: MemberSummary = {
  id: "user-1",
  display_name: "Aster",
  role: "member",
  role_name: "Member",
  role_color: null,
  role_level: 1,
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
describe("RosterGrid audio input boundaries", () => {
  it("plays hover audio only for a mouse pointer while retaining keyboard focus audio", () => {
    const onCardMouseEnter = vi.fn();
    const onCardFocus = vi.fn();

    render(
      <RosterGrid
        rows={[{ user, profile }]}
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
