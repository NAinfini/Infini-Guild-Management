import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import { IconDotsVertical } from "@tabler/icons-react";
import { useTable } from "@tanstack/react-table";
import { DataTableAdapter } from "@portal/components/shared/DataTableAdapter";
import {
  dataTableFeatures,
  type DataTableColumnDef,
} from "@portal/components/shared/data-table-features";
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { DataTablePagination } from "../../shared/DataTablePagination";
import { useClassCatalog } from "../../../hooks/data/useClassData";
import { resolveClassCatalogItem } from "../../../utils/class-catalog";
import { useAuthStore } from "../../../stores/auth";
import { canManageUserByRoleLevel } from "../../../utils/permissions";
import { AdminUserActionMenu } from "./AdminUserActionMenu";
import { AdminUserPasswordResetDialog } from "./AdminUserPasswordResetDialog";
import { AdminLoadError } from "./AdminLoadError";
import { AdminUsersToolbar } from "./AdminUsersToolbar";
import type { AdminUsersSectionProps, AdminUserRow } from "./admin-users.types";
import "./AdminUsersSection.css";

export type { AdminUserRow } from "./admin-users.types";

type ActionMenuContext = {
  userIds: string[];
  triggerId: string | null;
  anchor: PointAnchor | undefined;
  returnFocusTo: HTMLElement | null;
};

type PointAnchor = {
  getBoundingClientRect: () => DOMRect;
};

