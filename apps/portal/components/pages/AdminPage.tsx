import {
  Alert,
  Button,
  Card,
  Group,
  Skeleton,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMediaQuery } from "@mantine/hooks";
import { Fragment, Suspense, lazy } from "react";
import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAdminPageController } from "../../hooks/useAdminPageController";
import { PageLayout } from "../layout/PageLayout";
import { ErrorBoundary } from "@portal/components/effects";
import {
  FileSearchIcon,
  HeartbeatIcon,
  LinkIcon,
  SettingsIcon,
  ShieldIcon,
  SwordIcon,
  TrophyIcon,
  UsersIcon,
} from "@portal/components/icons";
import "./AdminPage.css";

type TabValue =
  | "member" | "invite" | "audit" | "roles"
  | "siteConfig" | "classes" | "badges" | "status";

const TAB_ICONS: Record<TabValue, ComponentType<{ size?: number }>> = {
  member: UsersIcon,
  invite: LinkIcon,
  audit: FileSearchIcon,
  roles: ShieldIcon,
  siteConfig: SettingsIcon,
  classes: SwordIcon,
  badges: TrophyIcon,
  status: HeartbeatIcon,
};

/* 导航按职责分三组，和三种版式一一对应：人员=列表台，配置=主从，运维=设置面。
   八项平铺成一列时没有任何分层，管理员得逐条读标签才能找到要去的地方。 */
