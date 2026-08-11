import type { AdminRole } from "@guild/shared";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Menu,
  Paper,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { CopyIcon, EyeIcon, KeyIcon, LockOpenIcon, PlayIcon, PlayerPauseIcon, SearchIcon, TrashIcon, UserPlusIcon } from "@portal/components/icons";
import { IconDotsVertical } from "@tabler/icons-react";
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { DataTableAdapter } from "@portal/components/shared/DataTableAdapter";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClipboard } from "@mantine/hooks";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { DataTablePagination } from "../../shared/DataTablePagination";
import type { UsersListResponse } from "../../../services/UserService";
import { resolveClassCatalogItem, useClassCatalogStore } from "../../../stores/class-catalog";
import type { AdminUserPendingAction } from "../../../hooks/useAdminMutations";
import { useAuthStore } from "../../../stores/auth";
import { canManageUserByRoleLevel, userCanAccessAdmin } from "../../../utils/permissions";
import type { AdminLoginLockState } from "../../../services/AdminService";
import { useAdminUserLoginLock } from "../../../hooks/useAdminUserLoginLock";

export type AdminUserRow = UsersListResponse["data"][number];

type ActionMenuContext = {
  userIds: string[];
  x: number;
  y: number;
  returnFocusTo: HTMLElement | null;
};

type AdminUsersSectionProps = {
  usersLoading: boolean;
  usersError: boolean;
  canEditUsers: boolean;
  canAssignUserRoles: boolean;
  canActivateUsers: boolean;
  canDeleteUsers: boolean;
  canResetUserPasswords: boolean;
  onOpenCreateMember: () => void;
  selectedUserIds: string[];
  onBatchRole: (userIds: string[], role: string, roleName: string) => void;
  onBatchActivate: (userIds: string[]) => void;
  onBatchDeactivate: (userIds: string[]) => void;
  onBatchDelete: (userIds: string[]) => void;
  onSingleRoleChange: (userId: string, role: string) => void;
  onSingleActivate: (userId: string) => void;
  onSingleDeactivate: (userId: string) => void;
  onSingleResetPassword: (userId: string) => void;
  onSingleResetLoginLock: (userId: string, lockState: AdminLoginLockState) => void | Promise<void>;
  batchRolePending: boolean;
  batchActivatePending: boolean;
  batchDeactivatePending: boolean;
  batchDeletePending: boolean;
  isSingleActionPending: (userId: string, action: AdminUserPendingAction) => boolean;
  userRows: AdminUserRow[];
  userColumns: ColumnDef<AdminUserRow, unknown>[];
  onOpenMemberDetail: (userId: string) => void;
  onSelectionChange: (keys: string[]) => void;
  roles: AdminRole[];
  memberSearch: string;
  onMemberSearchChange: (value: string) => void;
};

