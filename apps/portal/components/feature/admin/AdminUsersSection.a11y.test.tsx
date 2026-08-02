// @vitest-environment jsdom
import type { AdminRole } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";
import {
  AdminUsersSection,
  type AdminUserRow,
} from "./AdminUsersSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { username?: string; count?: number }) => {
      if (options?.username) return `${key} ${options.username}`;
      if (typeof options?.count === "number") return `${key} ${options.count}`;
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

const row = {
  user: {
    id: "user-1",
    username: "Alice",
    role: "member",
    permissions: {},
    is_active: true,
    deleted_at: null,
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
  },
  profile: {
    id: "profile-1",
    user_id: "user-1",
    power: 1234,
    classes: ["mage"],
    title_html: null,
    bio: null,
    avatar_key: null,
    images: [],
    audio_key: null,
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
  is_builtin: true,
  created_at: "2026-07-29T00:00:00.000Z",
  updated_at: "2026-07-29T00:00:00.000Z",
  permissions: {},
  assigned_user_count: 1,
}] as unknown as AdminRole[];

describe("AdminUsersSection accessibility", () => {
  it("opens, selects, and exposes the action menu from the keyboard", async () => {
    const user = userEvent.setup();
    const onOpenMemberDetail = vi.fn();
    const onSelectionChange = vi.fn();

    render(
      <MantineProvider>
        <AdminUsersSection
          usersLoading={false}
          usersError={false}
          isAdmin
          onOpenCreateMember={vi.fn()}
          selectedUserIds={[]}
          batchSelectionLimit={20}
          onBatchRole={vi.fn()}
          onBatchActivate={vi.fn()}
          onBatchDeactivate={vi.fn()}
          onBatchDelete={vi.fn()}
          onSingleRoleChange={vi.fn()}
          onSingleActivate={vi.fn()}
          onSingleDeactivate={vi.fn()}
          onSingleResetPassword={vi.fn()}
          onSingleResetLoginLock={vi.fn()}
          batchRolePending={false}
          batchActivatePending={false}
          batchDeactivatePending={false}
          batchDeletePending={false}
          singleRolePending={false}
          singleActivationPending={false}
          singleResetPasswordPending={false}
          singleResetLoginLockPending={false}
          isBatchPending={false}
          batchProgress={0}
          userRows={[row]}
          userColumns={columns}
          onOpenMemberDetail={onOpenMemberDetail}
          onSelectionChange={onSelectionChange}
          roles={roles}
          memberSearch=""
          onMemberSearchChange={vi.fn()}
        />
      </MantineProvider>,
    );

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
});
