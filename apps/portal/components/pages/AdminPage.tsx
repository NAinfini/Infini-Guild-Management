import { hasRoleAtLeast } from "@guild/shared";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Tabs,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  batchDeactivateAdminUsers,
  batchDeleteAdminUsers,
  batchReactivateAdminUsers,
  batchUpdateAdminUserRole,
  createAdminMember,
  createAdminInviteLink,
  deactivateAdminUser,
  reactivateAdminUser,
  resetAdminUserPassword,
  revokeAdminInviteLink,
  testAdminBotDispatch,
  updateAdminBotSettings,
  updateAdminUserRole,
} from "../../api/mutations/admin";
import {
  createRole,
  deleteRole,
  updateRole,
} from "../../api/mutations/roles";
import {
  updateMyProfile,
} from "../../api/mutations/users";
import {
  downloadAdminAuditLogExport,
} from "../../api/queries/admin";
import { queryKeys } from "../../api/query-keys";
import { useAdminData } from "../../hooks/data/useAdminData";
import { usePageHeaderActions } from "../../context/PageHeaderContext";
import { useAppError } from "../../hooks/useAppError";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useAuthStore } from "../../stores/auth";
import { copyPlainText } from "../../utils/copy";
import { PageLayout } from "../layout/PageLayout";
import "./AdminPage.css";

const LazyAdminStatusTab = lazy(() =>
  import("../feature/admin/AdminStatusTab").then((mod) => ({ default: mod.AdminStatusTab })),
);
const LazyAdminUsersSection = lazy(() =>
  import("../feature/admin/AdminUsersSection").then((mod) => ({ default: mod.AdminUsersSection })),
);
const LazyAdminAuditSection = lazy(() =>
  import("../feature/admin/AdminAuditSection").then((mod) => ({ default: mod.AdminAuditSection })),
);
const LazyAdminInviteSection = lazy(() =>
  import("../feature/admin/AdminInviteSection").then((mod) => ({ default: mod.AdminInviteSection })),
);
const LazyAdminBotSection = lazy(() =>
  import("../feature/admin/AdminBotSection").then((mod) => ({ default: mod.AdminBotSection })),
);
const LazyAdminRolesSection = lazy(() =>
  import("../feature/admin/AdminRolesSection").then((mod) => ({ default: mod.AdminRolesSection })),
);
const LazyAdminMemberDetailModal = lazy(() =>
  import("../feature/admin/AdminMemberDetailModal").then((mod) => ({ default: mod.AdminMemberDetailModal })),
);
const LazyAdminMemberMediaTab = lazy(() =>
  import("../feature/admin/AdminMemberMediaTab").then((mod) => ({ default: mod.AdminMemberMediaTab })),
);

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

