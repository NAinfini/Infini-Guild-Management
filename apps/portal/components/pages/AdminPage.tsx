import { type AdminRole } from "@guild/shared";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { IconSettings } from "@tabler/icons-react";
import { useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Card,
  Group,
  Skeleton,
  Stack,
  Tabs,
} from "@mantine/core";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminData } from "../../hooks/data/useAdminData";
import { useAdminAuditFilter } from "../../hooks/useAdminAuditFilter";
import { useAdminBotController } from "../../hooks/useAdminBotController";
import { useAdminInviteController } from "../../hooks/useAdminInviteController";
import { useAdminMemberDetail } from "../../hooks/useAdminMemberDetail";
import { useAdminMutations } from "../../hooks/useAdminMutations";
import { useAdminStatusController } from "../../hooks/useAdminStatusController";
import { usePageHeaderActions } from "../../context/PageHeaderContext";
import { useAppError } from "../../hooks/useAppError";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { fetchAdminAuditArchiveMonth } from "../../services/AdminService";
import { queryKeys } from "../../api/query-keys";
import { useAuthStore } from "../../stores/auth";
import { canManageRoles, canManageBot, canViewStatus, canExportAudit, userCanAccessAdmin } from "../../utils/permissions";
import { PageLayout } from "../layout/PageLayout";
import { ErrorBoundary } from "@portal/components/effects";
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
const LazyCreateMemberModal = lazy(() =>
  import("../feature/admin/CreateMemberModal").then((mod) => ({ default: mod.CreateMemberModal })),
);

const BATCH_SELECTION_LIMIT = 50;

import type { ColumnDef as TanStackColumnDef } from "@tanstack/react-table";

