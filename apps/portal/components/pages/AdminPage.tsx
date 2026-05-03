import { type AdminRole } from "@guild/shared";
import { SettingsIcon } from "@portal/components/icons";
import { useSearch } from "@tanstack/react-router";
import {
  Alert,
  Badge,
  Card,
  Group,
  Skeleton,
  Stack,
  Tabs,
} from "@mantine/core";
import { Suspense, lazy, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminData } from "../../hooks/data/useAdminData";
import { useAdminAuditFilter } from "../../hooks/useAdminAuditFilter";
import { useAdminInviteController } from "../../hooks/useAdminInviteController";
import { useAdminMemberDetail } from "../../hooks/useAdminMemberDetail";
import { useAdminMutations } from "../../hooks/useAdminMutations";
import { useAdminStatusController } from "../../hooks/useAdminStatusController";
import { usePageHeaderActions } from "../../context/PageHeaderContext";
import { useAppError } from "../../hooks/useAppError";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { copyPlainText } from "../../utils/copy";
import { useAuthStore } from "../../stores/auth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
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
  const { isModerator, canManage: canManagePermission } = useEffectivePermissions();
  const { showError } = useAppError();
  const { member: memberSearchParam } = useSearch({ strict: false }) as { member?: string };

  const [activeTab, setActiveTab] = useState("member");
  const [memberSearch, setMemberSearch] = useState("");

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
    rolesQuery,
    statusQuery,
  } = useAdminData({
    isModerator,
    userRole: user?.role ?? "member",
    auditPage: auditFilter.page,
    auditSearch: auditFilter.search,
    auditDateFrom: auditFilter.dateFrom,
    auditDateTo: auditFilter.dateTo,
  });
  const inviteController = useAdminInviteController({
    inviteLinks: inviteLinksQuery.data ?? [],
  });
  const adminMutations = useAdminMutations({
    invite: inviteController.invite,
    auditFilter,
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

  const isAdmin = canManagePermission(["admin.roles.manage"]) || canManagePermission(["admin.status.view"]);

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
        (row.profile.notes ?? "").toLowerCase().includes(q) ||
        row.user.role.toLowerCase().includes(q) ||
        row.profile.classes.some((cls) => cls.toLowerCase().includes(q))
      );
    });
  }, [userRowsRaw, memberSearch]);

  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of userRowsRaw) {
      map.set(row.user.id, row.user.username);
    }
    return map;
  }, [userRowsRaw]);

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

  const userColumns: TanStackColumnDef<(typeof userRows)[number], unknown>[] = [
    {
      header: t("member.table.username"),
      id: "username",
      accessorFn: (row) => row.user.username,
    },
    {
      header: t("member.table.class"),
      id: "class",
      accessorFn: (row) => row.profile.classes[0] ?? "",
      cell: ({ row }) => row.original.profile.classes[0] ?? "-",
    },
    {
      header: t("member.table.power"),
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

  usePageHeaderActions(null);
  useLoadWarningToast(
    usersQuery.isError ||
      inviteLinksQuery.isError ||
      inviteStatsQuery.isError ||
      auditLogQuery.isError ||
      auditMonthsQuery.isError ||
      rolesQuery.isError ||
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
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<SettingsIcon size={22} />} className="admin-page">
      <Tabs value={activeTab} onChange={(value) => value && setActiveTab(value)}>
        <Tabs.List>
          <Tabs.Tab value="member">{t("tab.member")}</Tabs.Tab>
          <Tabs.Tab value="invite">{t("tab.invite")}</Tabs.Tab>
          <Tabs.Tab value="audit">{t("tab.audit")}</Tabs.Tab>
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
              rolesData={rolesQuery.data ?? []}
              userMap={userMap}
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
                const data = statusQuery.data;
                if (!data) return;
                const lines = [
                  `DB: ${data.db}`,
                  `R2: ${data.r2}`,
                  `WS: ${data.ws}`,
                  `Crons: ${data.crons}`,
                  statusLatencyMs !== null ? `Latency: ${statusLatencyMs}ms` : null,
                  `Checked: ${new Date().toISOString()}`,
                ].filter(Boolean);
                void copyPlainText(lines.join("\n"));
              }}
              canCopyConfigSummary={Boolean(statusQuery.data)}
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
                  avatarUploadPending={memberMediaController.avatarUploadPending}
                  avatarDeletePending={memberMediaController.avatarDeletePending}
                  onUploadAvatar={memberMediaController.uploadAvatar}
                  onDeleteAvatar={memberMediaController.deleteAvatar}
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
