import type { MemberProfile, User } from "@guild/shared";
import { render, screen } from "@testing-library/react";
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

/* 只截数据钩子；resolveClassCatalogItem 是纯函数，空目录下的真实现就是这里
   想要的降级行为。 */
vi.mock("@portal/hooks/data/useClassData", () => ({
  useClassCatalog: () => [],
}));

const user = {
  id: "user-1",
  display_name: "admin",
  role_name: "Admin",
  role_color: "#ef4444",
  created_at: "2026-01-01T00:00:00.000Z",
} as unknown as User;

function renderCard(avatarMediaId: string | null, avatarActions = true) {
  return render(
    <ProfileOverviewCard
      user={user}
      profile={{ avatar_media_id: avatarMediaId, updated_at: "2026-01-02T00:00:00.000Z" } as unknown as MemberProfile}
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
    />,
  );
}

describe("ProfileOverviewCard", () => {
  it("puts the avatar controls on the avatar itself", () => {
    renderCard("avatar1234567890abcde");

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
    renderCard("avatar1234567890abcde", false);

    // 后台成员详情只读地复用这一条。不传回调就不该渲染一层点了没反应的遮罩。
    expect(screen.queryByRole("button", { name: "media.uploadAvatar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "media.removeAvatar" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "admin" })).toBeInTheDocument();
  });

  it("does not repeat the role name next to the display_name", () => {
    renderCard(null);

    // 角色归后台管，本人在自己的资料页改不了它；挂在名字边上只是又一处要维护的重复。
    expect(screen.getByRole("heading", { name: "admin" })).toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });
});
