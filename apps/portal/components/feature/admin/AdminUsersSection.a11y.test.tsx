import type { AdminRole } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DataTableColumnDef } from "@portal/components/shared/data-table-features";
import { describe, expect, it, vi } from "vitest";
import {
  AdminUsersSection,
  type AdminUserRow,
} from "./AdminUsersSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { display_name?: string; count?: number; seconds?: number }) => {
      if (options?.display_name) return `${key} ${options.display_name}`;
      if (typeof options?.count === "number") return `${key} ${options.count}`;
      if (typeof options?.seconds === "number") return `${key} ${options.seconds}`;
      return key;
    },
  }),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 42,
        end: (index + 1) * 42,
      })),
    getTotalSize: () => count * 42,
    measureElement: vi.fn(),
  }),
}));

vi.mock("../../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: { role_level: number } }) => unknown) =>
    selector({ user: { role_level: 999 } }),
}));

const row = {
  user: {
    id: "user-1",
    display_name: "Alice",
    role: "member",
    role_name: "Member",
    role_color: null,
    role_level: 10,
    is_active: true,
    deleted_at: null,
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
  },
  profile: {
    user_id: "user-1",
    power: 1234,
    classes: ["mage"],
    title_html: null,
    bio: null,
    avatar_media_id: null,
    images: [],
    audio_media_id: null,
    audio_name: null,
    video_urls: [],
    availability: null,
    vacation_start: null,
    vacation_end: null,
    notes: null,
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
  },
  badges: [],
} as unknown as AdminUserRow;

const columns: DataTableColumnDef<AdminUserRow>[] = [{
  id: "display_name",
  header: "Username",
  cell: ({ row: tableRow }) => tableRow.original.user.display_name,
}];

const roles = [{
  id: "member",
  name: "Member",
  level: 10,
  color: null,
  created_at: "2026-07-29T00:00:00.000Z",
  updated_at: "2026-07-29T00:00:00.000Z",
  permissions: {},
  assigned_user_count: 1,
}] as unknown as AdminRole[];

const secondRow = {
  ...row,
  user: {
    ...row.user,
    id: "user-2",
    display_name: "Bob",
  },
  profile: {
    ...row.profile,
    user_id: "user-2",
  },
} as AdminUserRow;

function expectMenuItemState(item: HTMLElement, disabled: boolean) {
  if (disabled) {
    expect(item).toHaveAttribute("aria-disabled", "true");
    return;
  }

  expect(item).not.toHaveAttribute("aria-disabled", "true");
}

function renderUsers(
  overrides: Partial<React.ComponentProps<typeof AdminUsersSection>> = {},
) {
  const props: React.ComponentProps<typeof AdminUsersSection> = {
    usersLoading: false,
    usersError: false,
    onRetryUsers: vi.fn(),
    canEditUsers: true,
    canAssignUserRoles: true,
    canActivateUsers: true,
    canDeleteUsers: true,
    canResetUserPasswords: true,
    onOpenCreateMember: vi.fn(),
    selectedUserIds: [],
    onBatchRole: vi.fn(),
    onBatchActivate: vi.fn(),
    onBatchDeactivate: vi.fn(),
    onBatchDelete: vi.fn(),
    onSingleRoleChange: vi.fn(),
    onSingleActivate: vi.fn(),
    onSingleDeactivate: vi.fn(),
    onSingleResetPassword: vi.fn(),
    batchRolePending: false,
    batchActivatePending: false,
    batchDeactivatePending: false,
    batchDeletePending: false,
    isSingleActionPending: () => false,
    userRows: [row],
    userColumns: columns,
    onOpenMemberDetail: vi.fn(),
    onSelectionChange: vi.fn(),
    roles,
    memberStats: { total: 1, active: 1, inactive: 0, management_access: 0, directory_total: 1 },
    totalRows: 1,
    pagination: { pageIndex: 0, pageSize: 20 },
    onPaginationChange: vi.fn(),
    sorting: [],
    onSortingChange: vi.fn(),
    statusFilter: "all",
    onStatusFilterChange: vi.fn(),
    memberSearch: "",
    onMemberSearchChange: vi.fn(),
    ...overrides,
  };

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renderSection = (sectionProps: React.ComponentProps<typeof AdminUsersSection>) => (
    <QueryClientProvider client={queryClient}>
      <AdminUsersSection {...sectionProps} />
    </QueryClientProvider>
  );
  const view = render(renderSection(props));

  return {
    props,
    rerenderUsers: (
      nextOverrides: Partial<React.ComponentProps<typeof AdminUsersSection>>,
    ) => view.rerender(renderSection({ ...props, ...nextOverrides })),
  };
}

