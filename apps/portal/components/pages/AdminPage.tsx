import { SettingsIcon } from "@portal/components/icons";
import {
  Alert,
  Card,
  Group,
  Skeleton,
  Stack,
  Tabs,
} from "@mantine/core";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { useAdminPageController } from "../../hooks/useAdminPageController";
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
const LazyAdminBadgesSection = lazy(() =>
  import("../feature/admin/AdminBadgesSection").then((mod) => ({ default: mod.AdminBadgesSection })),
);
const LazyAdminGameDataSection = lazy(() =>
  import("../feature/admin/AdminGameDataSection").then((mod) => ({ default: mod.AdminGameDataSection })),
);
const LazyAdminSiteConfigSection = lazy(() =>
  import("../feature/admin/AdminSiteConfigSection").then((mod) => ({ default: mod.AdminSiteConfigSection })),
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

export function AdminPage() {
  const { t } = useTranslation("admin");
  const {
    activeTab,
    auditFilter,
    auditLogQuery,
    auditMonthsQuery,
    auditRows,
    badgesController,
    batchSelectionLimit,
    batchProgress,
    batchRoleMutation,
    batchReactivateMutation,
    batchDeactivateMutation,
    batchDeleteMutation,
    closeMemberDetail,
    createInviteMutation,
    createMember,
    createMemberModalHandlers,
    createMemberModalOpen,
    createMemberMutation,
    createRoleConfig,
    createRoleMutation,
    deactivateMutation,
    invite,
    inviteRows,
    inviteLinksQuery,
    inviteStatsQuery,
    isInviteInactive,
    canAccessAdmin,
    deleteInviteMutation,
    deleteRoleConfig,
    deleteRoleMutation,
    exportAuditLogMutation,
    handleBatchActivate,
    handleBatchDeactivate,
    handleBatchDelete,
    handleBatchRole,
    handleCopyConfigSummary,
    handleTabChange,
    isAdmin,
    isBatchPending,
    isModerator,
    memberDetailForm,
    memberMediaController,
    memberSearch,
    patchMemberDetailForm,
    reactivateMutation,
    resetPasswordMutation,
    revokeInviteMutation,
    rolesQuery,
    rolesWithExternal,
    saveSelectedMemberProfile,
    selectedMemberDetail,
    selectedUserIds,
    setAuditDateFrom,
    setAuditDatePreset,
    setAuditDateTo,
    setAuditPage,
    setAuditSearch,
    setInviteExpiresAt,
    setInviteMaxUses,
    setInviteSearch,
    setInviteVisibility,
    setMemberDetailId,
    setMemberSearch,
    statusHealthLogs,
    statusLatencyMs,
    statusQuery,
    siteConfigMutations,
    siteConfigQuery,
    tabAccess,
    updateRoleMutation,
    updateMemberProfileMutation,
    updateRoleConfigMutation,
    applyUserSelection,
    updateRoleConfig,
    userColumns,
    userMap,
    userRows,
    userRowsRaw,
    usersQuery,
  } = useAdminPageController();
  const suspenseFallback = (
    <Card withBorder p="md">
      <Stack gap={10}>
        <Group gap={8}><Skeleton height={28} width="30%" /><Skeleton height={28} width="20%" /></Group>
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={18} />)}
      </Stack>
    </Card>
  );

  if (!canAccessAdmin) {
    return <Alert color="red" title={t("forbidden")} />;
  }

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<SettingsIcon size={22} />} className="admin-page">
        <Tabs value={activeTab} onChange={handleTabChange}>
          <Tabs.List>
          {tabAccess.member ? <Tabs.Tab value="member">{t("tab.member")}</Tabs.Tab> : null}
          {tabAccess.invite ? <Tabs.Tab value="invite">{t("tab.invite")}</Tabs.Tab> : null}
          {tabAccess.audit ? <Tabs.Tab value="audit">{t("tab.audit")}</Tabs.Tab> : null}
          {tabAccess.roles ? <Tabs.Tab value="roles">{t("tab.roles")}</Tabs.Tab> : null}
          {tabAccess.siteConfig ? <Tabs.Tab value="siteConfig">{t("tab.siteConfig")}</Tabs.Tab> : null}
          {tabAccess.badges ? <Tabs.Tab value="badges">{t("tab.badges")}</Tabs.Tab> : null}
          {tabAccess.gameData ? <Tabs.Tab value="gameData">{t("tab.gameData")}</Tabs.Tab> : null}
          {tabAccess.status ? <Tabs.Tab value="status">{t("tab.status")}</Tabs.Tab> : null}
        </Tabs.List>

        {tabAccess.member ? (
        <Tabs.Panel value="member" pt="sm">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminUsersSection
              usersLoading={usersQuery.isLoading}
              usersError={usersQuery.isError}
              isAdmin={isAdmin}
              onOpenCreateMember={createMemberModalHandlers.open}
              selectedUserIds={selectedUserIds}
              batchSelectionLimit={batchSelectionLimit}
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
        ) : null}

        {tabAccess.invite ? (
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
              createInvitePending={createInviteMutation.isPending}
              createInviteSuccess={createInviteMutation.isSuccess}
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
        ) : null}

        {tabAccess.audit ? (
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
              archiveMonths={auditMonthsQuery.data?.months ?? []}
              archiveMonthsLoading={auditMonthsQuery.isLoading}
              archiveMonthsError={auditMonthsQuery.isError}
            />
          </Suspense>
          </ErrorBoundary>
        </Tabs.Panel>
        ) : null}

        {tabAccess.roles ? (
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
        ) : null}

        {tabAccess.siteConfig ? (
          <Tabs.Panel value="siteConfig" pt="sm">
            <ErrorBoundary>
            <Suspense fallback={suspenseFallback}>
              <LazyAdminSiteConfigSection
                data={siteConfigQuery.data ?? null}
                loading={siteConfigQuery.isLoading}
                saving={siteConfigMutations.updateSiteConfigMutation.isPending || siteConfigMutations.updateOnboardingMutation.isPending}
                logoUploading={siteConfigMutations.uploadSiteLogoMutation.isPending}
                onSaveSite={(payload) => siteConfigMutations.updateSiteConfigMutation.mutate(payload)}
                onUploadLogo={(file) => siteConfigMutations.uploadSiteLogoMutation.mutate(file)}
              />
            </Suspense>
            </ErrorBoundary>
          </Tabs.Panel>
        ) : null}

        {tabAccess.badges ? (
          <Tabs.Panel value="badges" pt="sm">
            <ErrorBoundary>
            <Suspense fallback={suspenseFallback}>
              <LazyAdminBadgesSection
                userRows={userRowsRaw}
                controller={badgesController}
              />
            </Suspense>
            </ErrorBoundary>
          </Tabs.Panel>
        ) : null}

        {tabAccess.gameData ? (
          <Tabs.Panel value="gameData" pt="sm">
            <ErrorBoundary>
            <Suspense fallback={suspenseFallback}>
              <LazyAdminGameDataSection />
            </Suspense>
            </ErrorBoundary>
          </Tabs.Panel>
        ) : null}

        {tabAccess.status ? (
        <Tabs.Panel value="status" pt="sm">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminStatusTab
              onCopyConfigSummary={handleCopyConfigSummary}
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
        ) : null}
      </Tabs>
      <Suspense fallback={null}>
        <LazyAdminMemberDetailModal
          open={Boolean(selectedMemberDetail)}
          member={selectedMemberDetail}
          form={memberDetailForm}
          onClose={closeMemberDetail}
          onFormChange={patchMemberDetailForm}
          onSaveProfile={saveSelectedMemberProfile}
          saveProfilePending={updateMemberProfileMutation.isPending}
          roles={rolesQuery.data ?? []}
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
          onCreateMember={createMember}
          creating={createMemberMutation.isPending}
        />
      </Suspense>
    </PageLayout>
  );
}