export function AdminPage() {
  const { t } = useTranslation("admin");
  const user = useAuthStore((state) => state.user);
  const isModerator = userCanAccessAdmin(user);
  const { showError } = useAppError();
  const { member: memberSearchParam } = useSearch({ strict: false }) as { member?: string };

  const [activeTab, setActiveTab] = useState("member");
  const [queryDiscordGuildId, setQueryDiscordGuildId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedArchiveMonth, setSelectedArchiveMonth] = useState<string | null>(null);
  const [archivePage, setArchivePage] = useState(1);

  const {
    auditFilter,
    setAuditPage,
    setAuditSearch,
    setAuditDateFrom,
    setAuditDateTo,
    setAuditDatePreset,
  } = useAdminAuditFilter();

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
    userRole: user?.role ?? "member",
    auditPage: auditFilter.page,
    auditSearch: auditFilter.search,
    auditDateFrom: auditFilter.dateFrom,
    auditDateTo: auditFilter.dateTo,
    discordGuildId: queryDiscordGuildId,
  });
  const inviteController = useAdminInviteController({
    inviteLinks: inviteLinksQuery.data ?? [],
  });
  const botController = useAdminBotController({
    botSettingsData: botSettingsQuery.data,
    discordChannelsData: discordChannelsQuery.data,
    statusData: statusQuery.data,
  });
  const adminMutations = useAdminMutations({
    invite: inviteController.invite,
    auditFilter,
    botSettings: botController.botSettings,
    batchSelectionLimit: BATCH_SELECTION_LIMIT,
    showError,
  });
  const {
    invite,
    inviteRows,
    isInviteInactive,
    setInviteVisibility,
    setInviteMaxUses,
    setInviteExpiresAt,
    setInviteSearch,
  } = inviteController;
  const {
    botSettings,
    botToggleKeys,
    discordChannelOptions,
    copyConfigSummary,
    setBotSettingsJson,
    setDiscordGuildId,
    setDiscordNotificationChannelId,
    setDiscordTeamCompChannelId,
    setDiscordDefaultToggle,
    setWechatRoomIdsText,
    setWechatDefaultToggle,
  } = botController;
  const {
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
  } = adminMutations;

  const roles = rolesQuery.data ?? [];
  const userRole = user?.role ?? "member";
  const isAdmin = canManageRoles(roles, userRole) || canManageBot(roles, userRole) || canViewStatus(roles, userRole);
  const showArchiveExplorer = canExportAudit(roles, userRole);
  const archiveMonths = auditMonthsQuery.data?.months ?? [];

  const auditArchiveQuery = useQuery({
    queryKey: queryKeys.admin.auditArchive(selectedArchiveMonth, archivePage),
    queryFn: () => fetchAdminAuditArchiveMonth(selectedArchiveMonth!, { page: archivePage, limit: 50 }),
    enabled: activeTab === "audit" && showArchiveExplorer && Boolean(selectedArchiveMonth),
  });

  useEffect(() => {
    setQueryDiscordGuildId(botController.botSettings.discordGuildId);
  }, [botController.botSettings.discordGuildId]);

  const {
    setMemberDetailId,
    memberDetailForm,
    setMemberDetailForm,
    selectedMemberDetail,
    createMemberModalOpen,
    createMemberModalHandlers,
    memberMediaController,
  } = useAdminMemberDetail({
    usersData: usersQuery.data?.data,
    memberSearchParam,
    showError,
  });

  const { statusLatencyMs, statusHealthLogs } = useAdminStatusController({
    statusQuery,
    activeTab,
    isAdmin,
  });

  const userRowsRaw = usersQuery.data?.data ?? [];
  const userRows = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return userRowsRaw;
    return userRowsRaw.filter((row) => {
      return (
        row.user.username.toLowerCase().includes(q) ||
        (row.profile.wechat_name ?? "").toLowerCase().includes(q) ||
        (row.profile.discord_id ?? "").toLowerCase().includes(q) ||
        (row.profile.notes ?? "").toLowerCase().includes(q) ||
        row.user.role.toLowerCase().includes(q) ||
        row.profile.classes.some((cls) => cls.toLowerCase().includes(q))
      );
    });
  }, [userRowsRaw, memberSearch]);

  const rolesWithExternal = useMemo((): AdminRole[] => {
    const apiRoles = rolesQuery.data ?? [];
    const now = new Date().toISOString();
    const externalRole: AdminRole = {
      id: "external",
      name: t("role.external"),
      level: 0,
      color: null,
      is_builtin: true,
      created_at: now,
      updated_at: now,
      permissions: Object.fromEntries(
        apiRoles[0]
          ? Object.keys(apiRoles[0].permissions).map((k) => [k, false])
          : [],
      ) as AdminRole["permissions"],
      assigned_user_count: 0,
    };
    return [...apiRoles, externalRole];
  }, [rolesQuery.data, t]);
  const auditRows = auditLogQuery.data?.data ?? [];
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
      cell: ({ row }) => (row.original.user.is_active ? <Badge color="green">{t("member.status.active")}</Badge> : <Badge color="gray">{t("member.status.inactive")}</Badge>),
    },
  ];

  const adminHeaderActions = useMemo(
    () =>
      isAdmin && isModerator ? (
        <Group gap={8} wrap="wrap">
          {activeTab === "invite" ? (
            <DepthButton type="primary" onClick={() => createInviteMutation.mutate()} loading={createInviteMutation.isPending}>
              {inviteCreateLabel}
            </DepthButton>
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
      <Stack gap={10}>
        <Group gap={8}><Skeleton height={28} width="30%" /><Skeleton height={28} width="20%" /></Group>
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={18} />)}
      </Stack>
    </Card>
  );

  if (!isModerator) {
    return <Alert color="red" title={t("forbidden")} />;
  }

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<IconSettings size={22} />} className="admin-page">
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
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminUsersSection
              usersLoading={usersQuery.isLoading}
              usersError={usersQuery.isError}
              isAdmin={isAdmin}
              onOpenCreateMember={createMemberModalHandlers.open}
              selectedUserIds={selectedUserIds}
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
              roles={rolesQuery.data ?? []}
              memberSearch={memberSearch}
              onMemberSearchChange={setMemberSearch}
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
          </ErrorBoundary>
        </Tabs.Panel>

        <Tabs.Panel value="invite" pt="sm">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminInviteSection
              inviteVisibility={invite.visibility}
              onInviteVisibilityChange={setInviteVisibility}
              inviteMaxUses={invite.maxUses}
              onInviteMaxUsesChange={setInviteMaxUses}
              inviteExpiresAt={invite.expiresAt}
              onInviteExpiresAtChange={setInviteExpiresAt}
              onCreateInvite={() => createInviteMutation.mutate()}
              inviteStatsLoading={inviteStatsQuery.isLoading}
              inviteStats={inviteStatsQuery.data ?? null}
              inviteLinksLoading={inviteLinksQuery.isLoading}
              inviteLinksError={inviteLinksQuery.isError}
              inviteRows={inviteRows}
              inviteSearch={invite.search}
              onInviteSearchChange={setInviteSearch}
              isInviteInactive={isInviteInactive}
              onRevokeInvite={(inviteId) => {
                revokeInviteMutation.mutate(inviteId);
              }}
              onDeleteInvite={(inviteId) => {
                deleteInviteMutation.mutate(inviteId);
              }}
            />
          </Suspense>
          </ErrorBoundary>
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="sm">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminAuditSection
              auditSearch={auditFilter.search}
              onAuditSearchChange={setAuditSearch}
              auditDateFrom={auditFilter.dateFrom}
              auditDateTo={auditFilter.dateTo}
              onAuditDateFromChange={setAuditDateFrom}
              onAuditDateToChange={setAuditDateTo}
              onSetDatePreset={setAuditDatePreset}
              onDownloadFilteredCsv={() => exportAuditLogMutation.mutate("csv")}
              onDownloadFilteredJson={() => exportAuditLogMutation.mutate("json")}
              exportAuditLogPending={exportAuditLogMutation.isPending}
              auditLoading={auditLogQuery.isLoading}
              auditError={auditLogQuery.isError}
              auditRows={auditRows}
              auditPageCurrent={auditLogQuery.data?.page ?? 1}
              auditPageSize={auditLogQuery.data?.limit ?? 50}
              auditTotal={auditLogQuery.data?.total ?? 0}
              onAuditPageChange={setAuditPage}
              showArchiveExplorer={showArchiveExplorer}
              archiveMonths={archiveMonths}
              archiveMonthsLoading={auditMonthsQuery.isLoading}
              archiveMonthsError={auditMonthsQuery.isError}
              selectedArchiveMonth={selectedArchiveMonth}
              onArchiveMonthChange={(month) => {
                setSelectedArchiveMonth(month);
                setArchivePage(1);
              }}
              archiveLoading={auditArchiveQuery.isLoading}
              archiveError={auditArchiveQuery.isError}
              archiveRows={auditArchiveQuery.data?.data ?? []}
              archivePageCurrent={auditArchiveQuery.data?.page ?? archivePage}
              archivePageSize={auditArchiveQuery.data?.limit ?? 50}
              archiveTotal={auditArchiveQuery.data?.total ?? 0}
              onArchivePageChange={setArchivePage}
              rolesData={rolesQuery.data ?? []}
            />
          </Suspense>
          </ErrorBoundary>
        </Tabs.Panel>

        <Tabs.Panel value="bot" pt="sm">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminBotSection
              botSettingsLoading={botSettingsQuery.isLoading}
              botSettingsError={botSettingsQuery.isError}
              runtimeStatus={statusQuery.data?.ws ?? null}
              onTestDispatch={(platform) => testBotDispatchMutation.mutate({ platform })}
              testDispatchPending={testBotDispatchMutation.isPending}
              discordGuildId={botSettings.discordGuildId}
              onDiscordGuildIdChange={setDiscordGuildId}
              onRefreshChannels={() => {
                void discordChannelsQuery.refetch();
              }}
              discordChannelsFetching={discordChannelsQuery.isFetching}
              canRefreshChannels={Boolean(botSettings.discordGuildId.trim())}
              discordChannelCount={discordChannelsQuery.data?.channels.length ?? 0}
              discordChannelsError={discordChannelsQuery.isError}
              discordNotificationChannelId={botSettings.discordNotificationChannelId}
              onDiscordNotificationChannelIdChange={setDiscordNotificationChannelId}
              discordTeamCompChannelId={botSettings.discordTeamCompChannelId}
              onDiscordTeamCompChannelIdChange={setDiscordTeamCompChannelId}
              discordChannelOptions={discordChannelOptions}
              discordChannelsLoading={discordChannelsQuery.isLoading}
              botToggleKeys={botToggleKeys}
              discordDefaultToggles={botSettings.discordDefaultToggles}
              onDiscordDefaultToggleChange={setDiscordDefaultToggle}
              wechatRoomIdsText={botSettings.wechatRoomIdsText}
              onWechatRoomIdsTextChange={setWechatRoomIdsText}
              wechatDefaultToggles={botSettings.wechatDefaultToggles}
              onWechatDefaultToggleChange={setWechatDefaultToggle}
              botSettingsJson={botSettings.json}
              onBotSettingsJsonChange={setBotSettingsJson}
              onSaveBotSettings={() => updateBotSettingsMutation.mutate()}
              savePending={updateBotSettingsMutation.isPending}
            />
          </Suspense>
          </ErrorBoundary>
        </Tabs.Panel>

        <Tabs.Panel value="roles" pt="sm">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminRolesSection
              rolesLoading={rolesQuery.isLoading}
              rolesError={rolesQuery.isError}
              roles={rolesWithExternal}
              createRolePending={createRoleMutation.isPending}
              updateRolePending={updateRoleConfigMutation.isPending}
              deleteRolePending={deleteRoleMutation.isPending}
              onCreateRole={createRoleConfig}
              onUpdateRole={updateRoleConfig}
              onDeleteRole={deleteRoleConfig}
            />
          </Suspense>
          </ErrorBoundary>
        </Tabs.Panel>

        <Tabs.Panel value="status" pt="sm">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminStatusTab
              onCopyConfigSummary={() => {
                void copyConfigSummary();
              }}
              canCopyConfigSummary={Boolean(statusQuery.data || botSettingsQuery.data)}
              statusLatencyMs={statusLatencyMs}
              statusLoading={statusQuery.isLoading}
              statusError={statusQuery.isError}
              statusData={statusQuery.data ?? null}
              statusHealthLogs={statusHealthLogs}
            />
          </Suspense>
          </ErrorBoundary>
        </Tabs.Panel>
      </Tabs>
      <Suspense fallback={null}>
        <LazyAdminMemberDetailModal
          open={Boolean(selectedMemberDetail)}
          member={selectedMemberDetail}
          form={memberDetailForm}
          onClose={() => setMemberDetailId(null)}
          onFormChange={(patch) => setMemberDetailForm((prev) => ({ ...prev, ...patch }))}
          onSaveProfile={(member) =>
            updateMemberProfileMutation.mutate({
              userId: member.user.id,
              form: memberDetailForm,
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
                  imageItems={memberMediaController.imageItems}
                  imageUploader={memberMediaController.imageUploader}
                  imageReorderPending={memberMediaController.imageReorderPending}
                  imageDeletePending={memberMediaController.imageDeletePending}
                  onImageReorder={memberMediaController.reorderImages}
                  onImageDelete={memberMediaController.deleteImage}
                  onUploadImages={memberMediaController.uploadImages}
                  videoUrls={memberMediaController.videoUrls}
                  hasVideoChanges={memberMediaController.hasVideoChanges}
                  saveVideosPending={memberMediaController.saveVideosPending}
                  onVideoUrlChange={memberMediaController.changeVideoUrl}
                  onAddVideoUrl={memberMediaController.addVideoUrl}
                  onRemoveVideoUrl={memberMediaController.removeVideoUrl}
                  onSaveVideoUrls={memberMediaController.saveVideoUrls}
                  audioUploader={memberMediaController.audioUploader}
                  deleteAudioPending={memberMediaController.deleteAudioPending}
                  onUploadAudio={memberMediaController.uploadAudio}
                  onDeleteAudio={memberMediaController.deleteAudio}
                />
              </Suspense>
            ) : null
          }
        />
      </Suspense>
      <Suspense fallback={null}>
        <LazyCreateMemberModal
          opened={createMemberModalOpen}
          onClose={createMemberModalHandlers.close}
          onCreateMember={async (data) => {
            const result = await createMemberMutation.mutateAsync(data);
            return result;
          }}
          creating={createMemberMutation.isPending}
        />
      </Suspense>
    </PageLayout>
  );
}