function toIsoOrUndefined(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function downloadFileBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function auditExportDatePart(value: string): string {
  return value && value.trim().length > 0 ? value.trim() : "auto";
}

const BATCH_SELECTION_LIMIT = 50;

function maskIdentifier(value: string, isAdmin: boolean): string {
  if (isAdmin) {
    return value;
  }
  if (value.length <= 6) {
    return `${value.slice(0, 1)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

function formatAuditDiffHeader(diffTitle: string | null, detailText: string | null): string {
  if (diffTitle && diffTitle.trim().length > 0) {
    return diffTitle.trim();
  }
  if (!detailText || detailText.trim().length === 0) {
    return "-";
  }
  try {
    const parsed = JSON.parse(detailText) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed).slice(0, 2);
      if (entries.length > 0) {
        return entries
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join(" | ");
      }
    }
  } catch {
    // ignore parse errors, fallback to raw
  }
  return detailText.length > 100 ? `${detailText.slice(0, 100)}...` : detailText;
}

function sectionHeading(text: string) {
  return (
    <Title order={3} style={{ margin: 0, fontSize: 16 }}>
      {text}
    </Title>
  );
}

import type { ColumnDef as TanStackColumnDef } from "@tanstack/react-table";

export function AdminPage() {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isModerator = Boolean(user && hasRoleAtLeast(user.role, "moderator"));
  const isAdmin = user?.role === "admin";
  const { showError } = useAppError();

  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("member");

  const [inviteVisibility, setInviteVisibility] = useState<"active" | "expired" | "revoked">("active");
  const [inviteMaxUses, setInviteMaxUses] = useState<number>(10);
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");
  const [inviteSearch, setInviteSearch] = useState("");

  const [auditPage, setAuditPage] = useState(1);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditDateFrom, setAuditDateFrom] = useState(() => format(subDays(new Date(), 1), "yyyy-MM-dd"));
  const [auditDateTo, setAuditDateTo] = useState(() => format(new Date(), "yyyy-MM-dd"));


  const [botSettingsJson, setBotSettingsJson] = useState("");
  const [discordGuildId, setDiscordGuildId] = useState("");
  const [discordNotificationChannelId, setDiscordNotificationChannelId] = useState("");
  const [discordTeamCompChannelId, setDiscordTeamCompChannelId] = useState("");
  const [discordDefaultToggles, setDiscordDefaultToggles] = useState<Record<string, boolean>>({});
  const [wechatRoomIdsText, setWechatRoomIdsText] = useState("");
  const [wechatDefaultToggles, setWechatDefaultToggles] = useState<Record<string, boolean>>({});
  const [memberDetailId, setMemberDetailId] = useState<string | null>(null);
  const [memberDetailTitle, setMemberDetailTitle] = useState("");
  const [memberDetailBio, setMemberDetailBio] = useState("");
  const [batchProgress, setBatchProgress] = useState(0);
  const [statusLatencyMs, setStatusLatencyMs] = useState<number | null>(null);
  const [statusHealthLogs, setStatusHealthLogs] = useState<
    Array<{ at: string; db: string; r2: string; ws: string; crons: string; latencyMs: number | null }>
  >([]);

  const {
    usersQuery,
    inviteLinksQuery,
    inviteStatsQuery,
    auditLogQuery,
    auditMonthsQuery,
    botSettingsQuery,
    rolesQuery,
    discordChannelsQuery,
    statusQuery,
  } = useAdminData({
    isModerator,
    isAdmin,
    auditPage,
    auditSearch,
    auditDateFrom,
    auditDateTo,
    discordGuildId,
  });

  useEffect(() => {
    if (!botSettingsQuery.data) return;
    setBotSettingsJson(JSON.stringify(botSettingsQuery.data, null, 2));
    setDiscordGuildId(botSettingsQuery.data.discord.guild_id);
    setDiscordNotificationChannelId(botSettingsQuery.data.discord.notification_channel_id);
    setDiscordTeamCompChannelId(botSettingsQuery.data.discord.team_comp_channel_id);
    setDiscordDefaultToggles(botSettingsQuery.data.discord.default_toggles);
    setWechatRoomIdsText(botSettingsQuery.data.wechat.room_ids.join(", "));
    setWechatDefaultToggles(botSettingsQuery.data.wechat.default_toggles);
  }, [botSettingsQuery.data]);

  useEffect(() => {
    if (!memberDetailId) {
      setMemberDetailTitle("");
      setMemberDetailBio("");
      return;
    }
    const target = usersQuery.data?.data.find((row) => row.user.id === memberDetailId);
    if (!target) {
      setMemberDetailTitle("");
      setMemberDetailBio("");
      return;
    }
    setMemberDetailTitle(target.profile.title_html ?? "");
    setMemberDetailBio(target.profile.bio ?? "");
  }, [memberDetailId, usersQuery.data?.data]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("admin.status.health.logs");
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const next = parsed
          .filter((item) => item && typeof item === "object")
          .map((item) => item as { at: string; db: string; r2: string; ws: string; crons: string; latencyMs: number | null })
          .slice(0, 10);
        setStatusHealthLogs(next);
      }
    } catch {
      // ignore invalid persisted logs
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("admin.status.health.logs", JSON.stringify(statusHealthLogs.slice(0, 10)));
    } catch {
      // ignore storage write errors
    }
  }, [statusHealthLogs]);

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "admin" | "moderator" | "member" }) =>
      updateAdminUserRole(userId, role),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.roleUpdated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
    onError: (error) => showError(error, t("message.roleUpdateFailed")),
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => deactivateAdminUser(userId),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.deactivated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
    onError: (error) => showError(error, t("message.deactivateFailed")),
  });

  const reactivateMutation = useMutation({
    mutationFn: (userId: string) => reactivateAdminUser(userId),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.reactivated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
    onError: (error) => showError(error, t("message.reactivateFailed")),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (userId: string) => resetAdminUserPassword(userId),
    onSuccess: (payload) => {
      void copyPlainText(payload.temporary_password);
      notifications.show({ color: "infini-success", message: t("message.passwordResetCopied") });
    },
    onError: (error) => showError(error, t("message.passwordResetFailed")),
  });

  const createMemberMutation = useMutation({
    mutationFn: ({ username }: { username: string }) => createAdminMember({ username }),
    onSuccess: async (payload) => {
      await copyPlainText(payload.temporary_password);
      notifications.show({
        color: "infini-success",
        message: t("message.memberCreatedPasswordCopied", { username: payload.username }),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    onError: (error) => showError(error, t("message.memberCreateFailed")),
  });

  const batchRoleMutation = useMutation({
    mutationFn: ({
      userIds,
      newRole,
    }: {
      userIds: string[];
      newRole: "member" | "moderator";
    }) =>
      batchUpdateAdminUserRole({
        user_ids: userIds,
        new_role: newRole,
      }),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.batchRoleUpdated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
    onError: (error) => showError(error, t("message.batchRoleUpdateFailed")),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (userIds: string[]) => batchDeleteAdminUsers({ user_ids: userIds }),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.batchDeleted") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      setSelectedUserIds([]);
    },
    onError: (error) => showError(error, t("message.batchDeleteFailed")),
  });

  const batchDeactivateMutation = useMutation({
    mutationFn: (userIds: string[]) => batchDeactivateAdminUsers({ user_ids: userIds }),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.batchDeactivated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
    onError: (error) => showError(error, t("message.batchDeactivateFailed")),
  });

  const batchReactivateMutation = useMutation({
    mutationFn: (userIds: string[]) => batchReactivateAdminUsers({ user_ids: userIds }),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.batchReactivated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
    onError: (error) => showError(error, t("message.batchReactivateFailed")),
  });

  const createInviteMutation = useMutation({
    mutationFn: () =>
      createAdminInviteLink({
        max_uses: inviteMaxUses,
        expires_at: toIsoOrUndefined(inviteExpiresAt),
      }),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.inviteCreated") });
      setInviteExpiresAt("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.inviteLinks() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.inviteStats() });
    },
    onError: (error) => showError(error, t("message.inviteCreateFailed")),
  });

  const exportAuditLogMutation = useMutation({
    mutationFn: (format: "csv" | "json") =>
      downloadAdminAuditLogExport({
        format,
        search: auditSearch.trim() || undefined,
        start_at: auditDateFrom ? `${auditDateFrom}T00:00:00.000Z` : undefined,
        end_at: auditDateTo ? `${auditDateTo}T23:59:59.999Z` : undefined,
      }),
    onSuccess: (blob, format) => {
      const startLabel = auditExportDatePart(auditDateFrom);
      const endLabel = auditExportDatePart(auditDateTo);
      downloadFileBlob(`guild-audit-${startLabel}-to-${endLabel}.${format}`, blob);
      notifications.show({
        color: "infini-success",
        message: format === "csv" ? t("message.auditExportedCsv") : t("message.auditExportedJson"),
      });
    },
    onError: (error) => showError(error, t("message.auditExportFailed")),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: revokeAdminInviteLink,
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.inviteRevoked") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.inviteLinks() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.inviteStats() });
    },
    onError: (error) => showError(error, t("message.inviteRevokeFailed")),
  });

  const updateBotSettingsMutation = useMutation({
    mutationFn: async () => {
      const payload: Parameters<typeof updateAdminBotSettings>[0] = {
        discord: {
          guild_id: discordGuildId.trim(),
          notification_channel_id: discordNotificationChannelId.trim(),
          team_comp_channel_id: discordTeamCompChannelId.trim(),
          default_toggles: discordDefaultToggles,
        },
        wechat: {
          room_ids: wechatRoomIdsText
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
          default_toggles: wechatDefaultToggles,
        },
      };
      setBotSettingsJson(JSON.stringify(payload, null, 2));
      return updateAdminBotSettings(payload);
    },
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.botSettingsSaved") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.botSettings() });
    },
    onError: (error) => showError(error, t("message.botSettingsSaveFailed")),
  });

  const testBotDispatchMutation = useMutation({
    mutationFn: ({ platform }: { platform: "discord" | "wechat" }) => testAdminBotDispatch({ platform }),
    onSuccess: (_, variables) => {
      notifications.show({
        color: "infini-success",
        message: variables.platform === "discord" ? t("message.botTestDiscordSent") : t("message.botTestWechatSent"),
      });
    },
    onError: (error) => showError(error, t("message.botTestSendFailed")),
  });

  const updateMemberProfileMutation = useMutation({
    mutationFn: ({
      userId,
      titleHtml,
      bio,
    }: {
      userId: string;
      titleHtml: string;
      bio: string;
    }) =>
      updateMyProfile(userId, {
        title_html: titleHtml || null,
        bio: bio || null,
      }),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.memberProfileSaved") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    onError: (error) => showError(error, t("message.memberProfileSaveFailed")),
  });

  const createRoleMutation = useMutation({
    mutationFn: createRole,
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.roleCreated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles() });
    },
    onError: (error) => showError(error, t("message.roleCreateFailed")),
  });

  const updateRoleConfigMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateRole>[1] }) =>
      updateRole(id, payload),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.roleConfigSaved") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles() });
    },
    onError: (error) => showError(error, t("message.roleConfigSaveFailed")),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.roleDeleted") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.roles() });
    },
    onError: (error) => showError(error, t("message.roleDeleteFailed")),
  });

  const userRows = usersQuery.data?.data ?? [];
  const inviteRowsRaw = inviteLinksQuery.data ?? [];
  const isInviteInactive = (row: (typeof inviteRowsRaw)[number]) => {
    const expiredByDate = Boolean(row.expires_at && Date.parse(row.expires_at) <= Date.now());
    const fullyUsed = row.used_count >= row.max_uses;
    return Boolean(row.revoked_at) || expiredByDate || fullyUsed;
  };
  const inviteRows = inviteRowsRaw.filter((row) => {
    // Category filter
    if (inviteVisibility === "revoked") {
      if (!row.revoked_at) return false;
    } else if (inviteVisibility === "expired") {
      // Expired but NOT revoked (expired by date or fully used)
      if (row.revoked_at) return false;
      const expiredByDate = Boolean(row.expires_at && Date.parse(row.expires_at) <= Date.now());
      const fullyUsed = row.used_count >= row.max_uses;
      if (!expiredByDate && !fullyUsed) return false;
    } else {
      // Active: not inactive
      if (isInviteInactive(row)) return false;
    }
    // Search filter
    if (inviteSearch.trim()) {
      const q = inviteSearch.toLowerCase();
      const matches =
        row.code.toLowerCase().includes(q) ||
        (row.created_at && row.created_at.toLowerCase().includes(q)) ||
        (row.expires_at && row.expires_at.toLowerCase().includes(q));
      if (!matches) return false;
    }
    return true;
  });
  const auditRows = auditLogQuery.data?.data ?? [];
  const selectedMemberDetail = memberDetailId
    ? userRows.find((row) => row.user.id === memberDetailId) ?? null
    : null;
  const refreshMemberData = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.all });
  };

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
    if (keys.length > BATCH_SELECTION_LIMIT) {
      notifications.show({ color: "infini-warning", message: t("message.batchSelectionLimit", { limit: BATCH_SELECTION_LIMIT }) });
    }
    setSelectedUserIds(keys.slice(0, BATCH_SELECTION_LIMIT));
  };

  const getCappedUserIds = (userIds: string[]) => userIds.slice(0, BATCH_SELECTION_LIMIT);

  const confirmBatchAction = async (userIds: string[], message: string): Promise<boolean> => {
    if (userIds.length === 0) {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      modals.openConfirmModal({
        title: t("confirm.batchActionTitle"),
        children: message,
        confirmProps: { color: "infini-warning" },
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
        closeOnConfirm: true,
        closeOnCancel: true,
        centered: true,
      });
    });
  };

  const handleBatchRole = async (
    userIds: string[],
    role: "member" | "moderator",
  ) => {
    const targetIds = getCappedUserIds(userIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchRoleConfirm", {
        count: targetIds.length,
        role: t(`role.${role}`),
      }),
    );
    if (!confirmed) {
      return;
    }
    batchRoleMutation.mutate({ userIds: targetIds, newRole: role });
  };

  const handleBatchActivate = async (userIds: string[]) => {
    const targetIds = getCappedUserIds(userIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchReactivateConfirm", {
        count: targetIds.length,
      }),
    );
    if (!confirmed) {
      return;
    }
    batchReactivateMutation.mutate(targetIds);
  };

  const handleBatchDeactivate = async (userIds: string[]) => {
    const targetIds = getCappedUserIds(userIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchDeactivateConfirm", {
        count: targetIds.length,
      }),
    );
    if (!confirmed) {
      return;
    }
    batchDeactivateMutation.mutate(targetIds);
  };

  const handleBatchDelete = async (userIds: string[]) => {
    const targetIds = getCappedUserIds(userIds);
    const confirmed = await confirmBatchAction(
      targetIds,
      t("member.batchDeleteConfirm", {
        count: targetIds.length,
      }),
    );
    if (!confirmed) {
      return;
    }
    batchDeleteMutation.mutate(targetIds);
  };

  const refreshStatus = useCallback(async () => {
    const started = performance.now();
    const result = await statusQuery.refetch();
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    setStatusLatencyMs(latencyMs);
    const status = result.data;
    if (status) {
      setStatusHealthLogs((current) =>
        [
          {
            at: new Date().toISOString(),
            db: status.db,
            r2: status.r2,
            ws: status.ws,
            crons: status.crons,
            latencyMs,
          },
          ...current,
        ].slice(0, 10),
      );
    }
    return result;
  }, [statusQuery.refetch]);

  useEffect(() => {
    if (!isAdmin || activeTab !== "status") {
      return;
    }
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeTab, isAdmin, refreshStatus]);

  const copyConfigSummary = async () => {
    const bot = botSettingsQuery.data;
    const status = statusQuery.data;
    const lines = [
      t("status.summary.title"),
      t("status.summary.db", { value: status?.db ?? t("status.summary.unknown") }),
      t("status.summary.r2", { value: status?.r2 ?? t("status.summary.unknown") }),
      t("status.summary.ws", { value: status?.ws ?? t("status.summary.unknown") }),
      t("status.summary.crons", { value: status?.crons ?? t("status.summary.unknown") }),
      t("status.summary.discordGuild", { value: bot?.discord.guild_id ?? "" }),
      t("status.summary.discordNotifyChannel", { value: bot?.discord.notification_channel_id ?? "" }),
      t("status.summary.discordTeamChannel", { value: bot?.discord.team_comp_channel_id ?? "" }),
      t("status.summary.wechatRooms", { value: (bot?.wechat.room_ids ?? []).join(", ") }),
    ];
    await copyPlainText(lines.join("\n"));
    notifications.show({ color: "infini-success", message: t("message.configSummaryCopied") });
  };

  const botToggleKeys = Array.from(
    new Set([
      "event_notify",
      "team_comp",
      "reminder",
      "war_result",
      ...Object.keys(discordDefaultToggles),
      ...Object.keys(wechatDefaultToggles),
    ]),
  );

  const discordChannelOptions = useMemo(() => {
    const options = (discordChannelsQuery.data?.channels ?? []).map((channel) => ({
      value: channel.id,
      label: `#${channel.name} (${channel.type})`,
    }));
    const hasOption = (id: string) => options.some((option) => option.value === id);
    if (discordNotificationChannelId && !hasOption(discordNotificationChannelId)) {
      options.push({
        value: discordNotificationChannelId,
        label: `#${discordNotificationChannelId} (configured)`,
      });
    }
    if (discordTeamCompChannelId && !hasOption(discordTeamCompChannelId)) {
      options.push({
        value: discordTeamCompChannelId,
        label: `#${discordTeamCompChannelId} (configured)`,
      });
    }
    return options;
  }, [
    discordChannelsQuery.data?.channels,
    discordNotificationChannelId,
    discordTeamCompChannelId,
  ]);
  const inviteCreateLabel = t("invite.create");

  const userColumns: TanStackColumnDef<(typeof userRows)[number], unknown>[] = [
    {
      header: t("member.table.username"),
      id: "username",
      accessorFn: (row) => row.user.username,
    },
    {
      header: "WeChat",
      id: "wechat",
      accessorFn: (row) => row.profile.wechat_name ?? "",
      cell: ({ row }) => row.original.profile.wechat_name ?? "-",
    },
    {
      header: t("member.table.discord"),
      id: "discord",
      accessorFn: (row) => row.profile.discord_id ?? "",
      cell: ({ row }) => row.original.profile.discord_id ?? "-",
    },
    {
      header: "Class",
      id: "class",
      accessorFn: (row) => row.profile.classes[0] ?? "",
      cell: ({ row }) => row.original.profile.classes[0] ?? "-",
    },
    {
      header: "Power",
      id: "power",
      accessorFn: (row) => row.profile.power,
    },
    {
      header: t("member.table.notes"),
      id: "notes",
      enableSorting: false,
      cell: ({ row }) => (isAdmin ? row.original.profile.notes ?? "-" : t("member.table.restricted")),
    },
    {
      header: t("member.table.role"),
      id: "role",
      accessorFn: (row) => row.user.role,
      cell: ({ row }) => (
        <Badge color={row.original.user.role === "admin" ? "red" : row.original.user.role === "moderator" ? "yellow" : "blue"}>
          {t(`role.${row.original.user.role}`)}
        </Badge>
      ),
    },
    {
      header: t("member.table.active"),
      id: "active",
      accessorFn: (row) => row.user.is_active,
      cell: ({ row }) => (row.original.user.is_active ? <Badge color="infini-success">{t("member.status.active")}</Badge> : <Badge color="gray">{t("member.status.inactive")}</Badge>),
    },
  ];

  const adminHeaderActions = useMemo(
    () =>
      isAdmin && isModerator ? (
        <Group gap={8} wrap="wrap">
          {activeTab === "invite" ? (
            <MotionButton type="primary" onClick={() => createInviteMutation.mutate()} loading={createInviteMutation.isPending}>
              {inviteCreateLabel}
            </MotionButton>
          ) : null}
          {activeTab === "status" ? (
            <Button onClick={() => void refreshStatus()} loading={statusQuery.isFetching}>
              {t("status.refresh")}
            </Button>
          ) : null}
        </Group>
      ) : null,
    [
      activeTab,
      createInviteMutation.isPending,
      createInviteMutation.mutate,
      inviteCreateLabel,
      isAdmin,
      isModerator,
      refreshStatus,
      statusQuery.isFetching,
    ],
  );
  usePageHeaderActions(adminHeaderActions);
  useLoadWarningToast(
    usersQuery.isError ||
      inviteLinksQuery.isError ||
      inviteStatsQuery.isError ||
      auditLogQuery.isError ||
      auditMonthsQuery.isError ||
      botSettingsQuery.isError ||
      rolesQuery.isError ||
      discordChannelsQuery.isError ||
      statusQuery.isError,
    t("common:loadErrorRetry"),
  );
  const suspenseFallback = (
    <Card withBorder p="md">
      <Center>
        <Loader size="sm" />
      </Center>
    </Card>
  );

  if (!isModerator) {
    return <Alert color="infini-danger" title={t("forbidden")} />;
  }

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} className="admin-page">
      <Tabs value={activeTab} onChange={(value) => value && setActiveTab(value)}>
        <Tabs.List>
          <Tabs.Tab value="member">{t("tab.member")}</Tabs.Tab>
          <Tabs.Tab value="invite">{t("tab.invite")}</Tabs.Tab>
          <Tabs.Tab value="audit">{t("tab.audit")}</Tabs.Tab>
          <Tabs.Tab value="bot">{t("tab.bot")}</Tabs.Tab>
          <Tabs.Tab value="roles">{t("tab.roles")}</Tabs.Tab>
          <Tabs.Tab value="status">{t("tab.status")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="member" pt="sm">
          <Suspense fallback={suspenseFallback}>
            <LazyAdminUsersSection
              heading={sectionHeading(t("tab.member"))}
              usersLoading={usersQuery.isLoading}
              usersError={false}
              loadErrorMessage={t("common:loadError")}
              isAdmin={isAdmin}
              onCreateMember={async (username) => {
                try {
                  await createMemberMutation.mutateAsync({ username });
                  return true;
                } catch {
                  return false;
                }
              }}
              createMemberPending={createMemberMutation.isPending}
              selectedUserIds={selectedUserIds}
              selectedLabel={t("member.selected", { count: selectedUserIds.length })}
              selectionHintLabel={t("member.selectionHint")}
              batchSelectionLimit={BATCH_SELECTION_LIMIT}
              onBatchRole={handleBatchRole}
              onBatchActivate={handleBatchActivate}
              onBatchDeactivate={handleBatchDeactivate}
              onBatchDelete={handleBatchDelete}
              batchRolePending={batchRoleMutation.isPending}
              batchActivatePending={batchReactivateMutation.isPending}
              batchDeactivatePending={batchDeactivateMutation.isPending}
              batchDeletePending={batchDeleteMutation.isPending}
              singleRolePending={updateRoleMutation.isPending}
              singleActivationPending={deactivateMutation.isPending || reactivateMutation.isPending}
              singleResetPasswordPending={resetPasswordMutation.isPending}
              isBatchPending={isBatchPending}
              batchProgress={batchProgress}
              userRows={userRows}
              userColumns={userColumns}
              onOpenMemberDetail={setMemberDetailId}
              onSelectionChange={applyUserSelection}
              onSingleRoleChange={(userId, role) => {
                updateRoleMutation.mutate({ userId, role });
              }}
              onSingleActivate={(userId) => {
                reactivateMutation.mutate(userId);
              }}
              onSingleDeactivate={(userId) => {
                deactivateMutation.mutate(userId);
              }}
              onSingleResetPassword={(userId) => {
                resetPasswordMutation.mutate(userId);
              }}
            />
          </Suspense>
        </Tabs.Panel>

        <Tabs.Panel value="invite" pt="sm">
          <Suspense fallback={suspenseFallback}>
            <LazyAdminInviteSection
              inviteVisibility={inviteVisibility}
              onInviteVisibilityChange={setInviteVisibility}
              isAdmin={isAdmin}
              inviteMaxUses={inviteMaxUses}
              onInviteMaxUsesChange={setInviteMaxUses}
              inviteExpiresAt={inviteExpiresAt}
              onInviteExpiresAtChange={setInviteExpiresAt}
              onCreateInvite={() => createInviteMutation.mutate()}
              inviteStatsLoading={inviteStatsQuery.isLoading}
              inviteStats={inviteStatsQuery.data ?? null}
              inviteLinksLoading={inviteLinksQuery.isLoading}
              inviteLinksError={false}
              loadErrorMessage={t("common:loadError")}
              inviteRows={inviteRows}
              inviteSearch={inviteSearch}
              onInviteSearchChange={setInviteSearch}
              isInviteInactive={isInviteInactive}
              formatDateTime={formatDateTime}
              onCopyInviteLink={(row) => {
                void copyPlainText(`${window.location.origin}/register/${row.code}`);
              }}
              onRevokeInvite={(row) => {
                void (async () => {
                  const confirmed = await new Promise<boolean>((resolve) => {
                    modals.openConfirmModal({
                      title: t("confirm.revokeInvite.title"),
                      children: t("confirm.revokeInvite.description", { code: row.code }),
                      confirmProps: { color: "infini-danger" },
                      onConfirm: () => resolve(true),
                      onCancel: () => resolve(false),
                      closeOnConfirm: true,
                      closeOnCancel: true,
                      centered: true,
                    });
                  });
                  if (!confirmed) {
                    return;
                  }
                  revokeInviteMutation.mutate(row.id);
                })();
              }}
            />
          </Suspense>
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="sm">
          <Suspense fallback={suspenseFallback}>
            <LazyAdminAuditSection
              heading={sectionHeading(t("tab.audit"))}
              auditSearch={auditSearch}
              onAuditSearchChange={setAuditSearch}
              auditDateFrom={auditDateFrom}
              auditDateTo={auditDateTo}
              onAuditDateFromChange={setAuditDateFrom}
              onAuditDateToChange={setAuditDateTo}
              onSetDatePreset={(preset) => {
                const today = new Date();
                const days = preset === "1d" ? 1 : preset === "7d" ? 7 : 30;
                setAuditDateFrom(format(subDays(today, days), "yyyy-MM-dd"));
                setAuditDateTo(format(today, "yyyy-MM-dd"));
                setAuditPage(1);
              }}
              onDownloadFilteredCsv={() => exportAuditLogMutation.mutate("csv")}
              onDownloadFilteredJson={() => exportAuditLogMutation.mutate("json")}
              searchPlaceholder={t("audit.search")}
              lastDayLabel={t("audit.lastDay")}
              last7DaysLabel={t("audit.last7Days")}
              lastMonthLabel={t("audit.lastMonth")}
              downloadFilteredCsvLabel={t("audit.downloadFilteredCsv")}
              downloadFilteredJsonLabel={t("audit.downloadFilteredJson")}
              exportAuditLogPending={exportAuditLogMutation.isPending}
              auditLoading={auditLogQuery.isLoading}
              auditError={false}
              loadErrorMessage={t("common:loadError")}
              auditRows={auditRows}
              auditPageCurrent={auditLogQuery.data?.page ?? 1}
              auditPageSize={auditLogQuery.data?.limit ?? 50}
              auditTotal={auditLogQuery.data?.total ?? 0}
              onAuditPageChange={setAuditPage}
              isAdmin={isAdmin}
              maskIdentifier={maskIdentifier}
              formatAuditDiffHeader={formatAuditDiffHeader}
              formatDateTime={formatDateTime}
            />
          </Suspense>
        </Tabs.Panel>

        <Tabs.Panel value="bot" pt="sm">
          <Suspense fallback={suspenseFallback}>
            <LazyAdminBotSection
              heading={sectionHeading(t("tab.bot"))}
              isAdmin={isAdmin}
              adminOnlyMessage={t("adminOnly")}
              botSettingsLoading={botSettingsQuery.isLoading}
              botSettingsError={false}
              loadErrorMessage={t("common:loadError")}
              runtimeStatus={statusQuery.data?.ws ?? null}
              onTestDispatch={(platform) => testBotDispatchMutation.mutate({ platform })}
              testDispatchPending={testBotDispatchMutation.isPending}
              discordGuildId={discordGuildId}
              onDiscordGuildIdChange={setDiscordGuildId}
              onRefreshChannels={() => {
                void discordChannelsQuery.refetch();
              }}
              discordChannelsFetching={discordChannelsQuery.isFetching}
              canRefreshChannels={Boolean(discordGuildId.trim())}
              discordChannelCount={discordChannelsQuery.data?.channels.length ?? 0}
              discordChannelsError={false}
              discordNotificationChannelId={discordNotificationChannelId}
              onDiscordNotificationChannelIdChange={setDiscordNotificationChannelId}
              discordTeamCompChannelId={discordTeamCompChannelId}
              onDiscordTeamCompChannelIdChange={setDiscordTeamCompChannelId}
              discordChannelOptions={discordChannelOptions}
              discordChannelsLoading={discordChannelsQuery.isLoading}
              botToggleKeys={botToggleKeys}
              discordDefaultToggles={discordDefaultToggles}
              onDiscordDefaultToggleChange={(key, checked) =>
                setDiscordDefaultToggles((current) => ({
                  ...current,
                  [key]: checked,
                }))
              }
              wechatRoomIdsText={wechatRoomIdsText}
              onWechatRoomIdsTextChange={setWechatRoomIdsText}
              wechatDefaultToggles={wechatDefaultToggles}
              onWechatDefaultToggleChange={(key, checked) =>
                setWechatDefaultToggles((current) => ({
                  ...current,
                  [key]: checked,
                }))
              }
              botSettingsJson={botSettingsJson}
              onBotSettingsJsonChange={setBotSettingsJson}
              onSaveBotSettings={() => updateBotSettingsMutation.mutate()}
              savePending={updateBotSettingsMutation.isPending}
              saveLabel={t("bot.save")}
            />
          </Suspense>
        </Tabs.Panel>

        <Tabs.Panel value="roles" pt="sm">
          <Suspense fallback={suspenseFallback}>
            <LazyAdminRolesSection
              heading={sectionHeading(t("tab.roles"))}
              isAdmin={isAdmin}
              adminOnlyMessage={t("adminOnly")}
              rolesLoading={rolesQuery.isLoading}
              rolesError={rolesQuery.isError}
              loadErrorMessage={t("common:loadError")}
              roles={rolesQuery.data ?? []}
              createRolePending={createRoleMutation.isPending}
              updateRolePending={updateRoleConfigMutation.isPending}
              deleteRolePending={deleteRoleMutation.isPending}
              onCreateRole={async (payload) => {
                try {
                  await createRoleMutation.mutateAsync(payload);
                  return true;
                } catch {
                  return false;
                }
              }}
              onUpdateRole={async (id, payload) => {
                try {
                  await updateRoleConfigMutation.mutateAsync({ id, payload });
                  return true;
                } catch {
                  return false;
                }
              }}
              onDeleteRole={async (id) => {
                try {
                  await deleteRoleMutation.mutateAsync(id);
                  return true;
                } catch {
                  return false;
                }
              }}
            />
          </Suspense>
        </Tabs.Panel>

        <Tabs.Panel value="status" pt="sm">
          <Suspense fallback={suspenseFallback}>
            <LazyAdminStatusTab
              heading={sectionHeading(t("tab.status"))}
              isAdmin={isAdmin}
              adminOnlyMessage={t("adminOnly")}
              onRetry={() => {
                void refreshStatus();
              }}
              retryLoading={statusQuery.isFetching}
              onCopyConfigSummary={() => {
                void copyConfigSummary();
              }}
              canCopyConfigSummary={Boolean(statusQuery.data || botSettingsQuery.data)}
              statusLatencyMs={statusLatencyMs}
              statusLoading={statusQuery.isLoading}
              statusError={false}
              loadErrorMessage={t("common:loadError")}
              statusData={statusQuery.data ?? null}
              statusHealthLogs={statusHealthLogs}
              formatDateTime={formatDateTime}
            />
          </Suspense>
        </Tabs.Panel>
      </Tabs>
      <Suspense fallback={null}>
        <LazyAdminMemberDetailModal
          open={Boolean(selectedMemberDetail)}
          member={selectedMemberDetail}
          memberDetailTitle={memberDetailTitle}
          memberDetailBio={memberDetailBio}
          onClose={() => setMemberDetailId(null)}
          onMemberDetailTitleChange={setMemberDetailTitle}
          onMemberDetailBioChange={setMemberDetailBio}
          onSaveProfile={(member) =>
            updateMemberProfileMutation.mutate({
              userId: member.user.id,
              titleHtml: memberDetailTitle,
              bio: memberDetailBio,
            })
          }
          saveProfilePending={updateMemberProfileMutation.isPending}
          mediaTab={
            selectedMemberDetail ? (
              <Suspense fallback={suspenseFallback}>
                <LazyAdminMemberMediaTab
                  member={selectedMemberDetail}
                  isAdmin={isAdmin}
                  isModerator={isModerator}
                  onRefresh={refreshMemberData}
                  onError={showError}
                />
              </Suspense>
            ) : null
          }
        />
      </Suspense>
    </PageLayout>
  );
}
