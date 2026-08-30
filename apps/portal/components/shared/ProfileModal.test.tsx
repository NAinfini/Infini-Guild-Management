import type { MemberProfile, User } from "@guild/shared";
import { screen } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
import { describe, expect, it, vi } from "vitest";
import { ProfileModal } from "./ProfileModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));

const now = "2026-08-05T12:00:00.000Z";
const user: User = {
  id: "user-1",
  display_name: "Aster",
  role: "member",
  role_name: "Guild Member",
  role_color: "#22c55e",
  role_level: 1,
  permissions: {} as User["permissions"],
  is_active: true,
  deleted_at: null,
  created_at: now,
  updated_at: now,
  last_login_at: null,
};
const youtubeUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const profile: MemberProfile = {
  user_id: user.id,
  power: 1200,
  classes: [],
  title_html: null,
  bio: "Raid coordinator",
  avatar_media_id: null,
  images: [],
  audio_media_id: null,
  audio_name: null,
  video_urls: [youtubeUrl],
  availability: null,
  vacation_start: null,
  vacation_end: null,
  notes: null,
  created_at: now,
  updated_at: now,
};

describe("ProfileModal", () => {
  it("labels users.updated_at accurately and loads the CSP-approved video embed", () => {
    render(
      <ProfileModal
        open
        user={user}
        profile={profile}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        canEdit
      />,
    );

    expect(screen.getByText("profile.field.accountUpdated")).toBeInTheDocument();
    /* 身份不再出现在资料里：这是一个人的档案，不是权限面板。 */
    expect(screen.queryByText("profile.field.role")).not.toBeInTheDocument();
    expect(screen.queryByText("Guild Member")).not.toBeInTheDocument();
    expect(screen.queryByText("profile.field.activeTime")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "profile.editProfile" })).toBeInTheDocument();
    expect(screen.getByTitle(youtubeUrl)).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });

});
