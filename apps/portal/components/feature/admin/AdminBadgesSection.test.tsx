import { screen, within } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
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

/* 样式编辑器要读路由 search 判断只读态，这一屏不挂路由。 */
vi.mock("@portal/hooks/useExternalView", () => ({
  useExternalView: () => false,
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
    isCreating: false,
    form: EMPTY_BADGE_FORM,
    setForm: vi.fn(),
    memberSearch: "",
    setMemberSearch: vi.fn(),
    draftMemberIds: new Set<string>(),
    draftAdded: [],
    draftRemoved: [],
    formDirty: false,
    membershipDirty: false,
    isDirty: false,
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
    selectBadge: vi.fn(),
    discardChanges: vi.fn(),
    toggleDraftMember: vi.fn(),
    formValid: false,
    createBadge: vi.fn(),
    updateBadge: vi.fn(),
    deleteBadge: vi.fn(),
    saveMembership: vi.fn(),
    unassignBadge: vi.fn(),
    reorderBadges: vi.fn(),
    reorderPending: false,
    ...overrides,
  };
}

function member(id: string, display_name: string) {
  return {
    user: { id, display_name },
    profile: { classes: [], power: 0, avatar_media_id: null },
  };
}

const MEMBERS = [member("user-1", "Alice"), member("user-2", "Bob"), member("user-3", "Carol")];

function renderBadges(
  controller: AdminBadgesController,
  userRows: ReturnType<typeof member>[] = [],
) {
  render(<AdminBadgesSection userRows={userRows} controller={controller} />);
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

  /*
   * 标签和颜色只有样式编辑器这一个入口：手写 `<span style>` 的输入框和第二个
   * 取色器已经删掉，应用回来的 HTML 与色号必须一次写进同一份表单。
   */
  it("writes the label markup and its colour back from the one style editor", async () => {
    const user = userEvent.setup();
    const setForm = vi.fn();
    renderBadges(createController({ isCreating: true, setForm }));

    await user.click(screen.getByRole("button", { name: "badges.action.openLabelEditor" }));
    await user.click(screen.getByRole("button", { name: "badges.action.applyLabel" }));

    const updater = setForm.mock.calls[0]?.[0] as (form: typeof EMPTY_BADGE_FORM) => typeof EMPTY_BADGE_FORM;
    const next = updater(EMPTY_BADGE_FORM);
    expect(next.label_html).toContain("badges.placeholder.label");
    expect(next.color, "药丸底色跟着编辑器里挑的那一个走").toBe(EMPTY_BADGE_FORM.color);
  });

  it("shows the selected badge fields immediately, including its current label preview", () => {
    const styled = { ...badge, label_html: '<span style="color:#f00">Veteran</span>' };
    renderBadges(createController({
      selectedBadgeId: styled.id,
      badges: [styled],
      selectedBadge: styled,
      form: { name: styled.name, label_html: styled.label_html, color: styled.color, description: "" },
    }));

    expect(screen.getByLabelText("badges.field.name")).toHaveValue("Veteran");
    expect(document.querySelectorAll("[style*='--badge-color']")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "badges.editTitle" })).toBeNull();
  });

  /* 新建时标签还是空的，空药丸就是一圈没有内容的描边。 */
  it("shows no preview pill until the label has markup", () => {
    renderBadges(createController({ isCreating: true, form: EMPTY_BADGE_FORM }));

    expect(document.querySelectorAll("[style*='--badge-color']")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "badges.action.openLabelEditor" })).toBeTruthy();
  });

  /* 排序不再是一个数字输入框：左栏拖拽是唯一入口，手柄按行给。 */
  it("reorders from the master list instead of a sort-order field", () => {
    const second = { ...badge, id: "badge-2", name: "Champion" };
    renderBadges(createController({ badges: [badge, second], isCreating: true }));

    expect(screen.queryByText("badges.field.sortOrder"), "表单里不该再有排序数字")
      .not.toBeInTheDocument();
    const handles = screen.getAllByRole("button", { name: "badges.aria.dragHandle" });
    expect(handles).toHaveLength(2);
    expect(handles.every((handle) => handle.closest(".admin-md__row") !== null)).toBe(true);
    expect(handles.every((handle) => handle.closest(".admin-md__item") === null)).toBe(true);
  });

  /* 上一次重排还在飞时手柄要锁住，否则两个 PATCH 的响应可能倒序回来。 */
  it("locks the drag handles while a reorder is in flight", () => {
    renderBadges(createController({ badges: [badge], reorderPending: true }));

    expect(screen.getByRole("button", { name: "badges.aria.dragHandle" })).toBeDisabled();
  });

  it("shows the member assignment picker immediately without a manage-members gate", () => {
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
    }), MEMBERS);

    expect(screen.getAllByRole("checkbox")).toHaveLength(MEMBERS.length);
    expect(screen.getByPlaceholderText("badges.searchMembers")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "badges.action.manageMembership" })).toBeNull();
  });

  it("keeps the visible membership picker disabled until assignments are known", () => {
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
      assignmentsLoading: true,
    }), MEMBERS);

    expect(screen.getAllByRole("checkbox")).toHaveLength(MEMBERS.length);
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.getByText("badges.membership.loading")).toBeInTheDocument();
  });

  it("lists every member with a checkbox and only saves a real difference", async () => {
    const user = userEvent.setup();
    const toggleDraftMember = vi.fn();
    const saveMembership = vi.fn();
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
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
    expect(screen.getByRole("button", { name: "badges.action.cancel" })).toBeDisabled();
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
      draftMemberIds: new Set(["user-2"]),
      draftAdded: ["user-2"],
      draftRemoved: ["user-1"],
      membershipDirty: true,
      isDirty: true,
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

  it("keeps the assignment picker present when its baseline fails to load", async () => {
    const user = userEvent.setup();
    const retryAssignments = vi.fn();
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
      assignmentsError: true,
      retryAssignments,
    }), MEMBERS);

    expect(screen.getAllByRole("checkbox")).toHaveLength(MEMBERS.length);
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toHaveAttribute("aria-disabled", "true");
    }

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

  it("keeps the destructive delete confirmation on the immediate editor", async () => {
    const user = userEvent.setup();
    const deleteBadge = vi.fn();
    confirm.mockResolvedValue(true);
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
      deleteBadge,
    }), MEMBERS);

    await user.click(screen.getByRole("button", { name: "badges.action.delete" }));

    expect(confirm).toHaveBeenCalled();
    expect(deleteBadge).toHaveBeenCalledWith(badge.id);
  });
});
