// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_BADGE_FORM,
  type AdminBadgesController,
} from "@portal/hooks/useAdminBadgesController";
import { AdminBadgesSection } from "./AdminBadgesSection";

const confirm = vi.hoisted(() => vi.fn());

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirm,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    /* 授予时间要按语言格式化，真实 hook 一直带着 i18n，桩也得带。 */
    i18n: { language: "en" },
  }),
}));

const badge = {
  id: "badge-1",
  name: "Veteran",
  label_html: "Veteran",
  color: "#D4A843",
  description: null,
  sort_order: 0,
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

function createController(
  overrides: Partial<AdminBadgesController> = {},
): AdminBadgesController {
  return {
    selectedBadgeId: null,
    setSelectedBadgeId: vi.fn(),
    editingBadgeId: null,
    isCreating: false,
    form: EMPTY_BADGE_FORM,
    setForm: vi.fn(),
    membershipOpen: false,
    memberSearch: "",
    setMemberSearch: vi.fn(),
    draftMemberIds: new Set<string>(),
    draftAdded: [],
    draftRemoved: [],
    badges: [],
    assignments: [],
    selectedBadge: null,
    assignedUserIds: new Set(),
    badgesLoading: false,
    assignmentsLoading: false,
    badgesError: false,
    assignmentsError: false,
    retryBadges: vi.fn(),
    retryAssignments: vi.fn(),
    createPending: false,
    updatePending: false,
    deletePending: false,
    membershipPending: false,
    unassignPending: false,
    isBadgeDeletePending: () => false,
    isBadgeUnassignPending: () => false,
    startCreate: vi.fn(),
    startEdit: vi.fn(),
    selectBadge: vi.fn(),
    cancelEdit: vi.fn(),
    openMembership: vi.fn(),
    closeMembership: vi.fn(),
    toggleDraftMember: vi.fn(),
    formValid: false,
    createBadge: vi.fn(),
    updateBadge: vi.fn(),
    deleteBadge: vi.fn(),
    saveMembership: vi.fn(),
    unassignBadge: vi.fn(),
    ...overrides,
  };
}

function member(id: string, username: string) {
  return {
    user: { id, username },
    profile: { classes: [], power: 0, avatar_key: null },
  };
}

const MEMBERS = [member("user-1", "Alice"), member("user-2", "Bob"), member("user-3", "Carol")];

function renderBadges(
  controller: AdminBadgesController,
  userRows: ReturnType<typeof member>[] = [],
) {
  render(
    <MantineProvider>
      <ModalsProvider>
        <AdminBadgesSection userRows={userRows} controller={controller} />
      </ModalsProvider>
    </MantineProvider>,
  );
}

describe("AdminBadgesSection", () => {
  /* Master rows are the page's primary custom touch targets. */
  it("keeps the master list rows at real 44px touch targets", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/AdminPage.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const itemRule = css.match(/\.admin-md__item\s*\{([^}]+)\}/)?.[1];

    expect(itemRule).toMatch(/min-block-size:\s*44px/);
  });

  /* 编辑成员是同一个网格换状态，不是另开一块面板：查看态里不该有任何勾选框。 */
  it("edits members in place instead of opening a second panel", async () => {
    const user = userEvent.setup();
    const openMembership = vi.fn();
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
      openMembership,
    }), MEMBERS);

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByPlaceholderText("badges.searchMembers")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "badges.action.manageMembership" }));

    expect(openMembership).toHaveBeenCalledOnce();
  });

  /*
   * 草稿以「当前已分配的人」为起点。分配还没读回来就打开面板，草稿会从空集合起步，
   * 保存出去就是把所有人摘掉——所以这个入口在加载和出错时必须是关着的。
   */
  it("keeps the membership editor shut until assignments are known", () => {
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
      assignmentsLoading: true,
    }));

    expect(screen.getByRole("button", { name: "badges.action.manageMembership" })).toBeDisabled();
  });

  it("lists every member with a checkbox and only saves a real difference", async () => {
    const user = userEvent.setup();
    const toggleDraftMember = vi.fn();
    const saveMembership = vi.fn();
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
      membershipOpen: true,
      /* 已有 Alice：她也在名单里且是勾上的，加人和删人不再是两份名单。 */
      draftMemberIds: new Set(["user-1"]),
      toggleDraftMember,
      saveMembership,
    }), MEMBERS);

    const list = document.querySelector(".pick-list__body") as HTMLElement;
    expect(within(list).getAllByRole("checkbox")).toHaveLength(MEMBERS.length);
    expect(within(list).getByRole("checkbox", { name: "Alice" })).toBeChecked();
    expect(within(list).getByRole("checkbox", { name: "Bob" })).not.toBeChecked();

    const save = screen.getByRole("button", { name: "badges.action.saveMembership" });
    expect(save, "勾选和现状一致时没有可保存的东西").toBeDisabled();
    expect(screen.getByRole("button", { name: "badges.action.cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "badges.membership.selectAll" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "badges.membership.clear" })).not.toBeInTheDocument();
    expect(screen.queryByText("badges.membership.diff")).not.toBeInTheDocument();

    await user.click(within(list).getByRole("checkbox", { name: "Bob" }));
    expect(toggleDraftMember).toHaveBeenCalledWith("user-2");
    expect(saveMembership).not.toHaveBeenCalled();
  });

  it("confirms before a save that would strip the badge from anyone", async () => {
    const user = userEvent.setup();
    const saveMembership = vi.fn();
    confirm.mockResolvedValue(false);
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
      membershipOpen: true,
      draftMemberIds: new Set(["user-2"]),
      draftAdded: ["user-2"],
      draftRemoved: ["user-1"],
      saveMembership,
    }), MEMBERS);

    await user.click(screen.getByRole("button", { name: "badges.action.saveMembership" }));

    expect(confirm).toHaveBeenCalled();
    expect(saveMembership, "确认框点了取消就不能发请求").not.toHaveBeenCalled();
  });

  it("does not misreport a failed badge query as an empty collection", async () => {
    const user = userEvent.setup();
    const retryBadges = vi.fn();
    renderBadges(createController({ badgesError: true, retryBadges }));

    expect(screen.getByText("loadError")).toBeInTheDocument();
    expect(screen.queryByText("badges.empty")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "action.retry" }));

    expect(retryBadges).toHaveBeenCalledOnce();
  });

  it("does not misreport a failed assignment query as no assigned members", async () => {
    const user = userEvent.setup();
    const retryAssignments = vi.fn();
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
      assignmentsError: true,
      retryAssignments,
    }));

    expect(screen.getByText("loadError")).toBeInTheDocument();
    expect(screen.queryByText("badges.noMembers")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "action.retry" }));

    expect(retryAssignments).toHaveBeenCalledOnce();
  });

  it("offers badge creation from the global empty state", async () => {
    const user = userEvent.setup();
    const startCreate = vi.fn();
    renderBadges(createController({ startCreate }));

    const emptyState = screen.getByText("badges.empty").closest(".empty-state");
    expect(emptyState).not.toBeNull();
    await user.click(within(emptyState as HTMLElement).getByRole("button", {
      name: "badges.action.create",
    }));

    expect(startCreate).toHaveBeenCalledOnce();
  });

  it("scopes unassign pending to one member and blocks repeated destructive actions", async () => {
    const user = userEvent.setup();
    const unassignBadge = vi.fn();
    const deleteBadge = vi.fn();
    confirm.mockResolvedValue(true);
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
      assignments: [
        {
          badge_id: badge.id,
          user_id: "user-1",
          username: "Alice",
          assigned_by: "admin-1",
          assigned_at: "2026-07-29T00:00:00.000Z",
        },
        {
          badge_id: badge.id,
          user_id: "user-2",
          username: "Bob",
          assigned_by: "admin-1",
          assigned_at: "2026-07-29T00:00:00.000Z",
        },
      ],
      isBadgeDeletePending: (badgeId) => badgeId === badge.id,
      isBadgeUnassignPending: (badgeId, userId) => badgeId === badge.id && userId === "user-1",
      deleteBadge,
      unassignBadge,
    }));

    const aliceRow = screen.getByText("Alice").closest(".pick-list__row") as HTMLElement;
    const bobRow = screen.getByText("Bob").closest(".pick-list__row") as HTMLElement;
    const aliceUnassign = within(aliceRow).getByRole("button", { name: "badges.action.unassign" });
    const bobUnassign = within(bobRow).getByRole("button", { name: "badges.action.unassign" });
    const deleteButton = screen.getByRole("button", { name: "badges.action.delete" });

    expect(aliceUnassign).toBeDisabled();
    expect(bobUnassign).toBeEnabled();
    expect(deleteButton).toBeDisabled();

    await user.click(aliceUnassign);
    await user.click(aliceUnassign);
    await user.click(deleteButton);
    await user.click(deleteButton);
    expect(unassignBadge).not.toHaveBeenCalled();
    expect(deleteBadge).not.toHaveBeenCalled();
  });

  /* 删除徽章一直有确认，摘徽章却没有——两个都是不可撤销的删除，现在对齐。 */
  it("confirms a single removal before firing it", async () => {
    const user = userEvent.setup();
    const unassignBadge = vi.fn();
    confirm.mockResolvedValue(false);
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
      assignments: [{
        badge_id: badge.id,
        user_id: "user-1",
        username: "Alice",
        assigned_by: "admin-1",
        assigned_by_username: "root",
        assigned_at: "2026-07-29T00:00:00.000Z",
      }],
      unassignBadge,
    }), MEMBERS);

    const list = document.querySelector(".pick-list__body") as HTMLElement;
    const card = within(list).getByText("Alice").closest(".pick-list__row") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "badges.action.unassign" }));

    expect(confirm).toHaveBeenCalled();
    expect(unassignBadge).not.toHaveBeenCalled();

    confirm.mockResolvedValue(true);
    await user.click(within(card).getByRole("button", { name: "badges.action.unassign" }));
    expect(unassignBadge).toHaveBeenCalledWith(badge.id, ["user-1"]);
  });

  it("surfaces when the badge was granted", () => {
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
      assignments: [{
        badge_id: badge.id,
        user_id: "user-1",
        username: "Alice",
        assigned_by: "admin-1",
        assigned_by_username: "root",
        assigned_at: "2026-07-29T00:00:00.000Z",
      }],
    }), MEMBERS);

    expect(screen.getByText("badges.grantedOn")).toBeInTheDocument();
  });
});
