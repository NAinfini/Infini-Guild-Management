// @vitest-environment jsdom
import type { MemberProfile, User } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
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
};
const youtubeUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const profile: MemberProfile = {
  id: "profile-1",
  user_id: user.id,
  power: 1200,
  classes: [],
  title_html: null,
  bio: "Raid coordinator",
  avatar_key: null,
  images: [],
  audio_key: null,
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
    expect(screen.getByText("profile.field.role")).toBeInTheDocument();
    expect(screen.getByText("Guild Member")).toBeInTheDocument();
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
    expect(enCommon["profile.field.role"]).toBe("Role");
    expect(zhCommon["profile.field.role"]).toBe("身份");
    expect("profile.field.activeTime" in enCommon).toBe(false);
    expect("profile.field.activeTime" in zhCommon).toBe(false);
    expect(css).toMatch(
      /\.modalTitle\s*\{[\s\S]*?margin-inline-end:\s*var\(--space-md\)/,
    );
    expect(css).toMatch(
      /\.avatarWrap\s*\{[\s\S]*?width:\s*116px[\s\S]*?height:\s*116px[\s\S]*?border-radius:\s*50%/,
    );
    expect(css).toMatch(
      /\.infoGrid\s*\{[\s\S]*?gap:\s*var\(--space-md\)/,
    );
  });
});
