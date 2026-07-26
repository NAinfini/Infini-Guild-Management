import { modals } from "@mantine/modals";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createElement, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess, notifyWarning, notifyError } from "../utils/notifications";
import type { MemberDetailFormState } from "../types/admin";
import type { ClassName } from "@guild/shared";
import {
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
import { auditExportDatePart, downloadFileBlob, toIsoOrUndefined } from "../utils/admin";
import type { InviteState } from "./useAdminInviteController";

type AuditFilterState = {
  search: string;
  dateFrom: string;
  dateTo: string;
  entityType: string;
  actorId: string;
};

type UseAdminMutationsParams = {
  invite: InviteState;
  auditFilter: AuditFilterState;
  batchSelectionLimit: number;
  showError: (error: unknown, fallbackMessage: string) => void;
  resolveUsername: (userId: string) => string | undefined;
};

export function useAdminMutations({
  invite,
  auditFilter,
  batchSelectionLimit,
  showError,
  resolveUsername,
}: UseAdminMutationsParams) {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState(0);

  const invalidateAdminUsers = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
  };

  const invalidateInviteData = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.inviteLinks() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.inviteStats() });
  };

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      updateAdminUserRole(userId, role),
    onSuccess: async () => {
      notifySuccess(t("message.roleUpdated"));
      await invalidateAdminUsers();
    },
    onError: (error) => showError(error, t("message.roleUpdateFailed")),
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => deactivateAdminUser(userId),
    onSuccess: async () => {
      notifySuccess(t("message.deactivated"));
      await invalidateAdminUsers();
    },
    onError: (error) => showError(error, t("message.deactivateFailed")),
  });

  const reactivateMutation = useMutation({
    mutationFn: (userId: string) => reactivateAdminUser(userId),
    onSuccess: async () => {
      notifySuccess(t("message.reactivated"));
      await invalidateAdminUsers();
    },
    onError: (error) => showError(error, t("message.reactivateFailed")),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (userId: string) => resetAdminUserPassword(userId),
    onSuccess: async (payload) => {
      await copyPlainText(payload.temporary_password);
      notifySuccess(t("message.passwordResetCopied"));
    },
    onError: (error) => showError(error, t("message.passwordResetFailed")),
  });

  const resetLoginLockMutation = useMutation({
    mutationFn: (userId: string) => resetAdminUserLoginLock(userId),
    onSuccess: () => {
      notifySuccess(t("message.loginLockCleared"));
    },
    onError: (error) => showError(error, t("message.loginLockClearFailed")),
  });

  const createMemberMutation = useMutation({
    mutationFn: async (data: {
      username: string;
      notes: string;
    }) => {
      const result = await createAdminMember({ username: data.username });
      if (data.notes) {
        await adminUpdateProfile(result.user_id, {
          ...(data.notes ? { notes: data.notes } : {}),
        });
      }
      return result;
    },
    onSuccess: async (payload) => {
      try {
        await copyPlainText(payload.temporary_password);
        notifySuccess(t("message.memberCreatedPasswordCopied", { username: payload.username }));
      } catch {
        notifyError(t("message.memberCreatedPasswordNotCopied", { username: payload.username }));
      }
      await invalidateAdminUsers();
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
      await invalidateAdminUsers();
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
      await invalidateAdminUsers();
    },
    onError: (error) => showError(error, t("message.batchDeactivateFailed")),
  });

  const batchReactivateMutation = useMutation({
    mutationFn: (userIds: string[]) => batchReactivateAdminUsers({ user_ids: userIds }),
    onSuccess: async () => {
      notifySuccess(t("message.batchReactivated"));
      await invalidateAdminUsers();
    },
    onError: (error) => showError(error, t("message.batchReactivateFailed")),
  });

  const createInviteMutation = useMutation({
    mutationFn: () =>
      createAdminInviteLink({
        max_uses: invite.maxUses,
        expires_at: toIsoOrUndefined(invite.expiresAt),
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
        start_at: auditFilter.dateFrom ? `${auditFilter.dateFrom}T00:00:00.000Z` : undefined,
        end_at: auditFilter.dateTo ? `${auditFilter.dateTo}T23:59:59.999Z` : undefined,
        entity_type: auditFilter.entityType || undefined,
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
      form,
    }: {
      userId: string;
      form: MemberDetailFormState;
    }) => {
      await adminUpdateProfile(userId, {
        power: form.power,
        classes: form.classes as ClassName[],
        title_html: form.titleHtml || null,
        bio: form.bio || null,
        notes: form.notes || null,
      });
      try {
        await updateAdminUserRole(userId, form.role);
      } catch {
        throw new Error("Profile saved but role update failed");
      }
      try {
        if (form.isActive) {
          await reactivateAdminUser(userId);
        } else {
          await deactivateAdminUser(userId);
        }
      } catch {
        throw new Error("Profile and role saved but status update failed");
      }
    },
    onSuccess: async () => {
      notifySuccess(t("message.memberProfileSaved"));
      await invalidateAdminUsers();
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.all });
    },
    onError: async (error) => {
      await invalidateAdminUsers();
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.all });
      if (error instanceof Error && error.message === "Profile saved but role update failed") {
        notifyError(t("message.memberProfileSavedRoleFailed"));
        return;
      }
      if (error instanceof Error && error.message === "Profile and role saved but status update failed") {
        notifyError(t("message.memberProfileSavedStatusFailed"));
        return;
      }
      showError(error, t("message.memberProfileSaveFailed"));
    },
  });

  const createRoleMutation = useMutation({
    mutationFn: createRole,
    onSuccess: async () => {
      notifySuccess(t("message.roleCreated"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles() });
    },
    onError: (error) => showError(error, t("message.roleCreateFailed")),
  });

  const updateRoleConfigMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateRole>[1] }) =>
      updateRole(id, payload),
    onSuccess: async () => {
      notifySuccess(t("message.roleConfigSaved"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles() });
    },
    onError: (error) => showError(error, t("message.roleConfigSaveFailed")),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: async () => {
      notifySuccess(t("message.roleDeleted"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles() });
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
          createElement("span", { style: { fontSize: "0.875rem", color: "var(--mantine-color-dimmed)", wordBreak: "break-word" as const } }, names.join("、")),
        )
      : null;
    return new Promise<boolean>((resolve) => {
      modals.openConfirmModal({
        title: t("confirm.batchActionTitle"),
        children: createElement("div", null, message, nameList),
        labels: { confirm: t("common:action.save"), cancel: t("common:action.cancel") },
        confirmProps: { color: "yellow" },
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
        closeOnConfirm: true,
        closeOnCancel: true,
        centered: true,
      });
    });
  };

  const handleBatchRole = async (userIds: string[], role: string) => {
    const targetIds = getCappedUserIds(userIds);
    const names = resolveNames(targetIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchRoleConfirm", {
        count: targetIds.length,
        role: t(`role.${role}`),
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

  const deleteRoleConfig = async (id: string) => {
    try {
      await deleteRoleMutation.mutateAsync(id);
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
  };
}