describe("AdminUsersSection accessibility", () => {
  it("renders server totals independently of the visible page and assignable roles", () => {
    const { rerenderUsers } = renderUsers({
      userRows: [row],
      roles: [],
      memberStats: { total: 1000, active: 800, inactive: 200, management_access: 37, directory_total: 1000 },
    });
    const managementStat = () => screen.getByText("member.stat.managementAccess").parentElement!;
    expect(within(managementStat()).getByText("37")).toBeInTheDocument();
    expect(within(screen.getByText("member.stat.total").parentElement!).getByText("1000")).toBeInTheDocument();
    rerenderUsers({ memberStats: { total: 1000, active: 800, inactive: 200, management_access: 36, directory_total: 1000 } });
    expect(within(managementStat()).getByText("36")).toBeInTheDocument();
  });

  it("does not invent management counts before aggregate data arrives", () => {
    renderUsers({ memberStats: null });
    expect(screen.queryByText("member.stat.managementAccess")).not.toBeInTheDocument();
  });
  it.each([
    { canEditUsers: false, canAssignUserRoles: true, roles },
    { canEditUsers: true, canAssignUserRoles: false, roles },
    { canEditUsers: true, canAssignUserRoles: true, roles: [] },
  ])("offers creation only with both permissions and an available assignable role", async (overrides) => {
    renderUsers(overrides);
    expect(screen.queryByRole("button", { name: "member.create.button" })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "member.action.menu" })[0]!);
    await waitFor(() => expect(document.querySelector("[data-admin-user-action-menu]")).not.toBeNull());
    const menu = document.querySelector("[data-admin-user-action-menu]") as HTMLElement;
    expect(within(menu).queryByRole("menuitem", { name: "member.context.createMember", hidden: true })).not.toBeInTheDocument();
  });

  it("keeps search and creation visible while account status uses the shared filter menu", async () => {
    const user = userEvent.setup();
    renderUsers();

    expect(screen.queryByText(/admin-fill/)).not.toBeInTheDocument();
    expect(screen.getByText("member.accountStatusDescription")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "member.search.aria" })).toBeVisible();
    expect(screen.getByRole("button", { name: "member.create.button" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "member.action.menu" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common:filter.toggle" }));
    const filters = within(await screen.findByRole("dialog"));
    expect(filters.getByRole("radiogroup", { name: "member.filter.status" })).toBeInTheDocument();
    expect(filters.getByRole("radio", { name: "member.status.active" })).toBeInTheDocument();
    expect(filters.getByRole("radio", { name: "member.status.inactive" })).toBeInTheDocument();
  });

  it("emits server pagination changes and keeps the search mounted during a page request", async () => {
    const user = userEvent.setup();
    const onPaginationChange = vi.fn();
    const { rerenderUsers } = renderUsers({ totalRows: 1000, onPaginationChange });
    const search = screen.getByRole("textbox", { name: "member.search.aria" });
    await user.click(screen.getAllByRole("button", { name: "pagination.next" })[0]!);
    expect(onPaginationChange).toHaveBeenCalled();
    const update = onPaginationChange.mock.calls.at(-1)![0] as (state: { pageIndex: number; pageSize: number }) => { pageIndex: number; pageSize: number };
    expect(update({ pageIndex: 0, pageSize: 20 })).toEqual({ pageIndex: 1, pageSize: 20 });
    rerenderUsers({ usersLoading: true, totalRows: 0, userRows: [], pagination: { pageIndex: 1, pageSize: 20 } });
    expect(screen.getByRole("textbox", { name: "member.search.aria" })).toBe(search);
    rerenderUsers({ memberSearch: "Alice", userRows: [row], pagination: { pageIndex: 0, pageSize: 20 } });
    expect(screen.getByRole("row", { name: "member.aria.row Alice" })).toBeInTheDocument();
  });
  it("uses Enabled and Disabled terminology in both admin locales", () => {
    const load = (language: "en" | "zh") => JSON.parse(readFileSync(
      resolve(process.cwd(), `apps/portal/i18n/${language}/admin.json`),
      "utf8",
    )) as Record<string, string>;

    const en = load("en");
    const zh = load("zh");
    expect([en["member.status.active"], en["member.status.inactive"]]).toEqual(["Enabled", "Disabled"]);
    expect([zh["member.status.active"], zh["member.status.inactive"]]).toEqual(["启用", "停用"]);
    expect(en["member.accountStatusDescription"]).toContain("roster availability");
    expect(zh["member.accountStatusDescription"]).toContain("名册");
  });

  it("opens, selects, and exposes the action menu from the keyboard", async () => {
    const user = userEvent.setup();
    const onOpenMemberDetail = vi.fn();
    const onSelectionChange = vi.fn();

    renderUsers({ onOpenMemberDetail, onSelectionChange });

    const tableRow = screen.getByRole("row", { name: "member.aria.row Alice" });
    tableRow.focus();
    await user.keyboard("{Enter}");
    expect(onOpenMemberDetail).toHaveBeenCalledWith("user-1");

    await user.keyboard(" ");
    expect(onSelectionChange).toHaveBeenCalledWith(["user-1"]);

    await user.keyboard("{Shift>}{F10}{/Shift}");
    /*
     * jsdom 没有布局，Base UI 的浮层定位在异步帧完成前后都会变更可见性；
     * 这里检查菜单语义和焦点，不把该无布局环境中的显示状态当成行为契约。
     */
    const detailItem = await screen.findByRole("menuitem", { name: "member.action.detail", hidden: true });
    await waitFor(() => expect(detailItem).toHaveAttribute("data-highlighted"));

    expect(
      screen.getByRole("button", { name: "member.action.openDetailAria Alice" }),
    ).toBeInTheDocument();
  });

  it("opens a row context menu at the pointer coordinates", async () => {
    renderUsers();

    fireEvent.contextMenu(screen.getByRole("row", { name: "member.aria.row Alice" }), {
      clientX: 137,
      clientY: 251,
    });

    const menu = await waitFor(() => {
      const current = document.querySelector("[data-admin-user-action-menu]");
      expect(current).not.toBeNull();
      return current as HTMLElement;
    });
    const positioner = menu.parentElement;

    await waitFor(() => {
      const coordinates = positioner?.style.transform.match(
        /translate\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px\)/,
      );
      expect(coordinates).not.toBeNull();
      expect(Number(coordinates?.[1])).toBe(137);
      expect(Math.abs(Number(coordinates?.[2]) - 251)).toBeLessThanOrEqual(8);
    });
  });

  it("keeps another member's action menu usable while one member action is pending", async () => {
    const user = userEvent.setup();
    const onSingleResetPassword = vi.fn();
    const pendingActions = new Set([
      "user-1:change-role",
      "user-1:deactivate",
      "user-1:reset-password",
    ]);
    renderUsers({
      userRows: [row, secondRow],
      onSingleResetPassword,
      isSingleActionPending: (userId, action) => pendingActions.has(`${userId}:${action}`),
    });

    const actionButtons = screen.getAllByRole("button", { name: "member.action.menu" });
    fireEvent.click(actionButtons[0]!);

    let menu: HTMLElement | null = null;
    await waitFor(() => {
      menu = document.querySelector("[data-admin-user-action-menu]");
      expect(menu).not.toBeNull();
    });
    const aliceMenu = menu as unknown as HTMLElement;
    expectMenuItemState(within(aliceMenu).getByRole("menuitem", { name: "member.context.changeRole", hidden: true }), true);
    expectMenuItemState(within(aliceMenu).getByRole("menuitem", { name: "member.deactivate", hidden: true }), true);
    expectMenuItemState(within(aliceMenu).getByRole("menuitem", { name: "member.context.delete", hidden: true }), false);
    expect(within(aliceMenu).getAllByRole("menuitem", { name: "member.deactivate", hidden: true })).toHaveLength(1);
    const resetPassword = within(aliceMenu).getByRole("menuitem", { name: "member.resetPassword", hidden: true });
    expectMenuItemState(resetPassword, true);

    await user.click(resetPassword);
    await user.click(resetPassword);
    expect(onSingleResetPassword).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(document.querySelector("[data-admin-user-action-menu]")).toBeNull();
    });
    fireEvent.contextMenu(screen.getByRole("row", { name: "member.aria.row Bob" }), {
      clientX: 10,
      clientY: 10,
    });
    await waitFor(() => {
      const openMenu = document.querySelector("[data-admin-user-action-menu]") as HTMLElement | null;
      expect(openMenu).not.toBeNull();
      expect(within(openMenu as HTMLElement).getByText("Bob")).toBeInTheDocument();
      menu = openMenu;
    });
    const bobMenu = menu as unknown as HTMLElement;
    expectMenuItemState(within(bobMenu).getByRole("menuitem", { name: "member.context.changeRole", hidden: true }), false);
    expectMenuItemState(within(bobMenu).getByRole("menuitem", { name: "member.deactivate", hidden: true }), false);
    expectMenuItemState(within(bobMenu).getByRole("menuitem", { name: "member.context.delete", hidden: true }), false);
    expect(within(bobMenu).getAllByRole("menuitem", { name: "member.deactivate", hidden: true })).toHaveLength(1);
    expectMenuItemState(within(bobMenu).getByRole("menuitem", { name: "member.resetPassword", hidden: true }), false);
  });

  it("keeps password reset confirmation mounted after closing its action menu", async () => {
    renderUsers();

    fireEvent.click(screen.getAllByRole("button", { name: "member.action.menu" })[0]!);
    const menu = await waitFor(() => {
      const current = document.querySelector("[data-admin-user-action-menu]");
      expect(current).not.toBeNull();
      return current as HTMLElement;
    });

    const resetPassword = within(menu).getByRole("menuitem", {
      name: "member.resetPassword",
      hidden: true,
    });
    expectMenuItemState(resetPassword, false);
    fireEvent.click(resetPassword);

    const dialog = await screen.findByRole("dialog", { name: "member.resetPassword.confirmTitle" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByLabelText("member.resetPassword.currentPasswordLabel")).toBeVisible();
    expect(document.querySelector("[data-admin-user-action-menu]")).toBeNull();
  });

  it("gates each write action with its matching permission", async () => {
    renderUsers({
      canEditUsers: false,
      canAssignUserRoles: false,
      canActivateUsers: true,
      canDeleteUsers: false,
      canResetUserPasswords: false,
    });

    fireEvent.click(screen.getAllByRole("button", { name: "member.action.menu" })[0]!);
    let menu: HTMLElement | null = null;
    await waitFor(() => {
      menu = document.querySelector("[data-admin-user-action-menu]");
      expect(menu).not.toBeNull();
    });
    const actions = within(menu as unknown as HTMLElement);

    expectMenuItemState(actions.getByRole("menuitem", { name: "member.context.changeRole", hidden: true }), true);
    expectMenuItemState(actions.getByRole("menuitem", { name: "member.deactivate", hidden: true }), false);
    expectMenuItemState(actions.getByRole("menuitem", { name: "member.context.delete", hidden: true }), true);
    expectMenuItemState(actions.getByRole("menuitem", { name: "member.resetPassword", hidden: true }), true);
    expect(actions.queryByRole("menuitem", { name: "member.context.createMember", hidden: true })).toBeNull();
  });

  it("limits context batch actions to selected members on the current filtered page", async () => {
    const user = userEvent.setup();
    const onBatchDelete = vi.fn();
    const userRows = Array.from({ length: 22 }, (_, index) => {
      const number = index + 1;
      return {
        ...row,
        user: {
          ...row.user,
          id: `user-${number}`,
          display_name: `User ${number}`,
          is_active: number !== 3,
        },
        profile: {
          ...row.profile,
          user_id: `user-${number}`,
        },
      } as AdminUserRow;
    });

    const { rerenderUsers, props } = renderUsers({
      userRows: userRows.slice(0, 20),
      totalRows: 22,
      selectedUserIds: ["user-1", "user-2", "user-3", "user-22"],
      onBatchDelete,
    });

    await user.click(screen.getByRole("button", { name: "common:filter.toggle" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("radio", {
      name: "member.status.active",
    }));
    expect(props.onStatusFilterChange).toHaveBeenCalledWith("active");
    rerenderUsers({
      userRows: userRows.filter((entry) => entry.user.is_active).slice(0, 20),
      statusFilter: "active",
      totalRows: 21,
    });    await waitFor(() => {
      expect(screen.queryByRole("row", { name: "member.aria.row User 3" })).not.toBeInTheDocument();
      expect(screen.queryByRole("row", { name: "member.aria.row User 22" })).not.toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByRole("row", { name: "member.aria.row User 1" }), {
      clientX: 10,
      clientY: 10,
    });

    let menu: HTMLElement | null = null;
    await waitFor(() => {
      menu = document.querySelector("[data-admin-user-action-menu]");
      expect(menu).not.toBeNull();
    });
    fireEvent.click(within(menu as unknown as HTMLElement).getByRole("menuitem", {
      name: "member.context.batchDelete",
      hidden: true,
    }));

    expect(onBatchDelete).toHaveBeenCalledWith(["user-1", "user-2"]);
  });
});
