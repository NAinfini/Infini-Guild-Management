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
  Select,
  Tabs,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  batchDeleteAdminUsers,
  batchReactivateAdminUsers,
  batchUpdateAdminUserRole,
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
  updateMyProfile,
} from "../../api/mutations/users";
import {
  downloadAdminAuditArchiveFile,
  downloadAdminAuditLogExport,
  requestAdminAuditArchiveDownload,
} from "../../api/queries/admin";
import { queryKeys } from "../../api/query-keys";
import { useAdminData } from "../../hooks/data/useAdminData";
import { usePageHeaderActions } from "../../context/PageHeaderContext";
import { useAppError } from "../../hooks/useAppError";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { portalConfirm } from "../../overlays";
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

type AuditArchiveNdjsonRow = {
  created_at?: unknown;
  actor_id?: unknown;
  action?: unknown;
  entity_type?: unknown;
  entity_id?: unknown;
  diff_title?: unknown;
  detail_text?: unknown;
};

const ARCHIVE_CSV_MAX_BYTES = 50 * 1024 * 1024;
const AUDIT_CSV_HEADERS = [
  "timestamp_utc",
  "timestamp_local",
  "actor",
  "action",
  "entity_type",
  "entity_id",
  "diff_title",
  "detail_text",
];

function archiveFileNameFromKey(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] || "audit-archive.bin";
}

function auditExportDatePart(value: string): string {
  return value && value.trim().length > 0 ? value.trim() : "auto";
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function normalizeArchiveValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toAuditCsvRow(row: AuditArchiveNdjsonRow): string[] {
  const timestampUtc = normalizeArchiveValue(row.created_at);
  const date = new Date(timestampUtc);
  const timestampLocal = Number.isNaN(date.getTime()) ? "" : date.toLocaleString();

  return [
    timestampUtc,
    timestampLocal,
    normalizeArchiveValue(row.actor_id),
    normalizeArchiveValue(row.action),
    normalizeArchiveValue(row.entity_type),
    normalizeArchiveValue(row.entity_id),
    normalizeArchiveValue(row.diff_title),
    normalizeArchiveValue(row.detail_text),
  ];
}

function parseArchiveNdjson(text: string): AuditArchiveNdjsonRow[] {
  try {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.map((line) => JSON.parse(line) as AuditArchiveNdjsonRow);
  } catch {
    throw new Error("parse_failed");
  }
}

async function readArchiveBlobText(fileKey: string, blob: Blob): Promise<string> {
  if (!fileKey.endsWith(".gz")) {
    return blob.text();
  }

  try {
    const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  } catch {
    throw new Error("decompress_failed");
  }
}

function createAuditCsvBlob(rows: AuditArchiveNdjsonRow[]): Blob {
  try {
    const header = AUDIT_CSV_HEADERS.map(csvCell).join(",");
    const body = rows.map((row) => toAuditCsvRow(row).map(csvCell).join(","));
    return new Blob([`\uFEFF${[header, ...body].join("\n")}`], { type: "text/csv; charset=utf-8" });
  } catch {
    throw new Error("encode_failed");
  }
}

async function convertArchiveBlobsToCsvWithRetry(
  files: Array<{ key: string; blob: Blob }>,
  maxAttempts: number = 2,
): Promise<Blob> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const allRows: AuditArchiveNdjsonRow[] = [];
      for (const file of files) {
        const text = await readArchiveBlobText(file.key, file.blob);
        allRows.push(...parseArchiveNdjson(text));
      }
      return createAuditCsvBlob(allRows);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("encode_failed");
}

const BATCH_SELECTION_LIMIT = 50;
const EXPORT_COOLDOWN_MS = 60_000;

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

type ColumnDef<T = unknown> = {
  key?: string;
  title?: ReactNode;
  dataIndex?: keyof T | string | Array<string | number>;
  width?: string | number;
  render?: (value: unknown, row: T, index: number) => ReactNode;
};

