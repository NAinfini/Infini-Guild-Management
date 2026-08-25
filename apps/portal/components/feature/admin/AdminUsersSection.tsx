import type { AdminRole } from "@guild/shared";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@portal/components/ui/input-group";
import { Label } from "@portal/components/ui/label";
import { PasswordInput } from "@portal/components/ui/password-input";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import {
  CopyIcon,
  EyeIcon,
  KeyIcon,
  LockOpenIcon,
  PlayIcon,
  PlayerPauseIcon,
  SearchIcon,
  TrashIcon,
  UserPlusIcon,
} from "@portal/components/icons";
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
import { ContentFilterGroup, ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { DataTableAdapter } from "@portal/components/shared/DataTableAdapter";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { DataTablePagination } from "../../shared/DataTablePagination";
import type { UsersListResponse } from "../../../services/UserService";
import { useClassCatalog } from "../../../hooks/data/useClassData";
import { formatDateTime } from "../../../utils/datetime";
import { resolveClassCatalogItem } from "../../../utils/class-catalog";
import type { AdminUserPendingAction } from "../../../hooks/useAdminMutations";
import { useAuthStore } from "../../../stores/auth";
import { canManageUserByRoleLevel, userCanAccessAdmin } from "../../../utils/permissions";
import type { AdminLoginLockState } from "../../../services/AdminService";
import { useAdminUserLoginLock } from "../../../hooks/useAdminUserLoginLock";
import { AdminLoadError } from "./AdminLoadError";
import "./AdminUsersSection.css";

export type AdminUserRow = UsersListResponse["data"][number];

type ActionMenuContext = {
  userIds: string[];
  triggerId: string;
  returnFocusTo: HTMLElement | null;
};

type AdminUsersSectionProps = {
  usersLoading: boolean;
  usersError: boolean;
  onRetryUsers: () => void;
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
  onSingleResetPassword: (userId: string, currentPassword: string) => void | Promise<void>;
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
  const { t } = useTranslation(["admin", "auth"]);
  const classCatalog = useClassCatalog();
  const currentUser = useAuthStore((state) => state.user);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenuContext | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [passwordResetUserId, setPasswordResetUserId] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const firstActionItemRef = useRef<HTMLDivElement>(null);

  const selectedIdSet = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);
  const usersById = useMemo(() => new Map(userRows.map((row) => [row.user.id, row])), [userRows]);

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

  useEffect(() => {
    setPagination((previous) => (previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 }));
  }, [statusFilter]);

  const openActionMenu = useCallback((
    userId: string,
    triggerId: string,
    event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>,
  ) => {
    if (event.type === "contextmenu") event.preventDefault();
    event.stopPropagation();

    const userIds = selectedIdSet.has(userId) && selectedUserIds.length > 0
      ? selectedUserIds
      : [userId];

    if (!selectedIdSet.has(userId)) {
      onSelectionChange([userId]);
      setSelectionAnchorId(userId);
    }

    setActionMenu({ userIds, triggerId, returnFocusTo: event.currentTarget });
  }, [onSelectionChange, selectedIdSet, selectedUserIds]);

  const allColumns = useMemo(() => {
    const actionColumn: ColumnDef<AdminUserRow, unknown> = {
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
                onClick={(event) => openActionMenu(userId, menuId, event)}
              />
            )}
          >
            <IconDotsVertical size={16} aria-hidden="true" />
          </DropdownMenuTrigger>
        );
      },
    };
    return [...userColumns, actionColumn];
  }, [openActionMenu, t, userColumns]);

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
      openActionMenu(userId, desktopMenuId(userId), event);
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
        row.user.display_name,
        row.profile.classes
          .map((id) => resolveClassCatalogItem(id, classCatalog).label)
          .join(", "),
        String(row.profile.power),
        row.user.role_name,
        row.user.is_active ? t("member.status.active") : t("member.status.inactive"),
      ].join(", "),
    );
    void navigator.clipboard.writeText(`${lines.join("\n")}\n`);
  };

  const closeActionMenu = useCallback(() => {
    const returnFocusTo = actionMenu?.returnFocusTo;
    setActionMenu(null);
    if (returnFocusTo) window.requestAnimationFrame(() => returnFocusTo.focus());
  }, [actionMenu]);

  useEffect(() => {
    if (!actionMenu) return;

    const frame = window.requestAnimationFrame(() => firstActionItemRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [actionMenu, isBatchContext]);

  const closePasswordReset = () => {
    setPasswordResetUserId(null);
    setCurrentPassword("");
  };

  const submitPasswordReset = async () => {
    if (!passwordResetUserId || !currentPassword) return;
    try {
      await onSingleResetPassword(passwordResetUserId, currentPassword);
      closePasswordReset();
    } catch {
      // The mutation boundary displays the server error and keeps this confirmation open.
    }
  };

  return (
    <DropdownMenu
      open={actionMenu !== null}
      triggerId={actionMenu?.triggerId ?? null}
      onOpenChange={(open) => { if (!open) closeActionMenu(); }}
    >
      <div className="admin-fill admin-users">
        {usersLoading ? (
          <div className="admin-users__skeleton" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[18px]" />)}
          </div>
        ) : null}
        {usersError ? <AdminLoadError onRetry={onRetryUsers} /> : null}
        {!usersLoading && !usersError ? (
          <>
            <ContentFilterToolbar
              search={(
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon size={14} aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    value={memberSearch}
                    onChange={(event) => onMemberSearchChange(event.currentTarget.value)}
                    placeholder={t("member.search.placeholder")}
                    aria-label={t("member.search.aria")}
                  />
                </InputGroup>
              )}
              filterControls={(
                <ContentFilterGroup label={t("member.filter.status")}>
                  <RadioGroup
                    className="admin-users__status-filter"
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value as "all" | "active" | "inactive")}
                  >
                    {[
                      { value: "all", label: t("member.filter.all") },
                      { value: "active", label: t("member.status.active") },
                      { value: "inactive", label: t("member.status.inactive") },
                    ].map((option) => (
                      <Label key={option.value} className="admin-users__status-option">
                        <RadioGroupItem value={option.value} />
                        <span>{option.label}</span>
                      </Label>
                    ))}
                  </RadioGroup>
                </ContentFilterGroup>
              )}
              actions={canEditUsers ? (
                <Button size="sm" onClick={onOpenCreateMember}>
                  <UserPlusIcon size={14} data-icon="inline-start" />
                  {t("member.create.button")}
                </Button>
              ) : null}
              filterLabel={t("common:filter.toggle")}
              activeFilterCount={statusFilter === "all" ? 0 : 1}
              resetLabel={t("common:filter.reset")}
              onReset={() => setStatusFilter("all")}
            />

            <p className="admin-users__account-status">{t("member.accountStatusDescription")}</p>

            <section className="admin-panel admin-stats" aria-label={t("member.filter.status")}>
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
                onRowContextMenu={(row, event) => openActionMenu(row.original.user.id, desktopMenuId(row.original.user.id), event)}
                onRowKeyDown={(row, event) => handleRowKeyDown(row.original.user.id, event)}
                rowAriaLabel={(row) => t("member.aria.row", { display_name: row.original.user.display_name })}
                rowAriaSelected={(row) => selectedIdSet.has(row.original.user.id)}
                rowClassName={(row) => selectedIdSet.has(row.original.user.id) ? "admin-users__row-selected" : undefined}
              />
              <div className="admin-table-card__footer">
                <DataTablePagination table={table} />
              </div>
            </section>

            <p className="admin-users__selection-hint">{t("member.selectionHint")}</p>

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
                            onClick={(event) => openActionMenu(user.id, menuId, event)}
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

        <Dialog open={passwordResetUserId !== null} onOpenChange={(open) => { if (!open) closePasswordReset(); }}>
          <DialogContent closeLabel={t("common:action.close")}>
            <DialogHeader>
              <DialogTitle>{t("member.resetPassword.confirmTitle")}</DialogTitle>
              <DialogDescription>{t("member.resetPassword.confirmDescription")}</DialogDescription>
            </DialogHeader>
            <form
              className="admin-users__password-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitPasswordReset();
              }}
            >
              <div className="admin-users__password-field">
                <Label htmlFor="admin-user-current-password">{t("member.resetPassword.currentPasswordLabel")}</Label>
                <PasswordInput
                  id="admin-user-current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.currentTarget.value)}
                  autoComplete="current-password"
                  autoFocus
                  required
                  showPasswordLabel={t("auth:aria.showPassword")}
                  hidePasswordLabel={t("auth:aria.hidePassword")}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closePasswordReset}>
                  {t("member.resetPassword.cancel")}
                </Button>
                <Button
                  type="submit"
                  loading={passwordResetUserId !== null && isSingleActionPending(passwordResetUserId, "reset-password")}
                  disabled={!currentPassword || (passwordResetUserId !== null && isSingleActionPending(passwordResetUserId, "reset-password"))}
                >
                  {t("member.resetPassword.confirm")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <DropdownMenuContent data-admin-user-action-menu className="admin-users__action-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {isBatchContext
              ? t("member.context.batchSelected", { count: contextUserIds.length })
              : contextRows[0]?.user.display_name ?? "-"}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <AdminUserMenuItem
          ref={isBatchContext ? undefined : firstActionItemRef}
          disabled={!contextSingleUserId}
          onClick={() => {
            if (contextSingleUserId) onOpenMemberDetail(contextSingleUserId);
          }}
        >
          <EyeIcon size={14} />
          {t("member.action.detail")}
        </AdminUserMenuItem>
        <AdminUserMenuItem
          ref={isBatchContext ? firstActionItemRef : undefined}
          onClick={copyContextRows}
        >
          <CopyIcon size={14} />
          {isBatchContext ? t("member.context.copyRows") : t("member.context.copyRow")}
        </AdminUserMenuItem>
        <DropdownMenuSub>
          {(!canAssignUserRoles || contextHasProtectedTarget) ? (
            <Tooltip>
              <TooltipTrigger render={<span data-disabled-tooltip-target />}>
                <DropdownMenuSubTrigger
                  disabled
                  aria-description={t("roles.tooltip.admin.users.role")}
                >
                  {t("member.context.changeRole")}
                </DropdownMenuSubTrigger>
              </TooltipTrigger>
              <TooltipContent side="left">{t("roles.tooltip.admin.users.role")}</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenuSubTrigger disabled={roleActionPending}>
              {t("member.context.changeRole")}
            </DropdownMenuSubTrigger>
          )}
          <DropdownMenuSubContent>
            {roles
              .slice()
              .sort((a, b) => a.level - b.level)
              .map((role) => (
                <DropdownMenuItem
                  key={role.id}
                  disabled={!canAssignUserRoles || contextHasProtectedTarget || roleActionPending}
                  onClick={() => {
                    if (isBatchContext) onBatchRole(contextUserIds, role.id, role.name);
                    else if (contextSingleUserId) onSingleRoleChange(contextSingleUserId, role.id);
                  }}
                >
                  {role.name}
                </DropdownMenuItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {anyInactiveInContext ? (
          <AdminUserMenuItem
            disabled={!canActivateUsers || activateActionPending || contextHasProtectedTarget}
            disabledReason={(!canActivateUsers || contextHasProtectedTarget)
              ? t("roles.tooltip.admin.users.activate")
              : undefined}
            onClick={() => {
              if (isBatchContext) onBatchActivate(contextUserIds);
              else if (contextSingleUserId) onSingleActivate(contextSingleUserId);
            }}
          >
            <PlayIcon size={14} />
            {isBatchContext ? t("member.context.batchActivate") : t("member.reactivate")}
          </AdminUserMenuItem>
        ) : null}
        {anyActiveInContext ? (
          <AdminUserMenuItem
            disabled={!canActivateUsers || deactivateActionPending || contextHasProtectedTarget}
            disabledReason={(!canActivateUsers || contextHasProtectedTarget)
              ? t("roles.tooltip.admin.users.activate")
              : undefined}
            onClick={() => {
              if (isBatchContext) onBatchDeactivate(contextUserIds);
              else if (contextSingleUserId) onSingleDeactivate(contextSingleUserId);
            }}
          >
            <PlayerPauseIcon size={14} />
            {isBatchContext ? t("member.context.batchDeactivate") : t("member.deactivate")}
          </AdminUserMenuItem>
        ) : null}
        {!isBatchContext && contextSingleUserId ? (
          <>
            <AdminUserMenuItem
              disabled={!canResetUserPasswords || contextActionPending("reset-password") || contextHasProtectedTarget}
              disabledReason={(!canResetUserPasswords || contextHasProtectedTarget)
                ? t("roles.tooltip.admin.users.password")
                : undefined}
              onClick={() => {
                setPasswordResetUserId(contextSingleUserId);
                closeActionMenu();
              }}
            >
              <KeyIcon size={14} />
              {t("member.resetPassword")}
            </AdminUserMenuItem>
            {canResetUserPasswords && !contextHasProtectedTarget ? (
              <Tooltip disabled={!loginLockQuery.data?.locked_until}>
                <TooltipTrigger render={<span className="admin-users__login-lock" aria-live="polite" role="status" />}>
                  {loginLockStatus}
                </TooltipTrigger>
                <TooltipContent>
                  {t("member.loginLock.until", {
                    at: formatDateTime(loginLockQuery.data?.locked_until ?? null),
                  })}
                </TooltipContent>
              </Tooltip>
            ) : null}
            <AdminUserMenuItem
              disabled={
                !canResetUserPasswords
                || contextActionPending("reset-login-lock")
                || contextHasProtectedTarget
                || loginLockQuery.isError
              }
              disabledReason={(!canResetUserPasswords || contextHasProtectedTarget)
                ? t("roles.tooltip.admin.users.password")
                : undefined}
              onClick={() => {
                void (async () => {
                  const lockState = loginLockQuery.data ?? (await loginLockQuery.refetch()).data;
                  if (lockState) await onSingleResetLoginLock(contextSingleUserId, lockState);
                })();
              }}
            >
              <LockOpenIcon size={14} />
              {t("member.resetLoginLock")}
            </AdminUserMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        {canEditUsers ? (
          <AdminUserMenuItem onClick={onOpenCreateMember}>
            <UserPlusIcon size={14} />
            {t("member.context.createMember")}
          </AdminUserMenuItem>
        ) : null}
        <AdminUserMenuItem
          variant="destructive"
          disabled={!canDeleteUsers || batchDeletePending || contextHasProtectedTarget}
          disabledReason={(!canDeleteUsers || contextHasProtectedTarget)
            ? t("roles.tooltip.admin.users.delete")
            : undefined}
          onClick={() => onBatchDelete(contextUserIds)}
        >
          <TrashIcon size={14} />
          {isBatchContext ? t("member.context.batchDelete") : t("member.context.delete")}
        </AdminUserMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type AdminUserMenuItemProps = ComponentProps<typeof DropdownMenuItem> & {
  disabledReason?: ReactNode;
};

function AdminUserMenuItem({ disabled, disabledReason, children, ...props }: AdminUserMenuItemProps) {
  const item = (
    <DropdownMenuItem
      disabled={disabled}
      aria-description={disabled && disabledReason ? String(disabledReason) : undefined}
      {...props}
    >
      {children}
    </DropdownMenuItem>
  );

  if (!disabled || !disabledReason) return item;

  return (
    <Tooltip>
      <TooltipTrigger render={<span data-disabled-tooltip-target />}>{item}</TooltipTrigger>
      <TooltipContent side="left">{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

function desktopMenuId(userId: string) {
  return `admin-user-desktop-${userId}`;
}

function mobileMenuId(userId: string) {
  return `admin-user-mobile-${userId}`;
}
