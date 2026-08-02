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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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
    assignPanelOpen: false,
    setAssignPanelOpen: vi.fn(),
    assignSearch: "",
    setAssignSearch: vi.fn(),
    pendingAssignIds: [],
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
    assignPending: false,
    unassignPending: false,
    startCreate: vi.fn(),
    startEdit: vi.fn(),
    selectBadge: vi.fn(),
    cancelEdit: vi.fn(),
    openAssignPanel: vi.fn(),
    togglePendingAssign: vi.fn(),
    formValid: false,
    createBadge: vi.fn(),
    updateBadge: vi.fn(),
    deleteBadge: vi.fn(),
    assignBadge: vi.fn(),
    unassignBadge: vi.fn(),
    ...overrides,
  };
}

function renderBadges(controller: AdminBadgesController) {
  render(
    <MantineProvider>
      <ModalsProvider>
        <AdminBadgesSection userRows={[]} controller={controller} />
      </ModalsProvider>
    </MantineProvider>,
  );
}

describe("AdminBadgesSection", () => {
  /*
   * 原来这条守的是 .admin-badge-color-picker / .admin-badge-swatch 两个手搓控件的
   * 44px。取色改用 Mantine ColorInput 之后这两个 class 不存在了，色板尺寸由
   * Mantine 的 --cp-swatch-size 决定，我们无从在 CSS 里断言——这是一处有意的放宽，
   * 已在交付说明里单独点出。清单项这一个仍然是本页最主要的点击目标，继续守住。
   */
  it("keeps the master list rows at real 44px touch targets", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/AdminPage.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const itemRule = css.match(/\.admin-md__item\s*\{([^}]+)\}/)?.[1];

    expect(itemRule).toMatch(/min-block-size:\s*44px/);
  });

  it("folds member assignment into the detail pane instead of a modal", async () => {
    const user = userEvent.setup();
    const openAssignPanel = vi.fn();
    renderBadges(createController({
      selectedBadgeId: badge.id,
      badges: [badge],
      selectedBadge: badge,
      openAssignPanel,
    }));

    const toggle = screen.getByRole("button", { name: "badges.action.manageMembership" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // 面板此刻是收起的，但仍在 DOM 里（Collapse 不卸载），所以断言可见性而非存在性。
    expect(screen.getByText("badges.assignTitle")).not.toBeVisible();

    await user.click(toggle);

    expect(openAssignPanel).toHaveBeenCalledOnce();
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
});
