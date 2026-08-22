import type { MemberProfile, User } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { screen } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import enCommon from "../../i18n/en/common.json";
import zhCommon from "../../i18n/zh/common.json";
import { ProfileModal } from "./ProfileModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));

vi.mock("@mantine/carousel", () => ({
  Carousel: Object.assign(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
    { Slide: ({ children }: { children: ReactNode }) => <div>{children}</div> },
  ),
}));

vi.mock("@mantine/hooks", () => ({
  useMediaQuery: () => false,
}));

const now = "2026-08-05T12:00:00.000Z";
const user: User = {
  id: "user-1",
  username: "Aster",
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
      <MantineProvider>
        <ProfileModal
          open
          user={user}
          profile={profile}
          onClose={vi.fn()}
          onEdit={vi.fn()}
          canEdit
        />
      </MantineProvider>,
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

  it("keeps localized account-update copy and the modal spacing contract", () => {
    const css = readFileSync(resolve(
      process.cwd(),
      "apps/portal/components/shared/ProfileModal.module.css",
    ), "utf8");

    expect(enCommon["profile.field.accountUpdated"]).toBe("Account updated");
    expect(zhCommon["profile.field.accountUpdated"]).toBe("账号更新时间");
    expect("profile.field.role" in enCommon).toBe(false);
    expect("profile.field.role" in zhCommon).toBe(false);
    expect("profile.field.activeTime" in enCommon).toBe(false);
    expect("profile.field.activeTime" in zhCommon).toBe(false);
    expect(css).toMatch(
      /\.modalTitle\s*\{[\s\S]*?margin-inline-end:\s*var\(--space-md\)/,
    );
    /* 头部是贴顶的 sticky 条，正文顶边必须自己留出间距，否则第一排格子贴着它。 */
    expect(css).toMatch(
      /\.modalBody:not\(:only-child\)\s*\{[\s\S]*?padding-top:\s*var\(--space-md\)/,
    );
    expect(css).toMatch(
      /\.avatarWrap\s*\{[\s\S]*?width:\s*116px[\s\S]*?height:\s*116px[\s\S]*?border-radius:\s*var\(--radius-surface\)/,
    );
    expect(css).toMatch(
      /\.infoGrid\s*\{[\s\S]*?gap:\s*var\(--space-md\)/,
    );
  });
});
