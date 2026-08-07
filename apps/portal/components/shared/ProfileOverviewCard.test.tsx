// @vitest-environment jsdom
import type { MemberProfile, User } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ProfileOverviewCard } from "./ProfileOverviewCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => vi.fn(),
}));

vi.mock("@portal/components/shared/MemberCard", () => ({
  getMemberStatus: () => "active",
  MemberBadgeChip: () => null,
}));

vi.mock("@portal/stores/class-catalog", () => ({
  useClassCatalogStore: () => [],
  resolveClassCatalogItem: (id: string) => ({ id, label: id, color: "#61B8AA" }),
}));

const user = {
  id: "user-1",
  username: "admin",
  role_name: "Admin",
  role_color: "#ef4444",
  created_at: "2026-01-01T00:00:00.000Z",
} as unknown as User;

const OVERVIEW_CSS = "apps/portal/components/shared/ProfileOverviewCard.css";

function readOverviewCss() {
  return readFileSync(resolve(process.cwd(), OVERVIEW_CSS), "utf8");
}

function renderCard(avatarKey: string | null, avatarActions = true) {
  return render(
    <MantineProvider>
      <ProfileOverviewCard
        user={user}
        profile={{ avatar_key: avatarKey, updated_at: "2026-01-02T00:00:00.000Z" } as unknown as MemberProfile}
        badges={[]}
        power={1000}
        titleHtml=""
        classList={[]}
        imageList={[]}
        videoList={[]}
        availabilityData={null}
        {...(avatarActions
          ? { avatarUploading: false, onUploadAvatar: vi.fn(), onRemoveAvatar: vi.fn() }
          : {})}
      />
    </MantineProvider>,
  );
}

describe("ProfileOverviewCard", () => {
  it("puts the avatar controls on the avatar itself", () => {
    renderCard("profiles/user-1/avatar.webp");

    // 换头像的入口和被改的东西是同一个：不必先想起「媒体卡里有一组叫头像」。
    expect(screen.getByRole("button", { name: "media.uploadAvatar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "media.removeAvatar" })).toBeInTheDocument();
  });

  it("offers removal only when there is an avatar to remove", () => {
    renderCard(null);

    expect(screen.getByRole("button", { name: "media.uploadAvatar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "media.removeAvatar" })).not.toBeInTheDocument();
  });

  it("drops the avatar layer entirely when no callbacks are given", () => {
    renderCard("profiles/user-1/avatar.webp", false);

    // 后台成员详情只读地复用这一条。不传回调就不该渲染一层点了没反应的遮罩。
    expect(screen.queryByRole("button", { name: "media.uploadAvatar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "media.removeAvatar" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "admin" })).toBeInTheDocument();
  });

  it("keeps the controls in the tab order while they are visually collapsed", () => {
    const css = readOverviewCss();

    /* 只能用 opacity 收起来。display:none / visibility:hidden 会把这两个按钮从
       tab 序列里摘掉，键盘用户就再也走不到换头像这一步。 */
    expect(css).toMatch(
      /\.profile-overview__avatar-actions\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?\}/,
    );
    expect(css).toMatch(/\.profile-overview__avatar:focus-within \.profile-overview__avatar-actions/);
    /* 没有 hover 的设备上（触屏）这一层必须常驻，否则入口根本露不出来。 */
    expect(css).toMatch(
      /@media \(hover: none\)\s*\{[\s\S]*?\.profile-overview__avatar-actions\s*\{[\s\S]*?opacity:\s*1/,
    );
  });

  it("keeps the overview avatar at 96px with a strict circular crop", () => {
    const css = readOverviewCss();

    expect(css).toMatch(
      /\.profile-overview__avatar\s*\{[\s\S]*?inline-size:\s*96px[\s\S]*?block-size:\s*96px[\s\S]*?border-radius:\s*50%/,
    );
    /* 概览头像的图片必须脱离网格流：作为网格项时百分比高度和自动行高互为依赖，
       竖构图的头像会被行高按原始比例撑成椭圆。 */
    expect(css).toMatch(
      /\.profile-overview__avatar img\s*\{[\s\S]*?position:\s*absolute[\s\S]*?inset:\s*0[\s\S]*?object-fit:\s*cover/,
    );
  });

  it("does not repeat the role name next to the username", () => {
    renderCard(null);

    // 角色归后台管，本人在自己的资料页改不了它；挂在名字边上只是又一处要维护的重复。
    expect(screen.getByRole("heading", { name: "admin" })).toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });
});