export function AdminUsersSection({
  usersLoading,
  usersError,
  canEditUsers,
  canAssignUserRoles,
  canActivateUsers,
  canDeleteUsers,
  canResetUserPasswords,
  onOpenCreateMember,
  selectedUserIds,
  onBatchRole,
  onBatchActivate,
  onBatchDeactivate,
  onBatchDelete,
  onSingleRoleChange,
  onSingleActivate,
  onSingleDeactivate,
  onSingleResetPassword,
  onSingleResetLoginLock,
  batchRolePending,
  batchActivatePending,
  batchDeactivatePending,
  batchDeletePending,
  isSingleActionPending,
  userRows,
  userColumns,
  onOpenMemberDetail,
  onSelectionChange,
  roles,
  memberSearch,
  onMemberSearchChange,
}: AdminUsersSectionProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const classCatalog = useClassCatalogStore((state) => state.items);
  const clipboard = useClipboard();
  const currentUser = useAuthStore((state) => state.user);
  const loadErrorMessage = tc("loadError");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenuContext | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const selectedIdSet = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);
  const usersById = useMemo(() => new Map(userRows.map((row) => [row.user.id, row])), [userRows]);

  /* userRows 已经在 controller 里按搜索词过滤过，全部成员都在内存里，所以
     启用/停用这一层纯粹是视图筛选，不用再发请求。 */
  const memberStats = useMemo(() => {
    let active = 0;
    let managementAccess = 0;
    for (const row of userRows) {
      if (row.user.is_active) active += 1;
      if (userCanAccessAdmin(row.user)) managementAccess += 1;
    }
    return { total: userRows.length, active, inactive: userRows.length - active, managementAccess };
  }, [userRows]);

  const visibleRows = useMemo(() => {
    if (statusFilter === "all") return userRows;
    const wantActive = statusFilter === "active";
    return userRows.filter((row) => row.user.is_active === wantActive);
  }, [userRows, statusFilter]);

  // A changed status filter invalidates the current page index.
  useEffect(() => {
    setPagination((previous) => (previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 }));
  }, [statusFilter]);

  const openActionMenu = useCallback((
    userId: string,
    event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const userIds = selectedIdSet.has(userId) && selectedUserIds.length > 0
      ? selectedUserIds
      : [userId];
    const targetRect = event.currentTarget.getBoundingClientRect();
    const openedFromContextMenu = event.type === "contextmenu" && "clientX" in event;

    if (!selectedIdSet.has(userId)) {
      onSelectionChange([userId]);
      setSelectionAnchorId(userId);
    }

    setActionMenu({
      userIds,
      x: openedFromContextMenu ? event.clientX : targetRect.right,
      y: openedFromContextMenu ? event.clientY : targetRect.bottom,
      returnFocusTo: openedFromContextMenu ? null : event.currentTarget,
    });
  }, [onSelectionChange, selectedIdSet, selectedUserIds]);

  useEffect(() => {
    if (!actionMenu) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>("[data-admin-user-action-menu] [data-menu-item]:not([data-disabled])")
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [actionMenu]);

  const allColumns = useMemo(() => {
    const actionColumn: ColumnDef<AdminUserRow, unknown> = {
      header: "",
      id: "actions",
      size: 40,
      enableSorting: false,
      cell: ({ row }) => (
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={(e) => {
            openActionMenu(row.original.user.id, e);
          }}
          aria-label={t("member.action.menu")}
        >
          <IconDotsVertical size={16} />
        </ActionIcon>
      ),
    };
    return [...userColumns, actionColumn];
  }, [userColumns, openActionMenu, t]);

  const table = useReactTable({
    data: visibleRows,
    columns: allColumns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => row.user.id,
  });

  const orderedRowIds = table.getRowModel().rows.map((row) => row.original.user.id);
  const currentPageUserIdSet = new Set(orderedRowIds);

  const handleRowClick = (
    userId: string,
    event: ReactMouseEvent<HTMLTableRowElement>,
  ) => {
    const orderedIndex = orderedRowIds.indexOf(userId);
    if (orderedIndex === -1) {
      return;
    }

    const withModifier = event.ctrlKey || event.metaKey;
    const withRange = event.shiftKey;
    if (withRange) {
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
    }

    if (withRange && selectionAnchorId) {
      const anchorIndex = orderedRowIds.indexOf(selectionAnchorId);
      if (anchorIndex !== -1) {
        const start = Math.min(anchorIndex, orderedIndex);
        const end = Math.max(anchorIndex, orderedIndex);
        const rangeIds = orderedRowIds.slice(start, end + 1);
        const nextSet = withModifier ? new Set(selectedUserIds) : new Set<string>();
        rangeIds.forEach((id) => nextSet.add(id));
        onSelectionChange(Array.from(nextSet));
        setSelectionAnchorId(userId);
        return;
      }
    }

    if (withModifier) {
      const nextSet = new Set(selectedUserIds);
      if (nextSet.has(userId)) {
        nextSet.delete(userId);
      } else {
        nextSet.add(userId);
      }
      onSelectionChange(Array.from(nextSet));
      setSelectionAnchorId(userId);
      return;
    }

    onSelectionChange([userId]);
    setSelectionAnchorId(userId);
  };

  const handleRowKeyDown = (
    userId: string,
    event: ReactKeyboardEvent<HTMLTableRowElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onOpenMemberDetail(userId);
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      const withModifier = event.ctrlKey || event.metaKey;
      if (withModifier) {
        const nextSet = new Set(selectedUserIds);
        if (nextSet.has(userId)) nextSet.delete(userId);
        else nextSet.add(userId);
        onSelectionChange(Array.from(nextSet));
      } else {
        onSelectionChange([userId]);
      }
      setSelectionAnchorId(userId);
      return;
    }

    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      openActionMenu(userId, event);
    }
  };

  const contextUserIds = (actionMenu?.userIds ?? [])
    .filter((userId) => currentPageUserIdSet.has(userId));
  const contextRows = contextUserIds
    .map((userId) => usersById.get(userId))
    .filter(Boolean) as AdminUserRow[];
  const isBatchContext = contextUserIds.length > 1;
  const contextSingleUserId = contextUserIds.length === 1 ? contextUserIds[0] ?? null : null;
  const contextHasProtectedTarget = contextRows.some(
    (row) => !canManageUserByRoleLevel(row.user, currentUser),
  );
  const anyActiveInContext = contextRows.some((row) => row.user.is_active);
  const anyInactiveInContext = contextRows.some((row) => !row.user.is_active);
  const contextActionPending = (action: AdminUserPendingAction) =>
    contextSingleUserId ? isSingleActionPending(contextSingleUserId, action) : false;
  const roleActionPending = isBatchContext ? batchRolePending : contextActionPending("change-role");
  const activateActionPending = isBatchContext ? batchActivatePending : contextActionPending("activate");
  const deactivateActionPending = isBatchContext ? batchDeactivatePending : contextActionPending("deactivate");
  const canReadContextLoginLock = Boolean(
    actionMenu && contextSingleUserId && canResetUserPasswords && !contextHasProtectedTarget,
  );
  const loginLockQuery = useAdminUserLoginLock(contextSingleUserId, canReadContextLoginLock);
  const loginLockStatus = loginLockQuery.data
    ? loginLockQuery.data.is_locked
      ? t("member.loginLock.locked", { seconds: loginLockQuery.data.retry_after_seconds })
      : t("member.loginLock.unlocked", { count: loginLockQuery.data.fail_count })
    : loginLockQuery.isError
      ? t("member.loginLock.unavailable")
      : t("member.loginLock.checking");

  const copyContextRows = () => {
    const lines = contextRows.map((row) =>
      [
        row.user.username,
        row.profile.classes
          .map((id) => resolveClassCatalogItem(id, classCatalog).label)
          .join(", "),
        String(row.profile.power),
        row.user.role_name,
        row.user.is_active ? t("member.status.active") : t("member.status.inactive"),
      ].join(", "),
    );
    clipboard.copy(lines.join("\n") + "\n");
  };

  const closeActionMenu = () => {
    const returnFocusTo = actionMenu?.returnFocusTo;
    setActionMenu(null);
    if (returnFocusTo) {
      window.requestAnimationFrame(() => returnFocusTo.focus());
    }
  };

  return (
    /* admin-fill：把 .admin-page__panel 给的高度原样传给下面的表格卡片。 */
    <Stack gap={12} className="admin-fill">
      <Menu
        opened={actionMenu !== null}
        onClose={closeActionMenu}
        position="bottom-start"
        withinPortal
        shadow="md"
        width={240}
      >
        <Menu.Target>
          <span
            aria-hidden="true"
            style={{
              position: "fixed",
              left: actionMenu?.x ?? -1,
              top: actionMenu?.y ?? -1,
              width: 1,
              height: 1,
              pointerEvents: "none",
            }}
          />
        </Menu.Target>
        <Menu.Dropdown data-admin-user-action-menu>
          <Menu.Label>
            {isBatchContext
              ? t("member.context.batchSelected", { count: contextUserIds.length })
              : contextRows[0]?.user.username ?? "-"}
          </Menu.Label>
          <Menu.Divider />
          <Menu.Item
            leftSection={<EyeIcon size={14} />}
            disabled={!contextSingleUserId}
            onClick={() => {
              if (contextSingleUserId) {
                onOpenMemberDetail(contextSingleUserId);
              }
            }}
          >
            {t("member.action.detail")}
          </Menu.Item>
          <Menu.Item leftSection={<CopyIcon size={14} />} onClick={copyContextRows}>
            {isBatchContext ? t("member.context.copyRows") : t("member.context.copyRow")}
          </Menu.Item>
          <Menu.Sub>
            <Menu.Sub.Target>
              <Menu.Sub.Item disabled={!canAssignUserRoles || roleActionPending || contextHasProtectedTarget}>
                {t("member.context.changeRole")}
              </Menu.Sub.Item>
            </Menu.Sub.Target>
            <Menu.Sub.Dropdown>
              {roles
                .slice()
                .sort((a, b) => a.level - b.level)
                .map((role) => (
                  <Menu.Item
                    key={role.id}
                    disabled={
                      !canAssignUserRoles || contextHasProtectedTarget || roleActionPending
                    }
                    onClick={() => {
                      if (isBatchContext) {
                        onBatchRole(contextUserIds, role.id, role.name);
                      } else if (contextSingleUserId) {
                        onSingleRoleChange(contextSingleUserId, role.id);
                      }
                    }}
                  >
                    {role.name}
                  </Menu.Item>
                ))}
            </Menu.Sub.Dropdown>
          </Menu.Sub>
          {anyInactiveInContext ? (
            <Menu.Item
              leftSection={<PlayIcon size={14} />}
              disabled={!canActivateUsers || activateActionPending || contextHasProtectedTarget}
              onClick={() => {
                if (isBatchContext) {
                  onBatchActivate(contextUserIds);
                } else if (contextSingleUserId) {
                  onSingleActivate(contextSingleUserId);
                }
              }}
            >
              {isBatchContext ? t("member.context.batchActivate") : t("member.reactivate")}
            </Menu.Item>
          ) : null}
          {anyActiveInContext ? (
            <Menu.Item
              leftSection={<PlayerPauseIcon size={14} />}
              disabled={!canActivateUsers || deactivateActionPending || contextHasProtectedTarget}
              onClick={() => {
                if (isBatchContext) {
                  onBatchDeactivate(contextUserIds);
                } else if (contextSingleUserId) {
                  onSingleDeactivate(contextSingleUserId);
                }
              }}
            >
              {isBatchContext ? t("member.context.batchDeactivate") : t("member.deactivate")}
            </Menu.Item>
          ) : null}
          {!isBatchContext && contextSingleUserId ? (
            <>
              <Menu.Item
                leftSection={<KeyIcon size={14} />}
                disabled={!canResetUserPasswords || contextActionPending("reset-password") || contextHasProtectedTarget}
                onClick={() => onSingleResetPassword(contextSingleUserId)}
              >
                {t("member.resetPassword")}
              </Menu.Item>
              {canResetUserPasswords && !contextHasProtectedTarget ? (
                <Menu.Label
                  aria-live="polite"
                  role="status"
                  title={loginLockQuery.data?.locked_until ?? undefined}
                >
                  {loginLockStatus}
                </Menu.Label>
              ) : null}
              <Menu.Item
                leftSection={<LockOpenIcon size={14} />}
                disabled={
                  !canResetUserPasswords
                  || contextActionPending("reset-login-lock")
                  || contextHasProtectedTarget
                  || loginLockQuery.isError
                }
                onClick={() => {
                  void (async () => {
                    const lockState = loginLockQuery.data ?? (await loginLockQuery.refetch()).data;
                    if (lockState) await onSingleResetLoginLock(contextSingleUserId, lockState);
                  })();
                }}
              >
                {t("member.resetLoginLock")}
              </Menu.Item>
            </>
          ) : null}
          <Menu.Divider />
          {canEditUsers ? (
            <Menu.Item leftSection={<UserPlusIcon size={14} />} onClick={onOpenCreateMember}>
              {t("member.context.createMember")}
            </Menu.Item>
          ) : null}
          <Menu.Item
            color="red"
            leftSection={<TrashIcon size={14} />}
            disabled={!canDeleteUsers || batchDeletePending || contextHasProtectedTarget}
            onClick={() => onBatchDelete(contextUserIds)}
          >
            {isBatchContext ? t("member.context.batchDelete") : t("member.context.delete")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      {usersLoading ? <Stack gap={8}>{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={18} />)}</Stack> : null}
      {usersError ? <Alert color="red" title={loadErrorMessage} /> : null}
      {!usersLoading && !usersError ? (
        <>
          <div className="admin-toolbar">
                <TextInput
                  className="admin-toolbar__search"
                  value={memberSearch}
                  onChange={(event) => onMemberSearchChange(event.currentTarget.value)}
                  placeholder={t("member.search.placeholder")}
                  aria-label={t("member.search.aria")}
                  leftSection={<SearchIcon size={14} />}
                  size="sm"
                />
                <SegmentedControl
                  size="xs"
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value as "all" | "active" | "inactive")}
                  data={[
                    { value: "all", label: t("member.filter.all") },
                    { value: "active", label: t("member.status.active") },
                    { value: "inactive", label: t("member.status.inactive") },
                  ]}
                />
                <div className="admin-toolbar__spacer" />
                {canEditUsers ? (
                  <Button size="sm" leftSection={<UserPlusIcon size={14} />} onClick={onOpenCreateMember}>
                    {t("member.create.button")}
                  </Button>
                ) : null}
          </div>

          <Text c="dimmed" size="xs">{t("member.accountStatusDescription")}</Text>

          <div className="admin-stats">
                <div className="admin-stat">
                  <div className="admin-stat__value">{memberStats.total}</div>
                  <div className="admin-stat__label">{t("member.stat.total")}</div>
                </div>
                <div className="admin-stat">
                  <div className="admin-stat__value admin-stat__value--ok">{memberStats.active}</div>
                  <div className="admin-stat__label">{t("member.stat.active")}</div>
                </div>
                <div className="admin-stat">
                  <div className={`admin-stat__value${memberStats.inactive > 0 ? " admin-stat__value--warn" : ""}`}>
                    {memberStats.inactive}
                  </div>
                  <div className="admin-stat__label">{t("member.stat.inactive")}</div>
                </div>
                <div className="admin-stat">
                  <div className="admin-stat__value">{memberStats.managementAccess}</div>
                  <div className="admin-stat__label">{t("member.stat.managementAccess")}</div>
                </div>
          </div>

          <Paper withBorder radius="md" className="admin-member-table-desktop admin-table-card admin-table-card--fill">
            <>
              <DataTableAdapter
                className="admin-table"
                table={table}
                highlightOnHover
                striped={false}
                withTableBorder={false}
                withColumnBorders={false}
                virtualize
                maxHeight="none"
                onRowDoubleClick={(row) => onOpenMemberDetail(row.original.user.id)}
                onRowClick={(row, event) => handleRowClick(row.original.user.id, event)}
                onRowContextMenu={(row, event) => openActionMenu(row.original.user.id, event)}
                onRowKeyDown={(row, event) => handleRowKeyDown(row.original.user.id, event)}
                rowAriaLabel={(row) => t("member.aria.row", { username: row.original.user.username })}
                rowAriaSelected={(row) => selectedIdSet.has(row.original.user.id)}
                rowClassName={(row) =>
                  selectedIdSet.has(row.original.user.id) ? "admin-member-row-selected" : undefined
                }
              />
              <div className="admin-table-card__footer">
                <DataTablePagination table={table} />
              </div>
            </>
          </Paper>

          {/* 多选操作通过任意选中行的右键菜单或 Shift+F10 进入，并作用于全部选中成员。 */}
          <Text c="dimmed" size="xs">{t("member.selectionHint")}</Text>

          <div className="admin-member-cards-mobile">
            {table.getRowModel().rows.map((row) => {
              const u = row.original.user;
              const p = row.original.profile;
              return (
                <Paper
                  key={u.id}
                  withBorder
                  radius="md"
                  className={`admin-member-card${selectedIdSet.has(u.id) ? " admin-member-card--selected" : ""}`}
                >
                  <Group justify="space-between" wrap="nowrap" gap={8} style={{ padding: "0.8rem 1rem" }}>
                    <UnstyledButton
                      type="button"
                      style={{ minWidth: 0, flex: 1, textAlign: "start" }}
                      onClick={() => onOpenMemberDetail(u.id)}
                      aria-label={t("member.action.openDetailAria", { username: u.username })}
                    >
                        <Text fw={600} size="sm" truncate>{u.username}</Text>
                        <Group gap={6} mt={2}>
                          <Badge size="xs" color={u.role_color ?? "gray"}>{u.role_name}</Badge>
                          {u.is_active
                            ? <Badge size="xs" color="green">{t("member.status.active")}</Badge>
                            : <Badge size="xs" color="red">{t("member.status.inactive")}</Badge>
                          }
                          {p.classes[0] ? (
                            <Text size="xs" c="dimmed">
                              {resolveClassCatalogItem(p.classes[0], classCatalog).label}
                            </Text>
                          ) : null}
                        </Group>
                    </UnstyledButton>
                    <ActionIcon
                        variant="subtle"
                        color="gray"
                        size={44}
                        onClick={(e) => {
                          openActionMenu(u.id, e);
                        }}
                        aria-label={t("member.action.menu")}
                      >
                        <IconDotsVertical size={16} />
                      </ActionIcon>
                  </Group>
                </Paper>
              );
            })}
            <DataTablePagination table={table} />
          </div>
        </>
      ) : null}
    </Stack>
  );
}