export function AdminPage() {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isModerator = Boolean(user && hasRoleAtLeast(user.role, "moderator"));
  const isAdmin = user?.role === "admin";
  const { showError } = useAppError();

  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("member");
  const [batchRole, setBatchRole] = useState<"member" | "moderator">("member");

  const [inviteVisibility, setInviteVisibility] = useState<"active" | "expired">("active");
  const [inviteMaxUses, setInviteMaxUses] = useState<number>(10);
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");

  const [auditPage, setAuditPage] = useState(1);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditDateFrom, setAuditDateFrom] = useState(() => format(subDays(new Date(), 90), "yyyy-MM-dd"));
  const [auditDateTo, setAuditDateTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [selectedArchiveMonth, setSelectedArchiveMonth] = useState<string | undefined>(undefined);
  const [archivePage, setArchivePage] = useState(1);

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
  const [exportCooldownUntil, setExportCooldownUntil] = useState<number | null>(null);
  const [exportCooldownSeconds, setExportCooldownSeconds] = useState(0);
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
    auditArchiveMonthQuery,
    botSettingsQuery,
    discordChannelsQuery,
    statusQuery,
  } = useAdminData({
    isModerator,
    isAdmin,
    auditPage,
    auditSearch,
    auditDateFrom,
    auditDateTo,
    selectedArchiveMonth,
    archivePage,
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
    if (selectedArchiveMonth) return;
    const first = auditMonthsQuery.data?.months[0];
    if (first) {
      setSelectedArchiveMonth(first);
    }
  }, [auditMonthsQuery.data, selectedArchiveMonth]);

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

  useEffect(() => {
    if (!exportCooldownUntil) {
      setExportCooldownSeconds(0);
      return;
    }

    const update = () => {
      const remain = Math.max(0, Math.ceil((exportCooldownUntil - Date.now()) / 1000));
      setExportCooldownSeconds(remain);
      if (remain === 0) {
        setExportCooldownUntil(null);
      }
    };

    update();
    const timer = window.setInterval(update, 300);
    return () => window.clearInterval(timer);
  }, [exportCooldownUntil]);

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "admin" | "moderator" | "member" }) =>
      updateAdminUserRole(userId, role),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.roleUpdated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
    onError: (error) => showError(error, t("message.roleUpdateFailed")),
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => deactivateAdminUser(userId),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.deactivated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
    onError: (error) => showError(error, t("message.deactivateFailed")),
  });

  const reactivateMutation = useMutation({
    mutationFn: (userId: string) => reactivateAdminUser(userId),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.reactivated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
    onError: (error) => showError(error, t("message.reactivateFailed")),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (userId: string) => resetAdminUserPassword(userId),
    onSuccess: (payload) => {
      void copyPlainText(payload.temporary_password);
      notifications.show({ color: "green", message: t("message.passwordResetCopied") });
    },
    onError: (error) => showError(error, t("message.passwordResetFailed")),
  });

  const batchRoleMutation = useMutation({
    mutationFn: () =>
      batchUpdateAdminUserRole({
        user_ids: selectedUserIds,
        new_role: batchRole,
      }),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.batchRoleUpdated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
    onError: (error) => showError(error, t("message.batchRoleUpdateFailed")),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: () => batchDeleteAdminUsers({ user_ids: selectedUserIds }),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.batchDeleted") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      setSelectedUserIds([]);
    },
    onError: (error) => showError(error, t("message.batchDeleteFailed")),
  });

  const batchReactivateMutation = useMutation({
    mutationFn: () => batchReactivateAdminUsers({ user_ids: selectedUserIds }),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.batchReactivated") });
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
      notifications.show({ color: "green", message: t("message.inviteCreated") });
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
        message: variables.platform === "discord" ? "Discord test notification sent" : "WeChat test message sent",
      });
    },
    onError: (error) => showError(error, "Failed to send bot test message"),
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
      notifications.show({ color: "green", message: "Member profile saved" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    onError: (error) => showError(error, "Failed to save member profile"),
  });

  const userRows = usersQuery.data?.data ?? [];
  const inviteRowsRaw = inviteLinksQuery.data ?? [];
  const isInviteInactive = (row: (typeof inviteRowsRaw)[number]) => {
    const expiredByDate = Boolean(row.expires_at && Date.parse(row.expires_at) <= Date.now());
    const fullyUsed = row.used_count >= row.max_uses;
    return Boolean(row.revoked_at) || expiredByDate || fullyUsed;
  };
  const inviteRows = inviteRowsRaw.filter((row) =>
    inviteVisibility === "expired" ? isInviteInactive(row) : !isInviteInactive(row),
  );
  const auditRows = auditLogQuery.data?.data ?? [];
  const archivedAuditRows = auditArchiveMonthQuery.data?.data ?? [];
  const selectedMemberDetail = memberDetailId
    ? userRows.find((row) => row.user.id === memberDetailId) ?? null
    : null;
  const refreshMemberData = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.all });
  };

  const archiveCount = auditArchiveMonthQuery.data?.total ?? archivedAuditRows.length;
  const archiveEstimatedBytes = auditArchiveMonthQuery.data?.manifest?.total_size_bytes ?? null;
  const archiveCsvTooLarge =
    typeof archiveEstimatedBytes === "number" && archiveEstimatedBytes > ARCHIVE_CSV_MAX_BYTES;
  const isBatchPending =
    batchRoleMutation.isPending || batchDeleteMutation.isPending || batchReactivateMutation.isPending;
  const canExportArchive =
    Boolean(selectedArchiveMonth) && exportCooldownSeconds === 0 && !archiveCsvTooLarge;

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
      notifications.show({ color: "yellow", message: `Maximum batch selection is ${BATCH_SELECTION_LIMIT}.` });
    }
    setSelectedUserIds(keys.slice(0, BATCH_SELECTION_LIMIT));
  };

  const confirmBatchAction = async (message: string): Promise<boolean> => {
    if (selectedUserIds.length === 0) {
      return false;
    }
    return portalConfirm({
      title: t("confirm.batchActionTitle"),
      description: message,
      intent: "warning",
    });
  };

  const handleBatchRole = async () => {
    const confirmed = await confirmBatchAction(
      t("member.batchRoleConfirm", {
        count: selectedUserIds.length,
        role: batchRole,
      }),
    );
    if (!confirmed) {
      return;
    }
    batchRoleMutation.mutate();
  };

  const handleBatchReactivate = async () => {
    const confirmed = await confirmBatchAction(
      t("member.batchReactivateConfirm", {
        count: selectedUserIds.length,
      }),
    );
    if (!confirmed) {
      return;
    }
    batchReactivateMutation.mutate();
  };

  const handleBatchDelete = async () => {
    const confirmed = await confirmBatchAction(
      t("member.batchDeleteConfirm", {
        count: selectedUserIds.length,
      }),
    );
    if (!confirmed) {
      return;
    }
    batchDeleteMutation.mutate();
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
      "Admin Config Summary",
      `DB: ${status?.db ?? "unknown"}`,
      `R2: ${status?.r2 ?? "unknown"}`,
      `WS: ${status?.ws ?? "unknown"}`,
      `Crons: ${status?.crons ?? "unknown"}`,
      `Discord guild: ${bot?.discord.guild_id ?? ""}`,
      `Discord notify channel: ${bot?.discord.notification_channel_id ?? ""}`,
      `Discord team channel: ${bot?.discord.team_comp_channel_id ?? ""}`,
      `WeChat rooms: ${(bot?.wechat.room_ids ?? []).join(", ")}`,
    ];
    await copyPlainText(lines.join("\n"));
    notifications.show({ color: "green", message: "Config summary copied" });
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

  const userColumns: ColumnDef<(typeof userRows)[number]>[] = [
    {
      title: t("member.table.username"),
      key: "username",
      render: (_, row) => row.user.username,
    },
    {
      title: "WeChat",
      key: "wechat",
      render: (_, row) => row.profile.wechat_name ?? "-",
    },
    {
      title: "Class",
      key: "class",
      render: (_, row) => row.profile.classes[0] ?? "-",
    },
    {
      title: "Power",
      key: "power",
      render: (_, row) => row.profile.power,
    },
    {
      title: "Notes",
      key: "notes",
      render: (_, row) => (isAdmin ? row.profile.notes ?? "-" : "Restricted"),
    },
    {
      title: t("member.table.role"),
      key: "role",
      render: (_, row) => (
        <Badge color={row.user.role === "admin" ? "red" : row.user.role === "moderator" ? "yellow" : "blue"}>
          {row.user.role}
        </Badge>
      ),
    },
    {
      title: t("member.table.active"),
      key: "active",
      render: (_, row) => (row.user.is_active ? <Badge color="green">active</Badge> : <Badge color="gray">inactive</Badge>),
    },
    {
      title: t("member.table.actions"),
      key: "actions",
      render: (_, row) => (
        <Group gap={8} wrap="wrap">
          <Button size="xs" onClick={() => setMemberDetailId(row.user.id)} aria-label={`Open detail for ${row.user.username}`}>
            Detail
          </Button>
          {isAdmin ? (
            <>
              <Select
                size="xs"
                value={row.user.role}
                style={{ width: 120 }}
                onChange={(value) =>
                  value
                    ? updateRoleMutation.mutate({
                        userId: row.user.id,
                        role: value as "admin" | "moderator" | "member",
                      })
                    : undefined
                }
                data={[
                  { value: "member", label: "member" },
                  { value: "moderator", label: "moderator" },
                  { value: "admin", label: "admin" },
                ]}
              />
              {row.user.is_active ? (
                <Button size="xs" color="red" onClick={() => deactivateMutation.mutate(row.user.id)}>
                  {t("member.deactivate")}
                </Button>
              ) : (
                <Button size="xs" onClick={() => reactivateMutation.mutate(row.user.id)}>
                  {t("member.reactivate")}
                </Button>
              )}
              <Button size="xs" onClick={() => resetPasswordMutation.mutate(row.user.id)}>
                {t("member.resetPassword")}
              </Button>
            </>
          ) : null}
        </Group>
      ),
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
              Refresh status
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
      auditArchiveMonthQuery.isError ||
      botSettingsQuery.isError ||
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
    return <Alert color="red" title={t("forbidden")} />;
  }

  return (
    <PageLayout title={t("title")} subtitle="Administration" className="admin-page">
      <Tabs value={activeTab} onChange={(value) => value && setActiveTab(value)}>
        <Tabs.List>
          <Tabs.Tab value="member">{t("tab.member")}</Tabs.Tab>
          <Tabs.Tab value="invite">{t("tab.invite")}</Tabs.Tab>
          <Tabs.Tab value="audit">{t("tab.audit")}</Tabs.Tab>
          <Tabs.Tab value="bot">{t("tab.bot")}</Tabs.Tab>
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
              batchRole={batchRole}
              onBatchRoleChange={setBatchRole}
              selectedUserIds={selectedUserIds}
              selectedLabel={t("member.selected", { count: selectedUserIds.length })}
              batchSelectionLimit={BATCH_SELECTION_LIMIT}
              batchRoleButtonLabel={t("member.batchRole")}
              batchReactivateButtonLabel={t("member.batchReactivate")}
              batchDeleteButtonLabel={t("member.batchDelete")}
              onBatchRole={handleBatchRole}
              onBatchReactivate={handleBatchReactivate}
              onBatchDelete={handleBatchDelete}
              batchRolePending={batchRoleMutation.isPending}
              batchReactivatePending={batchReactivateMutation.isPending}
              batchDeletePending={batchDeleteMutation.isPending}
              isBatchPending={isBatchPending}
              batchProgress={batchProgress}
              userRows={userRows}
              userColumns={userColumns}
              onOpenMemberDetail={setMemberDetailId}
              onSelectionChange={applyUserSelection}
            />
          </Suspense>
        </Tabs.Panel>

        <Tabs.Panel value="invite" pt="sm">
          <Suspense fallback={suspenseFallback}>
            <LazyAdminInviteSection
              heading={sectionHeading(t("tab.invite"))}
              inviteVisibility={inviteVisibility}
              onInviteVisibilityChange={setInviteVisibility}
              isAdmin={isAdmin}
              inviteMaxUses={inviteMaxUses}
              onInviteMaxUsesChange={setInviteMaxUses}
              inviteMaxUsesLabel={t("invite.maxUses")}
              inviteExpiresAt={inviteExpiresAt}
              onInviteExpiresAtChange={setInviteExpiresAt}
              onCreateInvite={() => createInviteMutation.mutate()}
              inviteCreateLabel={t("invite.create")}
              inviteStatsLoading={inviteStatsQuery.isLoading}
              inviteStats={inviteStatsQuery.data ?? null}
              inviteStatsTotalLabel={t("invite.stats.total")}
              inviteStatsActiveLabel={t("invite.stats.active")}
              inviteStatsRevokedLabel={t("invite.stats.revoked")}
              inviteStatsExpiredLabel={t("invite.stats.expired")}
              inviteLinksLoading={inviteLinksQuery.isLoading}
              inviteLinksError={false}
              loadErrorMessage={t("common:loadError")}
              inviteRows={inviteRows}
              isInviteInactive={isInviteInactive}
              formatDateTime={formatDateTime}
              onCopyInviteLink={(row) => {
                void copyPlainText(`${window.location.origin}/register/${row.code}`);
              }}
              onRevokeInvite={(row) => {
                void (async () => {
                  const confirmed = await portalConfirm({
                    title: t("confirm.revokeInvite.title"),
                    description: t("confirm.revokeInvite.description", { code: row.code }),
                    intent: "danger",
                  });
                  if (!confirmed) {
                    return;
                  }
                  revokeInviteMutation.mutate(row.id);
                })();
              }}
              inviteCopyLabel={t("invite.copy")}
              inviteRevokeLabel={t("invite.revoke")}
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
              onResetDateRange={() => {
                setAuditDateFrom(format(subDays(new Date(), 90), "yyyy-MM-dd"));
                setAuditDateTo(format(new Date(), "yyyy-MM-dd"));
                setAuditPage(1);
              }}
              onApplyFilters={() => setAuditPage(1)}
              onDownloadFilteredCsv={() => exportAuditLogMutation.mutate("csv")}
              onDownloadFilteredJson={() => exportAuditLogMutation.mutate("json")}
              searchPlaceholder={t("audit.search")}
              last90DaysLabel="Last 90 days"
              applyLabel={t("audit.apply")}
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
              archiveTitle={t("audit.archive")}
              auditMonthsLoading={auditMonthsQuery.isLoading}
              auditMonths={auditMonthsQuery.data?.months ?? []}
              selectedArchiveMonth={selectedArchiveMonth}
              onSelectedArchiveMonthChange={(month) => {
                setSelectedArchiveMonth(month);
                setArchivePage(1);
              }}
              archiveCountLabel={t("audit.archiveCount", {
                count: archiveCount,
              })}
              archiveCsvTooLarge={archiveCsvTooLarge}
              archiveTooLargeMessage="CSV disabled: archive exceeds 50 MB. Download raw archive files instead."
              onDownloadCsv={() => {
                void (async () => {
                  if (!selectedArchiveMonth || !canExportArchive) {
                    return;
                  }
                  setExportCooldownUntil(Date.now() + EXPORT_COOLDOWN_MS);
                  try {
                    const downloadPayload = await requestAdminAuditArchiveDownload(selectedArchiveMonth, "csv");
                    const totalBytes = downloadPayload.files.reduce((sum, file) => sum + Math.max(0, file.size_bytes), 0);

                    if (totalBytes > ARCHIVE_CSV_MAX_BYTES) {
                      for (const file of downloadPayload.files) {
                        const rawBlob = await downloadAdminAuditArchiveFile(file.url);
                        downloadFileBlob(archiveFileNameFromKey(file.key), rawBlob);
                      }
                      notifications.show({
                        color: "yellow",
                        message: "Archive input is larger than 50 MB. Downloaded raw archive files.",
                      });
                      return;
                    }

                    const archiveBlobs: Array<{ key: string; blob: Blob }> = [];
                    for (const file of downloadPayload.files) {
                      const blob = await downloadAdminAuditArchiveFile(file.url);
                      archiveBlobs.push({
                        key: file.key,
                        blob,
                      });
                    }

                    const csvBlob = await convertArchiveBlobsToCsvWithRetry(archiveBlobs, 2);
                    downloadFileBlob(`guild-audit-${selectedArchiveMonth}.csv`, csvBlob);
                    notifications.show({ color: "green", message: "CSV exported" });
                  } catch (error) {
                    setExportCooldownUntil(null);
                    const messageText = error instanceof Error ? error.message : "Failed to export CSV";
                    if (messageText.includes("decompress_failed")) {
                      showError(error, "CSV export failed: decompress_failed");
                      return;
                    }
                    if (messageText.includes("parse_failed")) {
                      showError(error, "CSV export failed: parse_failed");
                      return;
                    }
                    if (messageText.includes("encode_failed")) {
                      showError(error, "CSV export failed: encode_failed");
                      return;
                    }
                    showError(error, "Failed to export CSV");
                  }
                })();
              }}
              canExportArchive={canExportArchive}
              exportCooldownSeconds={exportCooldownSeconds}
              downloadCsvLabel={t("audit.downloadCsv")}
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
          isAdmin={isAdmin}
          isModerator={isModerator}
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
          onUpdateRole={(member, role) =>
            updateRoleMutation.mutate({
              userId: member.user.id,
              role,
            })
          }
          onDeactivate={(member) => deactivateMutation.mutate(member.user.id)}
          onReactivate={(member) => reactivateMutation.mutate(member.user.id)}
          onResetPassword={(member) => resetPasswordMutation.mutate(member.user.id)}
        />
      </Suspense>
    </PageLayout>
  );
}

