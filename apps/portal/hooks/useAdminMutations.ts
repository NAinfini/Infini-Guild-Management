import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MemberDetailFormState } from "../components/feature/admin/AdminMemberDetailModal";
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
  downloadAdminAuditLogExport,
  reactivateAdminUser,
  resetAdminUserPassword,
  revokeAdminInviteLink,
  testAdminBotDispatch,
  updateAdminBotSettings,
  updateAdminUserRole,
} from "../services/AdminService";
import { queryKeys } from "../api/query-keys";
import { createRole, deleteRole, updateRole } from "../services/RoleService";
import { copyPlainText } from "../utils/copy";
import { auditExportDatePart, downloadFileBlob, toIsoOrUndefined } from "../utils/admin";
import type { BotSettingsState } from "./useAdminBotController";
import type { InviteState } from "./useAdminInviteController";

type AuditFilterState = {
  search: string;
  dateFrom: string;
  dateTo: string;
};

type UseAdminMutationsParams = {
  invite: InviteState;
  auditFilter: AuditFilterState;
  botSettings: BotSettingsState;
  batchSelectionLimit: number;
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useAdminMutations({
  invite,
  auditFilter,
  botSettings,
  batchSelectionLimit,
  showError,
}: UseAdminMutationsParams) {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState(0);

  const invalidateAdminUsers = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
  };

  const invalidateInviteData = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.inviteLinks() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.inviteStats() });
  };

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "admin" | "moderator" | "member" }) =>
      updateAdminUserRole(userId, role),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.roleUpdated") });
      await invalidateAdminUsers();
    },
    onError: (error) => showError(error, t("message.roleUpdateFailed")),
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => deactivateAdminUser(userId),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.deactivated") });
      await invalidateAdminUsers();
    },
    onError: (error) => showError(error, t("message.deactivateFailed")),
  });

  const reactivateMutation = useMutation({
    mutationFn: (userId: string) => reactivateAdminUser(userId),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.reactivated") });
      await invalidateAdminUsers();
    },
    onError: (error) => showError(error, t("message.reactivateFailed")),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (userId: string) => resetAdminUserPassword(userId),
    onSuccess: async (payload) => {
      await copyPlainText(payload.temporary_password);
      notifications.show({ color: "green", message: t("message.passwordResetCopied") });
    },
    onError: (error) => showError(error, t("message.passwordResetFailed")),
  });

  const createMemberMutation = useMutation({
    mutationFn: async (data: {
      username: string;
      discordName: string;
      wechatName: string;
      notes: string;
    }) => {
      const result = await createAdminMember({ username: data.username });
      if (data.wechatName || data.notes) {
        await adminUpdateProfile(result.user_id, {
          ...(data.wechatName ? { wechat_name: data.wechatName } : {}),
          ...(data.notes ? { notes: data.notes } : {}),
        });
      }
      return result;
    },
    onSuccess: async (payload) => {
      notifications.show({
        color: "green",
        message: t("message.memberCreatedPasswordCopied", { username: payload.username }),
      });
      await invalidateAdminUsers();
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    onError: (error) => showError(error, t("message.memberCreateFailed")),
  });

  const batchRoleMutation = useMutation({
    mutationFn: ({ userIds, newRole }: { userIds: string[]; newRole: "member" | "moderator" }) =>
      batchUpdateAdminUserRole({
        user_ids: userIds,
        new_role: newRole,
      }),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.batchRoleUpdated") });
      await invalidateAdminUsers();
    },
    onError: (error) => showError(error, t("message.batchRoleUpdateFailed")),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (userIds: string[]) => batchDeleteAdminUsers({ user_ids: userIds }),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.batchDeleted") });
      await invalidateAdminUsers();
      setSelectedUserIds([]);
    },
    onError: (error) => showError(error, t("message.batchDeleteFailed")),
  });

  const batchDeactivateMutation = useMutation({
    mutationFn: (userIds: string[]) => batchDeactivateAdminUsers({ user_ids: userIds }),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.batchDeactivated") });
      await invalidateAdminUsers();
    },
    onError: (error) => showError(error, t("message.batchDeactivateFailed")),
  });

  const batchReactivateMutation = useMutation({
    mutationFn: (userIds: string[]) => batchReactivateAdminUsers({ user_ids: userIds }),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.batchReactivated") });
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
      notifications.show({ color: "green", message: t("message.inviteCreated") });
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
      }),
    onSuccess: (blob, format) => {
      const startLabel = auditExportDatePart(auditFilter.dateFrom);
      const endLabel = auditExportDatePart(auditFilter.dateTo);
      downloadFileBlob(`guild-audit-${startLabel}-to-${endLabel}.${format}`, blob);
      notifications.show({
        color: "green",
        message: format === "csv" ? t("message.auditExportedCsv") : t("message.auditExportedJson"),
      });
    },
    onError: (error) => showError(error, t("message.auditExportFailed")),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: revokeAdminInviteLink,
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.inviteRevoked") });
      await invalidateInviteData();
    },
    onError: (error) => showError(error, t("message.inviteRevokeFailed")),
  });

  const deleteInviteMutation = useMutation({
    mutationFn: deleteAdminInviteLink,
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.inviteDeleted") });
      await invalidateInviteData();
    },
    onError: (error) => showError(error, t("message.inviteDeleteFailed")),
  });

  const updateBotSettingsMutation = useMutation({
    mutationFn: async () => {
      const payload: Parameters<typeof updateAdminBotSettings>[0] = {
        discord: {
          guild_id: botSettings.discordGuildId.trim(),
          notification_channel_id: botSettings.discordNotificationChannelId.trim(),
          team_comp_channel_id: botSettings.discordTeamCompChannelId.trim(),
          default_toggles: botSettings.discordDefaultToggles,
        },
        wechat: {
          room_ids: botSettings.wechatRoomIdsText
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
          default_toggles: botSettings.wechatDefaultToggles,
        },
      };
      return updateAdminBotSettings(payload);
    },
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.botSettingsSaved") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.botSettings() });
    },
    onError: (error) => showError(error, t("message.botSettingsSaveFailed")),
  });

  const testBotDispatchMutation = useMutation({
    mutationFn: ({ platform }: { platform: "discord" | "wechat" }) => testAdminBotDispatch({ platform }),
    onSuccess: (_, variables) => {
      notifications.show({
        color: "green",
        message: variables.platform === "discord" ? t("message.botTestDiscordSent") : t("message.botTestWechatSent"),
      });
    },
    onError: (error) => showError(error, t("message.botTestSendFailed")),
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
        wechat_name: form.wechatName || null,
        power: form.power,
        classes: form.classes as ClassName[],
        title_html: form.titleHtml || null,
        bio: form.bio || null,
        vacation_start: form.vacationStart ? new Date(form.vacationStart).toISOString() : null,
        vacation_end: form.vacationEnd ? new Date(form.vacationEnd).toISOString() : null,
        discord_reminder_opt_out: form.discordReminderOptOut,
        notes: form.notes || null,
      });
      try {
        await updateAdminUserRole(userId, form.role as "admin" | "moderator" | "member");
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
      notifications.show({ color: "green", message: t("message.memberProfileSaved") });
      await invalidateAdminUsers();
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    onError: (error) => showError(error, t("message.memberProfileSaveFailed")),
  });

  const createRoleMutation = useMutation({
    mutationFn: createRole,
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.roleCreated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles() });
    },
    onError: (error) => showError(error, t("message.roleCreateFailed")),
  });

  const updateRoleConfigMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateRole>[1] }) =>
      updateRole(id, payload),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.roleConfigSaved") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles() });
    },
    onError: (error) => showError(error, t("message.roleConfigSaveFailed")),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.roleDeleted") });
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
      notifications.show({
        color: "yellow",
        message: t("message.batchSelectionLimit", { limit: batchSelectionLimit }),
      });
    }
    setSelectedUserIds(keys.slice(0, batchSelectionLimit));
  };

  const getCappedUserIds = (userIds: string[]) => userIds.slice(0, batchSelectionLimit);

  const confirmBatchAction = async (userIds: string[], message: string): Promise<boolean> => {
    if (userIds.length === 0) {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      modals.openConfirmModal({
        title: t("confirm.batchActionTitle"),
        children: message,
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

  const handleBatchRole = async (userIds: string[], role: "member" | "moderator") => {
    const targetIds = getCappedUserIds(userIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchRoleConfirm", {
        count: targetIds.length,
        role: t(`role.${role}`),
      }),
    );
    if (confirmed) {
      batchRoleMutation.mutate({ userIds: targetIds, newRole: role });
    }
  };

  const handleBatchActivate = async (userIds: string[]) => {
    const targetIds = getCappedUserIds(userIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchReactivateConfirm", { count: targetIds.length }),
    );
    if (confirmed) {
      batchReactivateMutation.mutate(targetIds);
    }
  };

  const handleBatchDeactivate = async (userIds: string[]) => {
    const targetIds = getCappedUserIds(userIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchDeactivateConfirm", { count: targetIds.length }),
    );
    if (confirmed) {
      batchDeactivateMutation.mutate(targetIds);
    }
  };

  const handleBatchDelete = async (userIds: string[]) => {
    const targetIds = getCappedUserIds(userIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchDeleteConfirm", { count: targetIds.length }),
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
    createMemberMutation,
    batchRoleMutation,
    batchDeleteMutation,
    batchDeactivateMutation,
    batchReactivateMutation,
    createInviteMutation,
    exportAuditLogMutation,
    revokeInviteMutation,
    deleteInviteMutation,
    updateBotSettingsMutation,
    testBotDispatchMutation,
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