export function AdminUsersSection({
  usersLoading,
  usersError,
  onRetryUsers,
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
  memberStats,
  totalRows,
  pagination,
  onPaginationChange,
  sorting,
  onSortingChange,
  statusFilter,
  onStatusFilterChange,
  memberSearch,
  onMemberSearchChange,
}: AdminUsersSectionProps) {
  const { t } = useTranslation(["admin", "auth"]);
  const classCatalog = useClassCatalog();
  const currentUser = useAuthStore((state) => state.user);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenuContext | null>(null);
  const [passwordResetUserId, setPasswordResetUserId] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");

  const selectedIdSet = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);
  const usersById = useMemo(() => new Map(userRows.map((row) => [row.user.id, row])), [userRows]);
  const canCreateMember = canEditUsers && canAssignUserRoles && roles.length > 0;

  const openActionMenu = useCallback((
    userId: string,
    triggerId: string | null,
    returnFocusTo: HTMLElement,
    anchor?: PointAnchor,
  ) => {
    const userIds = selectedIdSet.has(userId) && selectedUserIds.length > 0
      ? selectedUserIds
      : [userId];

    if (!selectedIdSet.has(userId)) {
      onSelectionChange([userId]);
      setSelectionAnchorId(userId);
    }

    setActionMenu({ userIds, triggerId, anchor, returnFocusTo });
  }, [onSelectionChange, selectedIdSet, selectedUserIds]);

  const openTriggerActionMenu = useCallback((
    userId: string,
    triggerId: string,
    event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>,
  ) => {
    event.stopPropagation();
    openActionMenu(userId, triggerId, event.currentTarget);
  }, [openActionMenu]);

  const openPointerActionMenu = useCallback((
    userId: string,
    event: ReactMouseEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    openActionMenu(
      userId,
      null,
      event.currentTarget,
      createPointAnchor(event.clientX, event.clientY),
    );
  }, [openActionMenu]);

  const allColumns = useMemo(() => {
    const actionColumn: DataTableColumnDef<AdminUserRow> = {
      header: () => <span className="sr-only">{t("member.action.menu")}</span>,
      id: "actions",
      size: 48,
      enableSorting: false,
      cell: ({ row }) => {
        const userId = row.original.user.id;
        const menuId = desktopMenuId(userId);
        return (
          <DropdownMenuTrigger
            id={menuId}
            render={(
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="admin-users__action-trigger"
                aria-label={t("member.action.menu")}
                onClick={(event) => openTriggerActionMenu(userId, menuId, event)}
              />
            )}
          >
            <IconDotsVertical size={16} aria-hidden="true" />
          </DropdownMenuTrigger>
        );
      },
    };
    return [...userColumns, actionColumn];
  }, [openTriggerActionMenu, t, userColumns]);

  const table = useTable({
    features: dataTableFeatures,
    data: userRows,
    columns: allColumns,
    state: { sorting, pagination },
    onSortingChange,
    onPaginationChange,
    manualPagination: true,
    manualSorting: true,
    enableMultiSort: false,
    rowCount: totalRows,
    autoResetPageIndex: false,
    getRowId: (row) => row.user.id,
  });

  const orderedRowIds = table.getRowModel().rows.map((row) => row.original.user.id);
  const currentPageUserIdSet = new Set(orderedRowIds);

  const handleRowClick = (
    userId: string,
    event: ReactMouseEvent<HTMLTableRowElement>,
  ) => {
    const orderedIndex = orderedRowIds.indexOf(userId);
    if (orderedIndex === -1) return;

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
      if (nextSet.has(userId)) nextSet.delete(userId);
      else nextSet.add(userId);
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
      event.preventDefault();
      openTriggerActionMenu(userId, desktopMenuId(userId), event);
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

  const closeActionMenu = useCallback(() => {
    const returnFocusTo = actionMenu?.returnFocusTo;
    setActionMenu(null);
    if (returnFocusTo) window.requestAnimationFrame(() => returnFocusTo.focus());
  }, [actionMenu]);
  const closePasswordReset = useCallback(() => {
    setPasswordResetUserId(null);
    setCurrentPassword("");
  }, []);
  const requestPasswordReset = useCallback((userId: string) => {
    setPasswordResetUserId(userId);
    closeActionMenu();
  }, [closeActionMenu]);
  const submitPasswordReset = useCallback(async () => {
    if (!passwordResetUserId || !currentPassword) return;
    try {
      await onSingleResetPassword(passwordResetUserId, currentPassword);
      closePasswordReset();
    } catch {
      // The mutation boundary displays the server error and keeps this confirmation open.
    }
  }, [closePasswordReset, currentPassword, onSingleResetPassword, passwordResetUserId]);

  return (
    <DropdownMenu
      open={actionMenu !== null}
      triggerId={actionMenu?.triggerId ?? null}
      onOpenChange={(open) => { if (!open) closeActionMenu(); }}
    >
      <div className="admin-fill admin-users">
            <AdminUsersToolbar
              memberSearch={memberSearch}
              statusFilter={statusFilter}
              canCreateMember={canCreateMember}
              onMemberSearchChange={onMemberSearchChange}
              onStatusFilterChange={onStatusFilterChange}
              onOpenCreateMember={onOpenCreateMember}
            />
        {usersLoading ? (
          <LoadingIndicator />
        ) : null}
        {usersError ? <AdminLoadError onRetry={onRetryUsers} /> : null}
        {!usersLoading && !usersError ? (
          <>


            <section className="admin-panel admin-stats" aria-label={t("member.filter.status")}>
              <p className="admin-users__account-status">{t("member.accountStatusDescription")}</p>
              <div className="admin-stat">
                <div className="admin-stat__value">{memberStats?.total ?? "—"}</div>
                <div className="admin-stat__label">{t("member.stat.total")}</div>
              </div>
              <div className="admin-stat">
                <div className="admin-stat__value admin-stat__value--ok">{memberStats?.active ?? "—"}</div>
                <div className="admin-stat__label">{t("member.stat.active")}</div>
              </div>
              <div className="admin-stat">
                <div className={`admin-stat__value${(memberStats?.inactive ?? 0) > 0 ? " admin-stat__value--warn" : ""}`}>
                  {memberStats?.inactive ?? "—"}
                </div>
                <div className="admin-stat__label">{t("member.stat.inactive")}</div>
              </div>
              {memberStats ? <div className="admin-stat">
                <div className="admin-stat__value">{memberStats.management_access}</div>
                <div className="admin-stat__label">{t("member.stat.managementAccess")}</div>
              </div> : null}
            </section>

            <section className="admin-panel admin-table-card admin-table-card--fill admin-users__desktop-table">
              <DataTableAdapter
                className="admin-table admin-users__table-scroll"
                table={table}
                appearance="rows"
                rowHover
                striped={false}
                virtualize
                maxHeight="none"
                onRowDoubleClick={(row) => onOpenMemberDetail(row.original.user.id)}
                onRowClick={(row, event) => handleRowClick(row.original.user.id, event)}
                onRowContextMenu={(row, event) => openPointerActionMenu(row.original.user.id, event)}
                onRowKeyDown={(row, event) => handleRowKeyDown(row.original.user.id, event)}
                rowAriaLabel={(row) => t("member.aria.row", { display_name: row.original.user.display_name })}
                rowAriaSelected={(row) => selectedIdSet.has(row.original.user.id)}
                rowClassName={(row) => selectedIdSet.has(row.original.user.id) ? "admin-users__row-selected" : undefined}
              />
              <div className="admin-table-card__footer">
                <p className="admin-users__selection-hint">{t("member.selectionHint")}</p>
                <DataTablePagination table={table} />
              </div>
            </section>

            <div className="admin-users__mobile-list">
              {table.getRowModel().rows.map((row) => {
                const user = row.original.user;
                const profile = row.original.profile;
                const menuId = mobileMenuId(user.id);
                return (
                  <article
                    key={user.id}
                    className={`admin-panel admin-users__card${selectedIdSet.has(user.id) ? " admin-users__card--selected" : ""}`}
                  >
                    <div className="admin-users__card-content">
                      <Button
                        type="button"
                        variant="ghost"
                        className="admin-users__card-open"
                        onClick={() => onOpenMemberDetail(user.id)}
                        aria-label={t("member.action.openDetailAria", { display_name: user.display_name })}
                      >
                        <span className="admin-users__card-name">{user.display_name}</span>
                        <span className="admin-users__card-meta">
                          <Badge
                            variant="outline"
                            className="admin-users__role-badge"
                            style={user.role_color ? { "--role-color": user.role_color } as CSSProperties : undefined}
                          >
                            {user.role_name}
                          </Badge>
                          <Badge variant={user.is_active ? "secondary" : "destructive"}>
                            {user.is_active ? t("member.status.active") : t("member.status.inactive")}
                          </Badge>
                          {profile.classes[0] ? (
                            <span className="admin-users__card-class">
                              {resolveClassCatalogItem(profile.classes[0], classCatalog).label}
                            </span>
                          ) : null}
                        </span>
                      </Button>
                      <DropdownMenuTrigger
                        id={menuId}
                        render={(
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="admin-users__action-trigger"
                            aria-label={t("member.action.menu")}
                            onClick={(event) => openTriggerActionMenu(user.id, menuId, event)}
                          />
                        )}
                      >
                        <IconDotsVertical size={16} aria-hidden="true" />
                      </DropdownMenuTrigger>
                    </div>
                  </article>
                );
              })}
              <DataTablePagination table={table} />
            </div>
          </>
        ) : null}

      </div>

      {actionMenu ? (
        <AdminUserActionMenu
          open
          anchor={actionMenu.anchor}
          isBatchContext={isBatchContext}
          contextUserIds={contextUserIds}
          contextRows={contextRows}
          contextSingleUserId={contextSingleUserId}
          contextHasProtectedTarget={contextHasProtectedTarget}
          anyActiveInContext={anyActiveInContext}
          anyInactiveInContext={anyInactiveInContext}
          canCreateMember={canCreateMember}
          canAssignUserRoles={canAssignUserRoles}
          canActivateUsers={canActivateUsers}
          canDeleteUsers={canDeleteUsers}
          canResetUserPasswords={canResetUserPasswords}
          roles={roles}
          batchRolePending={batchRolePending}
          batchActivatePending={batchActivatePending}
          batchDeactivatePending={batchDeactivatePending}
          batchDeletePending={batchDeletePending}
          isSingleActionPending={isSingleActionPending}
          classCatalog={classCatalog}
          onRequestPasswordReset={requestPasswordReset}
          onOpenMemberDetail={onOpenMemberDetail}
          onOpenCreateMember={onOpenCreateMember}
          onBatchRole={onBatchRole}
          onSingleRoleChange={onSingleRoleChange}
          onBatchActivate={onBatchActivate}
          onSingleActivate={onSingleActivate}
          onBatchDeactivate={onBatchDeactivate}
          onSingleDeactivate={onSingleDeactivate}
          onBatchDelete={onBatchDelete}
        />
      ) : null}
      <AdminUserPasswordResetDialog
        open={passwordResetUserId !== null}
        currentPassword={currentPassword}
        pending={passwordResetUserId !== null && isSingleActionPending(passwordResetUserId, "reset-password")}
        onCurrentPasswordChange={setCurrentPassword}
        onSubmit={submitPasswordReset}
        onClose={closePasswordReset}
      />
    </DropdownMenu>
  );
}
function desktopMenuId(userId: string) {
  return `admin-user-desktop-${userId}`;
}

function mobileMenuId(userId: string) {
  return `admin-user-mobile-${userId}`;
}

function createPointAnchor(x: number, y: number): PointAnchor {
  return {
    getBoundingClientRect: () => ({
      x,
      y,
      top: y,
      right: x,
      bottom: y,
      left: x,
      width: 0,
      height: 0,
      toJSON: () => ({ x, y, width: 0, height: 0 }),
    }) as DOMRect,
  };
}