const NAV_GROUPS: Array<{ id: "people" | "config" | "ops"; values: TabValue[] }> = [
  { id: "people", values: ["member", "invite", "audit"] },
  { id: "config", values: ["roles", "siteConfig", "classes", "badges"] },
  { id: "ops", values: ["status"] },
];

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
const LazyAdminClassesPanel = lazy(() =>
  import("../feature/admin/AdminClassesPanel").then((mod) => ({ default: mod.AdminClassesPanel })),
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
  const isCompactNavigation = useMediaQuery("(max-width: 79.99em)");
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: string };
  const {
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
    isInviteInactive,
    canAccessAdmin,
    deleteInvite,
    deleteRoleConfig,
    exportAuditLogMutation,
    handleBatchActivate,
    handleBatchDeactivate,
    handleBatchDelete,
    handleBatchRole,
    handleCopyConfigSummary,
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
    revokeInvite,
    rolesQuery,
    assignableRoles,
    saveSelectedMemberProfile,
    selectedMemberDetail,
    selectedUserIds,
    setAuditDateFrom,
    setAuditDatePreset,
    setAuditDateTo,
    setAuditPage,
    setAuditSearch,
    setInviteSearch,
    setInviteVisibility,
    setMemberDetailId,
    setMemberSearch,
    statusHealthLogs,
    statusLatencyMs,
    refreshStatus,
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

  const tabs = ([
    { value: "member", label: t("tab.member"), visible: tabAccess.member },
    { value: "invite", label: t("tab.invite"), visible: tabAccess.invite },
    { value: "audit", label: t("tab.audit"), visible: tabAccess.audit },
    { value: "roles", label: t("tab.roles"), visible: tabAccess.roles },
    { value: "siteConfig", label: t("tab.siteConfig"), visible: tabAccess.siteConfig },
    { value: "classes", label: t("tab.classes"), visible: tabAccess.classes },
    { value: "badges", label: t("tab.badges"), visible: tabAccess.badges },
    { value: "status", label: t("tab.status"), visible: tabAccess.status },
  ] as Array<{ value: TabValue; label: string; visible: boolean }>).filter((tab) => tab.visible);

  if (tabs.length === 0) {
    return (
      <PageLayout className="admin-page">
        <Alert color="orange" title={t("noAccessibleTabs.title")}>
          <Stack gap="sm" align="flex-start">
            <Text size="sm">{t("noAccessibleTabs.description")}</Text>
            <Button variant="default" onClick={() => void navigate({ to: "/" })}>
              {t("noAccessibleTabs.back")}
            </Button>
          </Stack>
        </Alert>
      </PageLayout>
    );
  }

  const activeTab = tabs.some((tab) => tab.value === search.tab) ? search.tab! : (tabs[0]?.value ?? "member");
  const setActiveTab = (nextTab: string | null) => {
    if (!nextTab) return;
    const tab = nextTab as TabValue;
    void navigate({
      to: "/admin",
      search: (previous) => ({ ...previous, tab: tab === "member" ? undefined : tab }),
      replace: true,
      viewTransition: false,
    });
  };

  /* usersQuery 走的是 fetchAllUsersListWithOptions，会把所有分页取全，所以这里的
     长度就是成员总数，不是当前页的行数。 */
  const memberCount = usersQuery.data ? userRowsRaw.length : null;
  const inviteStats = inviteStatsQuery.data ?? null;
  const roleCount = rolesQuery.data?.length ?? null;
  /* 已配置但无法由轻量探针主动验证的服务用黄色表达，不能冒充故障。 */
  const healthState: "ok" | "configured" | "degraded" | "checking" | null = !tabAccess.status
    ? null
    : statusQuery.data
      ? (() => {
          const values = [statusQuery.data.db, statusQuery.data.r2, statusQuery.data.ws, statusQuery.data.crons];
          if (values.every((value) => value === "ok")) return "ok";
          if (values.every((value) => value === "ok" || value === "configured")) return "configured";
          return "degraded";
        })()
      : "checking";

  const navCounts: Partial<Record<TabValue, ReactNode>> = {
    member: memberCount === null ? null : (
      <span className="admin-page__nav-count">{memberCount}</span>
    ),
    /* 过期的邀请码是唯一需要管理员动手清理的，用它决定徽章要不要转黄。 */
    invite: inviteStats === null ? null : (
      <span className={`admin-page__nav-count${inviteStats.expired > 0 ? " admin-page__nav-count--warn" : ""}`}>
        {inviteStats.active}
      </span>
    ),
    roles: roleCount === null ? null : (
      <span className="admin-page__nav-count">{roleCount}</span>
    ),
    /* 页签上这颗点是健康状态的唯一载体，必须带可读标签，不能 aria-hidden。 */
    status: healthState === null ? null : (
      <span
        className={`admin-page__nav-dot admin-page__nav-dot--${healthState}`}
        role="img"
        aria-label={t(`header.health.${healthState}`)}
      />
    ),
  };

  return (
    <PageLayout className="admin-page">
        <Tabs
          value={activeTab}
          keepMounted={false}
          orientation={isCompactNavigation ? "horizontal" : "vertical"}
          className={`admin-page__workspace${isCompactNavigation ? " admin-page__workspace--compact" : ""}`}
          onChange={setActiveTab}
        >
            <Tabs.List
              className="admin-page__domain-nav"
              aria-label={t("navigation.section")}
            >
              {NAV_GROUPS.map((group) => {
                const groupTabs = tabs.filter((tab) => group.values.includes(tab.value));
                if (groupTabs.length === 0) return null;
                return (
                  <Fragment key={group.id}>
                    {/* 分组标题不是可聚焦项，对读屏隐藏，避免混进 tablist 的遍历序列。 */}
                    <span className="admin-page__nav-group" aria-hidden="true">
                      {t(`nav.group.${group.id}`)}
                    </span>
                    {groupTabs.map((tab) => {
                      const Icon = TAB_ICONS[tab.value];
                      return (
                        <Tabs.Tab
                          key={tab.value}
                          value={tab.value}
                          leftSection={<Icon size={16} />}
                          rightSection={navCounts[tab.value] ?? undefined}
                        >
                          {tab.label}
                        </Tabs.Tab>
                      );
                    })}
                  </Fragment>
                );
              })}
            </Tabs.List>

        {tabAccess.member ? (
        <Tabs.Panel value="member" className="admin-page__panel">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminUsersSection
              usersLoading={usersQuery.isLoading}
              usersError={usersQuery.isError}
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
        </Tabs.Panel>
        ) : null}

        {tabAccess.invite ? (
        <Tabs.Panel value="invite" className="admin-page__panel">
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
        </Tabs.Panel>
        ) : null}

        {tabAccess.audit ? (
        <Tabs.Panel value="audit" className="admin-page__panel">
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
        <Tabs.Panel value="roles" className="admin-page__panel">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminRolesSection
              rolesLoading={rolesQuery.isLoading}
              rolesError={rolesQuery.isError}
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
        </Tabs.Panel>
        ) : null}

        {tabAccess.siteConfig ? (
          <Tabs.Panel value="siteConfig" className="admin-page__panel">
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
          </Tabs.Panel>
        ) : null}

        {tabAccess.classes ? (
          <Tabs.Panel value="classes" className="admin-page__panel">
            <ErrorBoundary>
              <Suspense fallback={suspenseFallback}>
                <LazyAdminClassesPanel />
              </Suspense>
            </ErrorBoundary>
          </Tabs.Panel>
        ) : null}

        {tabAccess.badges ? (
          <Tabs.Panel value="badges" className="admin-page__panel">
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

        {tabAccess.status ? (
        <Tabs.Panel value="status" className="admin-page__panel">
          <ErrorBoundary>
          <Suspense fallback={suspenseFallback}>
            <LazyAdminStatusTab
              onRunQuickCheck={() => { void refreshStatus(); }}
              onCopyConfigSummary={handleCopyConfigSummary}
              canCopyConfigSummary={Boolean(statusQuery.data)}
              statusLatencyMs={statusLatencyMs}
              statusLoading={statusQuery.isLoading}
              statusChecking={statusQuery.isFetching}
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
          isDirty={memberDetailIsDirty}
          onClose={closeMemberDetail}
          onFormChange={patchMemberDetailForm}
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
