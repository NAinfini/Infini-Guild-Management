import type { AdminRole } from "@guild/shared";
import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@portal/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import {
  CopyIcon,
  EyeIcon,
  KeyIcon,
  PlayIcon,
  PlayerPauseIcon,
  TrashIcon,
  UserPlusIcon,
} from "@portal/components/icons";
import { useCallback, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AdminUserPendingAction } from "../../../hooks/useAdminMutations";
import { resolveClassCatalogItem } from "../../../utils/class-catalog";
import type { AdminUserRow } from "./admin-users.types";

type AdminUserActionMenuProps = {
  open: boolean;
  anchor: ComponentProps<typeof DropdownMenuContent>["anchor"];
  isBatchContext: boolean;
  contextUserIds: string[];
  contextRows: AdminUserRow[];
  contextSingleUserId: string | null;
  contextHasProtectedTarget: boolean;
  anyActiveInContext: boolean;
  anyInactiveInContext: boolean;
  canEditUsers: boolean;
  canAssignUserRoles: boolean;
  canActivateUsers: boolean;
  canDeleteUsers: boolean;
  canResetUserPasswords: boolean;
  roles: AdminRole[];
  batchRolePending: boolean;
  batchActivatePending: boolean;
  batchDeactivatePending: boolean;
  batchDeletePending: boolean;
  isSingleActionPending: (userId: string, action: AdminUserPendingAction) => boolean;
  classCatalog: Parameters<typeof resolveClassCatalogItem>[1];
  onRequestPasswordReset: (userId: string) => void;
  onOpenMemberDetail: (userId: string) => void;
  onOpenCreateMember: () => void;
  onBatchRole: (userIds: string[], role: string, roleName: string) => void;
  onSingleRoleChange: (userId: string, role: string) => void;
  onBatchActivate: (userIds: string[]) => void;
  onSingleActivate: (userId: string) => void;
  onBatchDeactivate: (userIds: string[]) => void;
  onSingleDeactivate: (userId: string) => void;
  onBatchDelete: (userIds: string[]) => void;
};

export function AdminUserActionMenu({
  open,
  anchor,
  isBatchContext,
  contextUserIds,
  contextRows,
  contextSingleUserId,
  contextHasProtectedTarget,
  anyActiveInContext,
  anyInactiveInContext,
  canEditUsers,
  canAssignUserRoles,
  canActivateUsers,
  canDeleteUsers,
  canResetUserPasswords,
  roles,
  batchRolePending,
  batchActivatePending,
  batchDeactivatePending,
  batchDeletePending,
  isSingleActionPending,
  classCatalog,
  onRequestPasswordReset,
  onOpenMemberDetail,
  onOpenCreateMember,
  onBatchRole,
  onSingleRoleChange,
  onBatchActivate,
  onSingleActivate,
  onBatchDeactivate,
  onSingleDeactivate,
  onBatchDelete,
}: AdminUserActionMenuProps) {
  const { t } = useTranslation(["admin", "auth"]);
  const firstActionItemRef = useRef<HTMLDivElement>(null);
  const contextActionPending = (action: AdminUserPendingAction) =>
    contextSingleUserId ? isSingleActionPending(contextSingleUserId, action) : false;
  const roleActionPending = isBatchContext ? batchRolePending : contextActionPending("change-role");
  const activateActionPending = isBatchContext ? batchActivatePending : contextActionPending("activate");
  const deactivateActionPending = isBatchContext ? batchDeactivatePending : contextActionPending("deactivate");

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => firstActionItemRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isBatchContext, open]);

  const copyContextRows = useCallback(() => {
    const lines = contextRows.map((row) => [
      row.user.display_name,
      row.profile.classes.map((id) => resolveClassCatalogItem(id, classCatalog).label).join(", "),
      String(row.profile.power),
      row.user.role_name,
      row.user.is_active ? t("member.status.active") : t("member.status.inactive"),
    ].join(", "));
    void navigator.clipboard.writeText(`${lines.join("\n")}\n`);
  }, [classCatalog, contextRows, t]);

  return (
      <DropdownMenuContent
        anchor={anchor}
        positionMethod={anchor ? "fixed" : undefined}
        data-admin-user-action-menu
        className="admin-users__action-menu"
      >
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
        <AdminUserMenuItem ref={isBatchContext ? firstActionItemRef : undefined} onClick={copyContextRows}>
          <CopyIcon size={14} />
          {isBatchContext ? t("member.context.copyRows") : t("member.context.copyRow")}
        </AdminUserMenuItem>
        <DropdownMenuSub>
          {(!canAssignUserRoles || contextHasProtectedTarget) ? (
            <Tooltip>
              <TooltipTrigger render={<span data-disabled-tooltip-target />}>
                <DropdownMenuSubTrigger disabled aria-description={t("roles.tooltip.admin.users.role")}>
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
            {roles.slice().sort((a, b) => a.level - b.level).map((role) => (
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
            disabledReason={(!canActivateUsers || contextHasProtectedTarget) ? t("roles.tooltip.admin.users.activate") : undefined}
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
            disabledReason={(!canActivateUsers || contextHasProtectedTarget) ? t("roles.tooltip.admin.users.activate") : undefined}
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
              disabledReason={(!canResetUserPasswords || contextHasProtectedTarget) ? t("roles.tooltip.admin.users.password") : undefined}
              onClick={() => {
                onRequestPasswordReset(contextSingleUserId);
              }}
            >
              <KeyIcon size={14} />
              {t("member.resetPassword")}
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
          disabledReason={(!canDeleteUsers || contextHasProtectedTarget) ? t("roles.tooltip.admin.users.delete") : undefined}
          onClick={() => onBatchDelete(contextUserIds)}
        >
          <TrashIcon size={14} />
          {isBatchContext ? t("member.context.batchDelete") : t("member.context.delete")}
        </AdminUserMenuItem>
      </DropdownMenuContent>
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
