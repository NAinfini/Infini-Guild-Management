import type { AdminRole } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ColumnDef } from "@tanstack/react-table";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminUsersSection,
  type AdminUserRow,
} from "./AdminUsersSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { username?: string; count?: number; seconds?: number }) => {
      if (options?.username) return `${key} ${options.username}`;
      if (typeof options?.count === "number") return `${key} ${options.count}`;
      if (typeof options?.seconds === "number") return `${key} ${options.seconds}`;
      return key;
    },
  }),
}));

const adminServiceMocks = vi.hoisted(() => ({
  fetchAdminUserLoginLock: vi.fn(),
}));

vi.mock("../../../services/AdminService", () => adminServiceMocks);

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
    username: "Alice",
    role: "member",
    role_name: "Member",
    role_color: null,
    role_level: 10,
    permissions: {},
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

const columns: ColumnDef<AdminUserRow, unknown>[] = [{
  id: "username",
  header: "Username",
  cell: ({ row: tableRow }) => tableRow.original.user.username,
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
    username: "Bob",
  },
  profile: {
    ...row.profile,
    user_id: "user-2",
  },
} as AdminUserRow;

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
    onSingleResetLoginLock: vi.fn(),
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
    memberSearch: "",
    onMemberSearchChange: vi.fn(),
    ...overrides,
  };

  render(
    <QueryClientProvider client={new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })}>
      <MantineProvider>
        <AdminUsersSection {...props} />
      </MantineProvider>
    </QueryClientProvider>,
  );

  return props;
}

beforeEach(() => {
  adminServiceMocks.fetchAdminUserLoginLock.mockReset();
  adminServiceMocks.fetchAdminUserLoginLock.mockResolvedValue({
    fail_count: 0,
    locked_until: null,
    is_locked: false,
    retry_after_seconds: 0,
  });
});

describe("AdminUsersSection accessibility", () => {
  it("explains that account status is separate from roster availability", () => {
    renderUsers();

    expect(screen.getByText("member.accountStatusDescription")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "member.status.active" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "member.status.inactive" })).toBeInTheDocument();
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
     * hidden: true 的理由同 AvailabilityEditor.test.tsx：jsdom 里元素没有布局，
     * floating-ui 的 hide 中间件会给已经打开的 Menu.Dropdown 盖上 display: none，
     * 而定位计算是异步的——查得早就能看见、查得晚就看不见，纯计时抖动。
     */
    const detailItem = await screen.findByRole("menuitem", { name: "member.action.detail", hidden: true });
    await user.keyboard("{ArrowDown}");
    expect(detailItem).toHaveFocus();

    expect(
      screen.getByRole("button", { name: "member.action.openDetailAria Alice" }),
    ).toBeInTheDocument();
  });

  it("keeps another member's action menu usable while one member action is pending", async () => {
    const user = userEvent.setup();
    const onSingleResetPassword = vi.fn();
    const pendingActions = new Set([
      "user-1:change-role",
      "user-1:deactivate",
      "user-1:reset-password",
      "user-1:reset-login-lock",
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
    expect(within(aliceMenu).getByRole("menuitem", { name: "member.context.changeRole", hidden: true })).toBeDisabled();
    expect(within(aliceMenu).getByRole("menuitem", { name: "member.deactivate", hidden: true })).toBeDisabled();
    expect(within(aliceMenu).getByRole("menuitem", { name: "member.context.delete", hidden: true })).toBeEnabled();
    expect(within(aliceMenu).getAllByRole("menuitem", { name: "member.deactivate", hidden: true })).toHaveLength(1);
    const resetPassword = within(aliceMenu).getByRole("menuitem", { name: "member.resetPassword", hidden: true });
    expect(resetPassword).toBeDisabled();
    expect(within(aliceMenu).getByRole("menuitem", { name: "member.resetLoginLock", hidden: true })).toBeDisabled();

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
    expect(within(bobMenu).getByRole("menuitem", { name: "member.context.changeRole", hidden: true })).toBeEnabled();
    expect(within(bobMenu).getByRole("menuitem", { name: "member.deactivate", hidden: true })).toBeEnabled();
    expect(within(bobMenu).getByRole("menuitem", { name: "member.context.delete", hidden: true })).toBeEnabled();
    expect(within(bobMenu).getAllByRole("menuitem", { name: "member.deactivate", hidden: true })).toHaveLength(1);
    expect(within(bobMenu).getByRole("menuitem", { name: "member.resetPassword", hidden: true })).toBeEnabled();
    expect(within(bobMenu).getByRole("menuitem", { name: "member.resetLoginLock", hidden: true })).toBeEnabled();
  });

  it("shows the current login lock and passes it into the reset confirmation flow", async () => {
    const lockState = {
      fail_count: 4,
      locked_until: "2026-08-09T12:00:45.000Z",
      is_locked: true,
      retry_after_seconds: 45,
    };
    adminServiceMocks.fetchAdminUserLoginLock.mockResolvedValueOnce(lockState);
    const onSingleResetLoginLock = vi.fn().mockResolvedValue(undefined);
    renderUsers({ onSingleResetLoginLock });

    fireEvent.click(screen.getAllByRole("button", { name: "member.action.menu" })[0]!);
    let menu: HTMLElement | null = null;
    await waitFor(() => {
      menu = document.querySelector("[data-admin-user-action-menu]");
      expect(menu).not.toBeNull();
      expect(within(menu as HTMLElement).getByText("member.loginLock.locked 45")).toBeInTheDocument();
    });

    fireEvent.click(within(menu as unknown as HTMLElement).getByRole("menuitem", {
      name: "member.resetLoginLock",
      hidden: true,
    }));

    expect(adminServiceMocks.fetchAdminUserLoginLock).toHaveBeenCalledWith("user-1");
    expect(onSingleResetLoginLock).toHaveBeenCalledWith("user-1", lockState);
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

    expect(actions.getByRole("menuitem", { name: "member.context.changeRole", hidden: true })).toBeDisabled();
    expect(actions.getByRole("menuitem", { name: "member.deactivate", hidden: true })).toBeEnabled();
    expect(actions.getByRole("menuitem", { name: "member.context.delete", hidden: true })).toBeDisabled();
    expect(actions.getByRole("menuitem", { name: "member.resetPassword", hidden: true })).toBeDisabled();
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
          username: `User ${number}`,
          is_active: number !== 3,
        },
        profile: {
          ...row.profile,
          user_id: `user-${number}`,
        },
      } as AdminUserRow;
    });

    renderUsers({
      userRows,
      selectedUserIds: ["user-1", "user-2", "user-3", "user-22"],
      onBatchDelete,
    });

    await user.click(screen.getByRole("radio", { name: "member.status.active" }));
    await waitFor(() => {
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
