import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createElement, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess, notifyWarning, notifyError } from "../utils/notifications";
import type { MemberDetailFormState } from "../types/admin";
import {
  type AdminLoginLockState,
  adminUpdateProfile,
  batchDeactivateAdminUsers,
  batchDeleteAdminUsers,
  batchReactivateAdminUsers,
  batchUpdateAdminUserRole,
  createAdminInviteLink,
  createAdminMember,
  deactivateAdminUser,
  deleteAdminInviteLink,
  reactivateAdminUser,
  resetAdminUserLoginLock,
  resetAdminUserPassword,
  revokeAdminInviteLink,
  updateAdminUserRole,
  downloadAdminAuditLogExport,
  createRole,
  deleteRole,
  updateRole,
} from "../services/AdminService";
import { queryKeys } from "../api/query-keys";
import { copyPlainText } from "../utils/copy";
import { auditExportDatePart, downloadFileBlob } from "../utils/admin";
import { fromDateTimeLocalValue } from "../utils/datetime";
import { useAdminPendingActions } from "./useAdminPendingActions";
import { revalidateSessionSnapshot } from "../session-transition";

export type AdminUserPendingAction =
  | "change-role"
  | "activate"
  | "deactivate"
  | "reset-password"
  | "reset-login-lock";

export type AdminInvitePendingAction = "revoke" | "delete";

type AuditFilterState = {
  search: string;
  dateFrom: string;
  dateTo: string;
  entityType: string;
  entityId: string;
  actorId: string;
};

type UseAdminMutationsParams = {
  auditFilter: AuditFilterState;
  batchSelectionLimit: number;
  showError: (error: unknown, fallbackMessage: string) => void;
  resolveUsername: (userId: string) => string | undefined;
};

