import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAdminPageController } from "../../hooks/useAdminPageController";
import { ADMIN_CONTEXT_ROUTES } from "../layout/admin-context-nav";
import {
  initialAdminContextNavigationStatus,
  useAdminContextNavigation,
} from "../layout/AdminContextNavigation";
import { PageLayout } from "../layout/PageLayout";
import { serviceState } from "../feature/admin/AdminSystemSection";
import { ErrorBoundary } from "@portal/components/effects";
import "./AdminPage.css";

const LazyAdminOperationsTab = lazy(() =>
  import("../feature/admin/AdminOperationsTab").then((mod) => ({ default: mod.AdminOperationsTab })),
);
const LazyAdminDiagnosticsTab = lazy(() =>
  import("../feature/admin/AdminDiagnosticsTab").then((mod) => ({ default: mod.AdminDiagnosticsTab })),
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
const LazyAdminClassesPanel = lazy(() =>
  import("../feature/admin/AdminClassesPanel").then((mod) => ({ default: mod.AdminClassesPanel })),
);
const LazyAdminSiteConfigSection = lazy(() =>
  import("../feature/admin/AdminSiteConfigSection").then((mod) => ({ default: mod.AdminSiteConfigSection })),
);
const LazyAdminImportantNoticesSection = lazy(() =>
  import("../feature/admin/AdminImportantNoticesSection").then((mod) => ({ default: mod.AdminImportantNoticesSection })),
);
const LazyAdminMemberDetailInspector = lazy(() =>
  import("../feature/admin/AdminMemberDetailInspector").then((mod) => ({ default: mod.AdminMemberDetailInspector })),
);
const LazyAdminMemberMediaTab = lazy(() =>
  import("../feature/admin/AdminMemberMediaTab").then((mod) => ({ default: mod.AdminMemberMediaTab })),
);
const LazyCreateMemberModal = lazy(() =>
  import("../feature/admin/CreateMemberModal").then((mod) => ({ default: mod.CreateMemberModal })),
);

export function AdminPage() {
  const { t } = useTranslation("admin");
  const navigate = useNavigate();
  const { setStatus: setAdminNavigationStatus } = useAdminContextNavigation();
  const {
    activeTab,
    auditFilter,
    auditLogQuery,
    auditMonthsQuery,
    auditRows,
    badgesController,
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
    changeUserRole,
    activateUser,
    deactivateUser,
    resetUserPassword,
    resetUserLoginLock,
    invite,
    inviteRows,
    inviteTotal,
    inviteLinksQuery,
    inviteStatsQuery,
    operationsQuery,
    isInviteInactive,
    canAccessAdmin,
    deleteInvite,
    deleteRoleConfig,
    exportAuditLogMutation,
    handleBatchActivate,
    handleBatchDeactivate,
    handleBatchDelete,
    handleBatchRole,
    canEditUsers,
    canAssignUserRoles,
    canActivateUsers,
    canDeleteUsers,
    canResetUserPasswords,
    memberDetailForm,
    memberDetailIsDirty,
    memberMediaController,
    memberSearch,
    patchMemberDetailForm,
    resetMemberDetailForm,
    revokeInvite,
    rolesQuery,
    assignableRoles,
    saveSelectedMemberProfile,
    selectedMemberDetail,
    selectedUserIds,
    setAuditDateFrom,
    setAuditDatePreset,
    setAuditDateTo,
    setAuditSearch,
    setAuditEntityTarget,
    clearAuditEntityTarget,
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
    isUserActionPending,
    isInviteActionPending,
    isRoleDeletePending,
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
  /* 骨架用的是同一套面板配方，加载中和加载完的外框才不会跳一下。 */
  const suspenseFallback = (
    <div className="admin-panel">
      <div className="admin-panel__body">
        <div className="admin-suspense-skeleton">
          <div className="admin-suspense-skeleton__head">
            <Skeleton />
            <Skeleton />
          </div>
          {Array.from({ length: 5 }).map((_, i) => <Skeleton className="admin-suspense-skeleton__row" key={i} />)}
        </div>
      </div>
    </div>
  );

  const accessibleTabs = ADMIN_CONTEXT_ROUTES.filter((route) => tabAccess[route.tab]);

  /* usersQuery 走的是 fetchAllUsersListWithOptions，会把所有分页取全，所以这里的
     长度就是成员总数，不是当前页的行数。 */
  const memberCount = usersQuery.data ? userRowsRaw.length : null;
  const inviteStats = inviteStatsQuery.data ?? null;
  const roleCount = rolesQuery.data?.length ?? null;
  /* 已配置但无法由轻量探针主动验证的服务用黄色表达，不能冒充故障。 */
  const healthState: "ok" | "configured" | "degraded" | "checking" | null = !tabAccess.operations
    ? null
    : statusQuery.data
      ? (() => {
          const values = [statusQuery.data.db, statusQuery.data.r2, statusQuery.data.ws, statusQuery.data.crons]
            .map(serviceState);
          if (values.every((value) => value === "ok")) return "ok";
          if (values.every((value) => value === "ok" || value === "configured")) return "configured";
          return "degraded";
        })()
      : "checking";

  useEffect(() => {
    if (!canAccessAdmin || accessibleTabs.length === 0) {
      setAdminNavigationStatus(initialAdminContextNavigationStatus);
      return;
    }
    setAdminNavigationStatus({
      memberCount,
      inviteActiveCount: inviteStats?.active ?? null,
      inviteHasExpired: (inviteStats?.expired ?? 0) > 0,
      roleCount,
      healthState,
    });
  }, [accessibleTabs.length, canAccessAdmin, healthState, inviteStats, memberCount, roleCount, setAdminNavigationStatus]);

  useEffect(() => () => {
    setAdminNavigationStatus(initialAdminContextNavigationStatus);
  }, [setAdminNavigationStatus]);

  if (!canAccessAdmin) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("forbidden")}</AlertTitle>
      </Alert>
    );
  }

  if (accessibleTabs.length === 0) {
    return (
      <PageLayout className="admin-page">
        <Alert className="admin-no-access-alert">
          <AlertTitle>{t("noAccessibleTabs.title")}</AlertTitle>
          <AlertDescription>{t("noAccessibleTabs.description")}</AlertDescription>
          <Button variant="outline" onClick={() => void navigate({ to: "/dashboard" })}>
            {t("noAccessibleTabs.back")}
          </Button>
        </Alert>
      </PageLayout>
    );
  }

  return (
    <PageLayout className="admin-page" workspaceMode="contained">
        {activeTab === "member" && tabAccess.member ? (
        <section className="admin-page__panel">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminUsersSection
              usersLoading={usersQuery.isLoading}
              usersError={usersQuery.isError}
              onRetryUsers={() => { void usersQuery.refetch(); }}
              canEditUsers={canEditUsers}
              canAssignUserRoles={canAssignUserRoles}
              canActivateUsers={canActivateUsers}
              canDeleteUsers={canDeleteUsers}
              canResetUserPasswords={canResetUserPasswords}
              onOpenCreateMember={createMemberModalHandlers.open}
              selectedUserIds={selectedUserIds}
              onBatchRole={handleBatchRole}
              onBatchActivate={handleBatchActivate}
              onBatchDeactivate={handleBatchDeactivate}
              onBatchDelete={handleBatchDelete}
              batchRolePending={batchRoleMutation.isPending}
              batchActivatePending={batchReactivateMutation.isPending}
              batchDeactivatePending={batchDeactivateMutation.isPending}
              batchDeletePending={batchDeleteMutation.isPending}
              isSingleActionPending={isUserActionPending}
              userRows={userRows}
              userColumns={userColumns}
              onOpenMemberDetail={setMemberDetailId}
              onSelectionChange={applyUserSelection}
              roles={assignableRoles}
              memberSearch={memberSearch}
              onMemberSearchChange={setMemberSearch}
              onSingleRoleChange={changeUserRole}
              onSingleActivate={activateUser}
              onSingleDeactivate={deactivateUser}
              onSingleResetPassword={resetUserPassword}
              onSingleResetLoginLock={resetUserLoginLock}
            />
          </Suspense>
          </ErrorBoundary>
        </section>
        ) : null}

        {activeTab === "invite" && tabAccess.invite ? (
        <section className="admin-page__panel">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminInviteSection
              inviteVisibility={invite.visibility}
              onInviteVisibilityChange={setInviteVisibility}
              onCreateInvite={(input, onSuccess) => {
                createInviteMutation.mutate(input, { onSuccess });
              }}
              roles={assignableRoles}
              createInvitePending={createInviteMutation.isPending}
              inviteStatsLoading={inviteStatsQuery.isLoading}
              inviteStats={inviteStatsQuery.data ?? null}
              inviteLinksLoading={inviteLinksQuery.isLoading}
              inviteLinksError={inviteLinksQuery.isError}
              onRetryInviteLinks={() => { void inviteLinksQuery.refetch(); }}
              inviteRows={inviteRows}
              inviteTotal={inviteTotal}
              hasMoreInvites={inviteLinksQuery.hasNextPage}
              loadingMoreInvites={inviteLinksQuery.isFetchingNextPage}
              onLoadMoreInvites={() => {
                void inviteLinksQuery.fetchNextPage();
              }}
              inviteSearch={invite.search}
              onInviteSearchChange={setInviteSearch}
              isInviteInactive={isInviteInactive}
              isInviteActionPending={isInviteActionPending}
              onRevokeInvite={revokeInvite}
              onDeleteInvite={deleteInvite}
            />
          </Suspense>
          </ErrorBoundary>
        </section>
        ) : null}

        {activeTab === "audit" && tabAccess.audit ? (
        <section className="admin-page__panel">
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
              onRetryAudit={() => { void auditLogQuery.refetch(); }}
              auditRows={auditRows}
              auditHasMore={auditLogQuery.hasNextPage}
              auditLoadingMore={auditLogQuery.isFetchingNextPage}
              onAuditLoadMore={() => { void auditLogQuery.fetchNextPage(); }}
              auditEntityType={auditFilter.entityType}
              auditEntityId={auditFilter.entityId}
              onSelectAuditEntity={setAuditEntityTarget}
              onClearAuditEntity={clearAuditEntityTarget}
              rolesData={rolesQuery.data ?? []}
              userMap={userMap}
              archiveMonths={auditMonthsQuery.data?.months ?? []}
              archiveMonthsLoading={auditMonthsQuery.isLoading}
              archiveMonthsError={auditMonthsQuery.isError}
              onRetryArchiveMonths={() => { void auditMonthsQuery.refetch(); }}
            />
          </Suspense>
          </ErrorBoundary>
        </section>
        ) : null}

        {activeTab === "roles" && tabAccess.roles ? (
        <section className="admin-page__panel">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminRolesSection
              rolesLoading={rolesQuery.isLoading}
              rolesError={rolesQuery.isError}
              onRetryRoles={() => { void rolesQuery.refetch(); }}
              roles={rolesQuery.data ?? []}
              createRolePending={createRoleMutation.isPending}
              updateRolePending={updateRoleConfigMutation.isPending}
              isRoleDeletePending={isRoleDeletePending}
              onCreateRole={createRoleConfig}
              onUpdateRole={updateRoleConfig}
              onDeleteRole={deleteRoleConfig}
            />
          </Suspense>
          </ErrorBoundary>
        </section>
        ) : null}

        {activeTab === "siteConfig" && tabAccess.siteConfig ? (
          <section className="admin-page__panel">
            <ErrorBoundary>
            <Suspense fallback={suspenseFallback}>
              <LazyAdminSiteConfigSection
                data={siteConfigQuery.data ?? null}
                loading={siteConfigQuery.isLoading}
                saving={siteConfigMutations.updateSiteConfigMutation.isPending}
                logoUploading={siteConfigMutations.uploadSiteLogoMutation.isPending}
                onSaveSite={(payload) => siteConfigMutations.updateSiteConfigMutation.mutate(payload)}
                onUploadLogo={(file) => siteConfigMutations.uploadSiteLogoMutation.mutate(file)}
              />
            </Suspense>
            </ErrorBoundary>
          </section>
        ) : null}

        {activeTab === "importantNotices" && tabAccess.importantNotices ? (
          <section className="admin-page__panel">
            <ErrorBoundary>
              <Suspense fallback={suspenseFallback}>
                <LazyAdminImportantNoticesSection />
              </Suspense>
            </ErrorBoundary>
          </section>
        ) : null}

        {activeTab === "classes" && tabAccess.classes ? (
          <section className="admin-page__panel">
            <ErrorBoundary>
              <Suspense fallback={suspenseFallback}>
                <LazyAdminClassesPanel />
              </Suspense>
            </ErrorBoundary>
          </section>
        ) : null}

        {activeTab === "badges" && tabAccess.badges ? (
          <section className="admin-page__panel">
            <ErrorBoundary>
            <Suspense fallback={suspenseFallback}>
              <LazyAdminBadgesSection
                userRows={userRowsRaw}
                controller={badgesController}
              />
            </Suspense>
            </ErrorBoundary>
          </section>
        ) : null}

        {activeTab === "operations" && tabAccess.operations ? (
        <section className="admin-page__panel">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminOperationsTab
              statusLatencyMs={statusLatencyMs}
              statusLoading={statusQuery.isLoading}
              statusError={statusQuery.isError}
              onRetryStatus={() => { void statusQuery.refetch(); }}
              statusData={statusQuery.data ?? null}
              statusHealthLogs={statusHealthLogs}
              operationsData={operationsQuery.data ?? null}
              operationsLoading={operationsQuery.isLoading}
              operationsError={operationsQuery.isError}
              onRetryOperations={() => { void operationsQuery.refetch(); }}
            />
          </Suspense>
          </ErrorBoundary>
        </section>
        ) : null}

        {activeTab === "diagnostics" && tabAccess.diagnostics ? (
        <section className="admin-page__panel">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminDiagnosticsTab />
          </Suspense>
          </ErrorBoundary>
        </section>
        ) : null}
      <Suspense fallback={null}>
        <LazyAdminMemberDetailInspector
          open={Boolean(selectedMemberDetail)}
          member={selectedMemberDetail}
          form={memberDetailForm}
          isDirty={memberDetailIsDirty}
          onClose={closeMemberDetail}
          onFormChange={patchMemberDetailForm}
          onResetForm={resetMemberDetailForm}
          onSaveProfile={saveSelectedMemberProfile}
          saveProfilePending={updateMemberProfileMutation.isPending}
          roles={assignableRoles}
          canEditProfile={canEditUsers}
          canAssignRole={canAssignUserRoles}
          canActivate={canActivateUsers}
          mediaTab={
            selectedMemberDetail ? (
              <Suspense fallback={suspenseFallback}>
                <LazyAdminMemberMediaTab
                  member={selectedMemberDetail}
                  isAdmin={canEditUsers}
                  isModerator={canEditUsers}
                  profileImageQuota={memberMediaController.profileImageQuota}
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
          roles={assignableRoles}
        />
      </Suspense>
    </PageLayout>
  );
}