export function useAdminMutations({
  auditFilter,
  batchSelectionLimit,
  showError,
  resolveUsername,
}: UseAdminMutationsParams) {
  const { t } = useTranslation("admin");
  const confirm = useConfirmDialog();
  const queryClient = useQueryClient();
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState(0);
  const { isActionPending, runPendingAction } = useAdminPendingActions();

  const invalidateAdminUsers = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
  };

  const refreshSessionSnapshot = () => {
    void revalidateSessionSnapshot(queryClient).catch(() => {
      notifyWarning(t("message.sessionRefreshFailed"));
    });
  };

  const invalidateAdminUsersAndSession = async () => {
    await invalidateAdminUsers();
    refreshSessionSnapshot();
  };

  const invalidateRoleAuthority = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.cmdk.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.inviteLinksAll() }),
    ]);
    refreshSessionSnapshot();
  };

  const invalidateInviteData = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.inviteLinksAll() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.inviteStats() });
  };

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      updateAdminUserRole(userId, role),
    onSuccess: async () => {
      notifySuccess(t("message.roleUpdated"));
      await invalidateRoleAuthority();
    },
    onError: (error) => showError(error, t("message.roleUpdateFailed")),
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => deactivateAdminUser(userId),
    onSuccess: async () => {
      notifySuccess(t("message.deactivated"));
      await invalidateAdminUsersAndSession();
    },
    onError: (error) => showError(error, t("message.deactivateFailed")),
  });

  const reactivateMutation = useMutation({
    mutationFn: (userId: string) => reactivateAdminUser(userId),
    onSuccess: async () => {
      notifySuccess(t("message.reactivated"));
      await invalidateAdminUsersAndSession();
    },
    onError: (error) => showError(error, t("message.reactivateFailed")),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ userId, currentPassword }: { userId: string; currentPassword: string }) =>
      resetAdminUserPassword(userId, currentPassword),
    onSuccess: async (payload) => {
      await copyPlainText(`${payload.temporary_login_name}\n${payload.temporary_password}`);
      notifySuccess(t("message.passwordResetCopied"));
    },
    onError: (error) => showError(error, t("message.passwordResetFailed")),
  });

  const resetLoginLockMutation = useMutation({
    mutationFn: (userId: string) => resetAdminUserLoginLock(userId),
    onSuccess: async (payload, userId) => {
      notifySuccess(t("message.loginLockCleared", { seconds: payload.retry_after_seconds }));
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.loginLock(userId) });
    },
    onError: (error) => showError(error, t("message.loginLockClearFailed")),
  });

  const createMemberMutation = useMutation({
    mutationFn: async (data: {
      login_name: string;
      display_name: string;
      notes: string;
      roleId: string;
    }) => {
      const result = await createAdminMember({
        login_name: data.login_name,
        display_name: data.display_name,
        role_id: data.roleId,
      });
      if (data.notes) {
        await adminUpdateProfile(result.user_id, {
          ...(data.notes ? { notes: data.notes } : {}),
        });
      }
      return result;
    },
    onSuccess: async (payload) => {
      try {
        await copyPlainText(`${payload.temporary_login_name}\n${payload.temporary_password}`);
        notifySuccess(t("message.memberCreatedPasswordCopied", { display_name: payload.display_name }));
      } catch {
        notifyError(t("message.memberCreatedPasswordNotCopied", { display_name: payload.display_name }));
      }
      await Promise.all([
        invalidateAdminUsers(),
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.cmdk.all }),
      ]);
    },
    onError: (error) => showError(error, t("message.memberCreateFailed")),
  });

  const batchRoleMutation = useMutation({
    mutationFn: ({ userIds, newRole }: { userIds: string[]; newRole: string }) =>
      batchUpdateAdminUserRole({
        user_ids: userIds,
        new_role: newRole,
      }),
    onSuccess: async () => {
      notifySuccess(t("message.batchRoleUpdated"));
      await invalidateRoleAuthority();
    },
    onError: (error) => showError(error, t("message.batchRoleUpdateFailed")),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (userIds: string[]) => batchDeleteAdminUsers({ user_ids: userIds }),
    onSuccess: async () => {
      notifySuccess(t("message.batchDeleted"));
      await invalidateAdminUsers();
      setSelectedUserIds([]);
    },
    onError: (error) => showError(error, t("message.batchDeleteFailed")),
  });

  const batchDeactivateMutation = useMutation({
    mutationFn: (userIds: string[]) => batchDeactivateAdminUsers({ user_ids: userIds }),
    onSuccess: async () => {
      notifySuccess(t("message.batchDeactivated"));
      await invalidateAdminUsersAndSession();
    },
    onError: (error) => showError(error, t("message.batchDeactivateFailed")),
  });

  const batchReactivateMutation = useMutation({
    mutationFn: (userIds: string[]) => batchReactivateAdminUsers({ user_ids: userIds }),
    onSuccess: async () => {
      notifySuccess(t("message.batchReactivated"));
      await invalidateAdminUsersAndSession();
    },
    onError: (error) => showError(error, t("message.batchReactivateFailed")),
  });

  const createInviteMutation = useMutation({
    mutationFn: ({ roleId, maxUses, expiresAt }: { roleId: string; maxUses: number; expiresAt: string }) =>
      createAdminInviteLink({
        role_id: roleId,
        max_uses: maxUses,
        expires_at: fromDateTimeLocalValue(expiresAt),
      }),
    onSuccess: async () => {
      notifySuccess(t("message.inviteCreated"));
      await invalidateInviteData();
    },
    onError: (error) => showError(error, t("message.inviteCreateFailed")),
  });

  const exportAuditLogMutation = useMutation({
    mutationFn: (format: "csv" | "json") =>
      downloadAdminAuditLogExport({
        format,
        search: auditFilter.search.trim() || undefined,
        start_at: auditFilter.dateFrom && auditFilter.dateTo ? `${auditFilter.dateFrom}T00:00:00.000Z` : undefined,
        end_at: auditFilter.dateFrom && auditFilter.dateTo ? `${auditFilter.dateTo}T23:59:59.999Z` : undefined,
        entity_type: auditFilter.entityType || undefined,
        entity_id: auditFilter.entityId || undefined,
        actor_id: auditFilter.actorId || undefined,
      }),
    onSuccess: (blob, format) => {
      const startLabel = auditExportDatePart(auditFilter.dateFrom);
      const endLabel = auditExportDatePart(auditFilter.dateTo);
      downloadFileBlob(`guild-audit-${startLabel}-to-${endLabel}.${format}`, blob);
      notifySuccess(format === "csv" ? t("message.auditExportedCsv") : t("message.auditExportedJson"));
    },
    onError: (error) => showError(error, t("message.auditExportFailed")),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: revokeAdminInviteLink,
    onSuccess: async () => {
      notifySuccess(t("message.inviteRevoked"));
      await invalidateInviteData();
    },
    onError: (error) => showError(error, t("message.inviteRevokeFailed")),
  });

  const deleteInviteMutation = useMutation({
    mutationFn: deleteAdminInviteLink,
    onSuccess: async () => {
      notifySuccess(t("message.inviteDeleted"));
      await invalidateInviteData();
    },
    onError: (error) => showError(error, t("message.inviteDeleteFailed")),
  });

  const updateMemberProfileMutation = useMutation({
    mutationFn: async ({
      userId,
      profile,
      role,
      isActive,
    }: {
      userId: string;
      profile?: Pick<MemberDetailFormState, "power" | "classes" | "titleHtml" | "bio" | "notes">;
      role?: string;
      isActive?: boolean;
    }) => {
      await Promise.all([
        profile
          ? adminUpdateProfile(userId, {
              power: profile.power,
              classes: profile.classes,
              title_html: profile.titleHtml || null,
              bio: profile.bio || null,
              notes: profile.notes || null,
            })
          : Promise.resolve(),
        role ? updateAdminUserRole(userId, role) : Promise.resolve(),
        isActive === undefined
          ? Promise.resolve()
          : isActive
            ? reactivateAdminUser(userId)
            : deactivateAdminUser(userId),
      ]);
    },
    onSuccess: async () => {
      notifySuccess(t("message.memberProfileSaved"));
      await invalidateRoleAuthority();
    },
    onError: async (error) => {
      await invalidateRoleAuthority();
      showError(error, t("message.memberProfileSaveFailed"));
    },
  });

  const createRoleMutation = useMutation({
    mutationFn: createRole,
    onSuccess: async () => {
      notifySuccess(t("message.roleCreated"));
      await invalidateRoleAuthority();
    },
    onError: (error) => showError(error, t("message.roleCreateFailed")),
  });

  const updateRoleConfigMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateRole>[1] }) =>
      updateRole(id, payload),
    onSuccess: async () => {
      notifySuccess(t("message.roleConfigSaved"));
      await invalidateRoleAuthority();
    },
    onError: (error) => showError(error, t("message.roleConfigSaveFailed")),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: async () => {
      notifySuccess(t("message.roleDeleted"));
      await invalidateRoleAuthority();
    },
    onError: (error) => showError(error, t("message.roleDeleteFailed")),
  });

  const isBatchPending =
    batchRoleMutation.isPending ||
    batchDeleteMutation.isPending ||
    batchDeactivateMutation.isPending ||
    batchReactivateMutation.isPending;

  useEffect(() => {
    if (!isBatchPending) {
      if (batchProgress === 0) {
        return;
      }
      setBatchProgress(100);
      const timer = window.setTimeout(() => setBatchProgress(0), 900);
      return () => window.clearTimeout(timer);
    }

    setBatchProgress((current) => (current < 10 ? 10 : current));
    const timer = window.setInterval(() => {
      setBatchProgress((current) => (current >= 92 ? current : current + 7));
    }, 320);
    return () => window.clearInterval(timer);
  }, [batchProgress, isBatchPending]);

  const applyUserSelection = (keys: string[]) => {
    if (keys.length > batchSelectionLimit) {
      notifyWarning(t("message.batchSelectionLimit", { limit: batchSelectionLimit }));
    }
    setSelectedUserIds(keys.slice(0, batchSelectionLimit));
  };

  const getCappedUserIds = (userIds: string[]) => userIds.slice(0, batchSelectionLimit);

  const resolveNames = useCallback((userIds: string[]) => {
    return userIds.map((id) => resolveUsername(id) ?? id);
  }, [resolveUsername]);

  const confirmBatchAction = async (userIds: string[], message: string, names: string[]): Promise<boolean> => {
    if (userIds.length === 0) {
      return false;
    }
    const nameList = names.length > 0
      ? createElement("div", { style: { marginTop: 8 } },
          createElement("span", { style: { fontSize: "0.875rem", fontWeight: 600, display: "block", marginBottom: 4 } }, t("confirm.affectedMembers")),
          createElement("span", { style: { fontSize: "0.875rem", color: "var(--text-muted)", wordBreak: "break-word" as const } }, names.join("、")),
        )
      : null;
    return confirm({
      title: t("confirm.batchActionTitle"),
      description: createElement("div", null, message, nameList),
      confirmLabel: t("common:action.save"),
      cancelLabel: t("common:action.cancel"),
      intent: "warning",
    });
  };

  const handleBatchRole = async (userIds: string[], role: string, roleName: string) => {
    const targetIds = getCappedUserIds(userIds);
    const names = resolveNames(targetIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchRoleConfirm", {
        count: targetIds.length,
        role: roleName,
      }),
      names,
    );
    if (confirmed) {
      batchRoleMutation.mutate({ userIds: targetIds, newRole: role });
    }
  };

  const handleBatchActivate = async (userIds: string[]) => {
    const targetIds = getCappedUserIds(userIds);
    const names = resolveNames(targetIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchReactivateConfirm", { count: targetIds.length }),
      names,
    );
    if (confirmed) {
      batchReactivateMutation.mutate(targetIds);
    }
  };

  const handleBatchDeactivate = async (userIds: string[]) => {
    const targetIds = getCappedUserIds(userIds);
    const names = resolveNames(targetIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchDeactivateConfirm", { count: targetIds.length }),
      names,
    );
    if (confirmed) {
      batchDeactivateMutation.mutate(targetIds);
    }
  };

  const handleBatchDelete = async (userIds: string[]) => {
    const targetIds = getCappedUserIds(userIds);
    const names = resolveNames(targetIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchDeleteConfirm", { count: targetIds.length }),
      names,
    );
    if (confirmed) {
      batchDeleteMutation.mutate(targetIds);
    }
  };

  const createRoleConfig = async (payload: Parameters<typeof createRole>[0]) => {
    try {
      await createRoleMutation.mutateAsync(payload);
      return true;
    } catch {
      return false;
    }
  };

  const updateRoleConfig = async (id: string, payload: Parameters<typeof updateRole>[1]) => {
    try {
      await updateRoleConfigMutation.mutateAsync({ id, payload });
      return true;
    } catch {
      return false;
    }
  };

  const changeUserRole = (userId: string, role: string) => {
    const pending = runPendingAction(
      { resource: "user", resourceId: userId, action: "change-role" },
      () => updateRoleMutation.mutateAsync({ userId, role }),
    );
    if (pending) void pending.catch(() => undefined);
  };

  const activateUser = (userId: string) => {
    const pending = runPendingAction(
      { resource: "user", resourceId: userId, action: "activate" },
      () => reactivateMutation.mutateAsync(userId),
    );
    if (pending) void pending.catch(() => undefined);
  };

  const deactivateUser = (userId: string) => {
    const pending = runPendingAction(
      { resource: "user", resourceId: userId, action: "deactivate" },
      () => deactivateMutation.mutateAsync(userId),
    );
    if (pending) void pending.catch(() => undefined);
  };

  const resetUserPassword = (userId: string, currentPassword: string) => {
    const pending = runPendingAction(
      { resource: "user", resourceId: userId, action: "reset-password" },
      () => resetPasswordMutation.mutateAsync({ userId, currentPassword }),
    );
    return (pending ?? Promise.resolve()).then(() => undefined);
  };

  const resetUserLoginLock = async (userId: string, lockState: AdminLoginLockState) => {
    if (isActionPending({ resource: "user", resourceId: userId, action: "reset-login-lock" })) {
      return;
    }
    const confirmed = await confirm({
      title: t("confirm.loginLockTitle"),
      description: t("confirm.loginLockDescription", {
        display_name: resolveUsername(userId) ?? userId,
        seconds: lockState.retry_after_seconds,
      }),
      confirmLabel: t("member.resetLoginLock"),
      cancelLabel: t("common:action.cancel"),
      intent: "warning",
    });
    if (!confirmed) return;

    const pending = runPendingAction(
      { resource: "user", resourceId: userId, action: "reset-login-lock" },
      () => resetLoginLockMutation.mutateAsync(userId),
    );
    if (pending) await pending.catch(() => undefined);
  };

  const revokeInvite = (inviteId: string) => {
    if (
      isActionPending({ resource: "invite", resourceId: inviteId, action: "revoke" }) ||
      isActionPending({ resource: "invite", resourceId: inviteId, action: "delete" })
    ) {
      return;
    }
    const pending = runPendingAction(
      { resource: "invite", resourceId: inviteId, action: "revoke" },
      () => revokeInviteMutation.mutateAsync(inviteId),
    );
    if (pending) void pending.catch(() => undefined);
  };

  const deleteInvite = (inviteId: string) => {
    if (
      isActionPending({ resource: "invite", resourceId: inviteId, action: "revoke" }) ||
      isActionPending({ resource: "invite", resourceId: inviteId, action: "delete" })
    ) {
      return;
    }
    const pending = runPendingAction(
      { resource: "invite", resourceId: inviteId, action: "delete" },
      () => deleteInviteMutation.mutateAsync(inviteId),
    );
    if (pending) void pending.catch(() => undefined);
  };

  const isUserActionPending = (userId: string, action: AdminUserPendingAction) =>
    isActionPending({ resource: "user", resourceId: userId, action });

  const isInviteActionPending = (inviteId: string, action: AdminInvitePendingAction) =>
    isActionPending({ resource: "invite", resourceId: inviteId, action });

  const isRoleDeletePending = (roleId: string) =>
    isActionPending({ resource: "role", resourceId: roleId, action: "delete" });

  const deleteRoleConfig = async (id: string) => {
    const pending = runPendingAction(
      { resource: "role", resourceId: id, action: "delete" },
      () => deleteRoleMutation.mutateAsync(id),
    );
    if (!pending) {
      return false;
    }
    try {
      await pending;
      return true;
    } catch {
      return false;
    }
  };

  return {
    selectedUserIds,
    batchProgress,
    isBatchPending,
    updateRoleMutation,
    deactivateMutation,
    reactivateMutation,
    resetPasswordMutation,
    resetLoginLockMutation,
    createMemberMutation,
    batchRoleMutation,
    batchDeleteMutation,
    batchDeactivateMutation,
    batchReactivateMutation,
    createInviteMutation,
    exportAuditLogMutation,
    revokeInviteMutation,
    deleteInviteMutation,
    updateMemberProfileMutation,
    createRoleMutation,
    updateRoleConfigMutation,
    deleteRoleMutation,
    applyUserSelection,
    handleBatchRole,
    handleBatchActivate,
    handleBatchDeactivate,
    handleBatchDelete,
    createRoleConfig,
    updateRoleConfig,
    deleteRoleConfig,
    changeUserRole,
    activateUser,
    deactivateUser,
    resetUserPassword,
    resetUserLoginLock,
    revokeInvite,
    deleteInvite,
    isUserActionPending,
    isInviteActionPending,
    isRoleDeletePending,
  };
}
