import { Badge } from "@portal/components/ui/badge";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { createElement, type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DataTableColumnDef } from "../components/shared/data-table-features";
import { usePageHeaderActions } from "../context/PageHeaderContext";
import { useAuthStore } from "../stores/auth";
import { canManageUserByRoleLevel, isRoleAssignableToUser, userCanAccessAdmin } from "../utils/permissions";
import { useAdminBadgesController } from "./useAdminBadgesController";
import { useAdminAuditFilter } from "./useAdminAuditFilter";
import { useAdminInviteController } from "./useAdminInviteController";
import { useAdminMemberDetail } from "./useAdminMemberDetail";
import { useAdminMutations } from "./useAdminMutations";
import { useAdminStatusController } from "./useAdminStatusController";
import { useAppError } from "./useAppError";
import { useEffectivePermissions } from "./useEffectivePermissions";
import { useLoadWarningToast } from "./useLoadWarningToast";
import { useAdminData } from "./data/useAdminData";
import { useSiteConfigMutations } from "./useSiteConfigMutations";
import { useClassCatalog } from "./data/useClassData";
import { useDebouncedSearch } from "./useDebouncedSearch";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import type { MemberListSort } from "@guild/shared";
import type { MemberStatusFilter } from "../types/admin";
import { resolveClassCatalogItem } from "../utils/class-catalog";
import { formatDateTime } from "../utils/datetime";
import {
  ADMIN_CONTEXT_ROUTES,
  isAdminContextTab,
  resolveAdminContextTab,
  type AdminContextTab,
} from "../components/layout/admin-context-nav";

export const BATCH_SELECTION_LIMIT = 50;
const ROLE_METADATA_PERMISSIONS = [
  "admin.roles.view",
  "admin.roles.manage",
] as const;

export function useAdminPageController() {
  const { t } = useTranslation("admin");
  const user = useAuthStore((state) => state.user);
  const classCatalog = useClassCatalog();
  const { viewingAs, isModerator, canManage: canManagePermission } = useEffectivePermissions();
  const { showError } = useAppError();
  const { member: memberSearchParam, tab: tabSearchParam } = useSearch({ strict: false }) as { member?: string; tab?: string };
  const navigate = useNavigate();
  const requestedTab = resolveAdminContextTab(tabSearchParam);
  const { search: memberSearch, setSearch: setMemberSearch, debouncedSearch: debouncedMemberSearch } = useDebouncedSearch();
  const [memberPagination, setMemberPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [memberSorting, setMemberSorting] = useState<SortingState>([]);
  const [memberStatusFilter, setMemberStatusFilter] = useState<MemberStatusFilter>("all");
  const memberSortIds: Record<string, MemberListSort> = { display_name: "display_name", power: "power", class: "class", role: "role", lastLogin: "last_login_at", active: "is_active" };
  const memberList = {
    page: memberPagination.pageIndex + 1,
    limit: memberPagination.pageSize,
    includeTotal: true,
    searchScope: "management" as const,
    search: debouncedMemberSearch.trim(),
    active: memberStatusFilter === "all" ? undefined : memberStatusFilter === "active",
    sort: memberSortIds[memberSorting[0]?.id ?? ""] ?? "created_at",
    direction: memberSorting[0]?.desc ? "desc" as const : "asc" as const,
  };
  useEffect(() => {
    setMemberPagination((current) => current.pageIndex === 0 ? current : { ...current, pageIndex: 0 });
  }, [debouncedMemberSearch, memberStatusFilter, memberSorting]);

  const handleTabChange = useCallback((value: string | null) => {
    if (!value || !isAdminContextTab(value)) return;
    const tab = value === "member" ? undefined : value;
    void navigate({ to: "/admin", search: (prev) => ({ ...prev, tab }), replace: true, viewTransition: false });
  }, [navigate]);

  const {
    auditFilter,
    setAuditSearch,
    setAuditDateFrom,
    setAuditDateTo,
    setAuditDatePreset,
    setAuditEntityTarget,
    clearAuditEntityTarget,
  } = useAdminAuditFilter();
  const inviteController = useAdminInviteController();

  const effectiveAdminPermissions = useMemo(() => ({
    canAccessAdmin: userCanAccessAdmin(user),
    canViewUsers: canManagePermission(["admin.users.view"]),
    canViewInvites: canManagePermission(["admin.invite.view"]),
    canViewAudit: canManagePermission(["admin.audit.view"]),
    canExportAudit: canManagePermission(["admin.audit.export"]),
    canViewRoles: canManagePermission(["admin.roles.view", "admin.roles.manage"]),
    canManageRoles: canManagePermission(["admin.roles.manage"]),
    canViewStatus: canManagePermission(["admin.status.view"]),
    canManageBadges: canManagePermission(["admin.badges.manage"]),
    canManageSiteConfig: canManagePermission(["admin.siteConfig.manage"]),
    canManageImportantNotices: canManagePermission(["admin.importantNotices.manage"]),
    canManageClasses: canManagePermission(["admin.classes.manage"]),
  }), [canManagePermission, user]);
  const tabAccess = useMemo<Record<AdminContextTab, boolean>>(() => {
    return Object.fromEntries(
      ADMIN_CONTEXT_ROUTES.map((route) => [
        route.tab,
        canManagePermission([...route.permissions]),
      ]),
    ) as Record<AdminContextTab, boolean>;
  }, [canManagePermission]);
  const firstAvailableTab = useMemo<AdminContextTab | null>(() => {
    return ADMIN_CONTEXT_ROUTES.find((route) => tabAccess[route.tab])?.tab ?? null;
  }, [tabAccess]);
  const activeTab = tabAccess[requestedTab] ? requestedTab : firstAvailableTab ?? requestedTab;
  const canReadRoleMetadata = Boolean(
    user && ROLE_METADATA_PERMISSIONS.some((permission) => user.permissions[permission] === true),
  );

  const {
    usersQuery,
    inviteLinksQuery,
    inviteStatsQuery,
    operationsQuery,
    auditLogQuery,
    auditMonthsQuery,
    rolesQuery,
    siteConfigQuery,
    statusQuery,
  } = useAdminData({
    isModerator: userCanAccessAdmin(user),
    userRole: viewingAs,
    activeTab,
    effectivePermissions: effectiveAdminPermissions,
    canReadRoleMetadata,
    auditSearch: auditFilter.search,
    auditDateFrom: auditFilter.dateFrom,
    auditDateTo: auditFilter.dateTo,
    auditEntityType: auditFilter.entityType,
    auditEntityId: auditFilter.entityId,
    auditActorId: auditFilter.actorId,
    inviteVisibility: inviteController.invite.visibility,
    inviteSearch: inviteController.debouncedInviteSearch,
    memberList,
  });

  const inviteRows = useMemo(() => {
    const uniqueRows = new Map<string, NonNullable<typeof inviteLinksQuery.data>["pages"][number]["data"][number]>();
    for (const page of inviteLinksQuery.data?.pages ?? []) {
      for (const row of page.data) {
        uniqueRows.set(row.id, row);
      }
    }
    return [...uniqueRows.values()];
  }, [inviteLinksQuery.data]);
  const inviteTotal = inviteLinksQuery.data?.pages.at(-1)?.total ?? 0;

  const userRowsRaw = usersQuery.data?.data ?? [];
  useEffect(() => {
    const pages = usersQuery.data?.total_pages;
    if (pages && memberPagination.pageIndex >= pages) setMemberPagination((current) => ({ ...current, pageIndex: pages - 1 }));
  }, [memberPagination.pageIndex, usersQuery.data?.total_pages]);
  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of userRowsRaw) {
      map.set(row.user.id, row.user.display_name);
    }
    return map;
  }, [userRowsRaw]);
  const resolveUsername = useCallback((id: string) => userMap.get(id), [userMap]);

  const adminMutations = useAdminMutations({
    auditFilter,
    batchSelectionLimit: BATCH_SELECTION_LIMIT,
    showError,
    resolveUsername,
  });

  const canManageBadges = effectiveAdminPermissions.canManageBadges;
  const canViewStatus = effectiveAdminPermissions.canViewStatus;
  const canEditUsers = canManagePermission(["admin.users.edit"]);
  const canAssignUserRoles = canManagePermission(["admin.users.role"]);
  const canActivateUsers = canManagePermission(["admin.users.activate"]);
  const canDeleteUsers = canManagePermission(["admin.users.delete"]);
  const canResetUserPasswords = canManagePermission(["admin.users.password"]);
  const badgesController = useAdminBadgesController(
    canManageBadges && activeTab === "badges",
  );
  const siteConfigMutations = useSiteConfigMutations({ showError });

  useEffect(() => {
    if (!tabAccess[requestedTab] && firstAvailableTab) {
      handleTabChange(firstAvailableTab);
    }
  }, [firstAvailableTab, handleTabChange, requestedTab, tabAccess]);

  const {
    setMemberDetailId,
    memberDetailForm,
    setMemberDetailForm,
    resetMemberDetailForm,
    isDirty: memberDetailIsDirty,
    markMemberDetailSaved,
    selectedMemberDetail,
    memberDetailRevisions,
    createMemberModalOpen,
    createMemberModalHandlers,
    memberMediaController,
    memberDetailQuery,
  } = useAdminMemberDetail({
    memberSearchParam,
    currentUserId: user?.id,
    showError,
  });

  const { statusLatencyMs, statusHealthLogs, refreshStatus } = useAdminStatusController({
    statusQuery,
    activeTab,
    isAdmin: canViewStatus,
  });

  const userRows = userRowsRaw;

  const roleCatalog = canReadRoleMetadata && rolesQuery.isSuccess ? rolesQuery.data : null;
  const assignableRoles = useMemo(
    () => roleCatalog?.filter((role) => isRoleAssignableToUser(role, user)) ?? [],
    [roleCatalog, user],
  );
  const auditRows = useMemo(() => {
    const rows = new Map<string, NonNullable<typeof auditLogQuery.data>["pages"][number]["data"][number]>();
    for (const page of auditLogQuery.data?.pages ?? []) {
      for (const row of page.data) rows.set(row.event_id, row);
    }
    return [...rows.values()];
  }, [auditLogQuery.data]);

  const userColumns = useMemo((): DataTableColumnDef<(typeof userRows)[number]>[] => [
    {
      header: t("member.table.display_name"),
      id: "display_name",
      accessorFn: (row) => row.user.display_name,
    },
    {
      header: t("member.table.class"),
      id: "class",
      accessorFn: (row) => row.profile.classes[0] ?? "",
      cell: ({ row }) => {
        const classId = row.original.profile.classes[0];
        return classId ? resolveClassCatalogItem(classId, classCatalog).label : "-";
      },
    },
    {
      header: t("member.table.power"),
      id: "power",
      accessorFn: (row) => row.profile.power,
      /* 数值列右对齐 + 千分位，位数对齐才能一眼比大小。 */
      cell: ({ row }) => row.original.profile.power.toLocaleString(),
    },
    {
      header: t("member.table.notes"),
      id: "notes",
      enableSorting: false,
      cell: ({ row }) => (canEditUsers ? row.original.profile.notes ?? "-" : t("member.table.restricted")),
    },
    {
      header: t("member.table.role"),
      id: "role",
      accessorFn: (row) => row.user.role_name,
      cell: ({ row }) => {
        const role = row.original.user;
        const color = role.role_color ?? "gray";
        /* filled 的实心胶囊每行都在喊；身份是背景信息，用 light 就够。
           颜色是管理员在角色页自己填的任意 hex（内置 moderator 就是 #756047 这种深棕），
           拿它当文字色一定会撞出读不清的组合，所以只让它管背景，文字锁在语义色上。 */
        return createElement(
          Badge,
          {
            variant: "outline",
            className: "admin-cell-role",
            style: { "--role-color": color } as CSSProperties,
          },
          role.role_name,
        );
      },
    },
    {
      header: t("member.table.lastLogin"),
      id: "lastLogin",
      /* 排序键用原始 ISO 串：它按字典序排就是按时间排，不用为排序再解析一次日期。
         从未登录过的排在最前（空串最小），正好是最该被管理员看到的一批。 */
      accessorFn: (row) => row.user.last_login_at ?? "",
      cell: ({ row }) => createElement(
        "span",
        { className: "admin-cell-timestamp" },
        row.original.user.last_login_at
          ? formatDateTime(row.original.user.last_login_at)
          : t("member.table.lastLogin.never"),
      ),
    },
    {
      header: t("member.table.active"),
      id: "active",
      accessorFn: (row) => row.user.is_active,
      /* 绝大多数行都是「启用」。给每一行都套一个饱和绿胶囊，等于把噪声铺满整张表，
         真正需要注意的「停用」反而淹了。改成小圆点 + 文字，颜色只留给异常。 */
      cell: ({ row }) => {
        const active = row.original.user.is_active;
        return createElement(
          "span",
          { className: `admin-cell-status admin-cell-status--${active ? "active" : "inactive"}` },
          createElement("span", { className: "admin-cell-status__dot" }),
          active ? t("member.status.active") : t("member.status.inactive"),
        );
      },
    },
  ], [canEditUsers, classCatalog, t]);

  const closeMemberDetail = useCallback(() => setMemberDetailId(null), [setMemberDetailId]);
  const patchMemberDetailForm = useCallback(
    (patch: Partial<typeof memberDetailForm>) => setMemberDetailForm((prev) => ({ ...prev, ...patch })),
    [setMemberDetailForm],
  );
  const saveSelectedMemberProfile = useCallback(async (): Promise<boolean> => {
    if (!selectedMemberDetail || !memberDetailRevisions || !canManageUserByRoleLevel(selectedMemberDetail.user, user)) return false;
    const memberId = selectedMemberDetail.user.id;
    const savedForm = structuredClone(memberDetailForm);
    const profileChanged = memberDetailForm.power !== selectedMemberDetail.profile.power
      || JSON.stringify(memberDetailForm.classes) !== JSON.stringify(selectedMemberDetail.profile.classes)
      || memberDetailForm.titleHtml !== (selectedMemberDetail.profile.title_html ?? "")
      || memberDetailForm.bio !== (selectedMemberDetail.profile.bio ?? "")
      || JSON.stringify(memberDetailForm.availability) !== JSON.stringify(selectedMemberDetail.profile.availability)
      || memberDetailForm.notes !== (selectedMemberDetail.profile.notes ?? "");
    const displayNameChanged = memberDetailForm.displayName !== selectedMemberDetail.user.display_name;
    const roleChanged = memberDetailForm.role !== selectedMemberDetail.user.role;
    const statusChanged = memberDetailForm.isActive !== selectedMemberDetail.user.is_active;
    const update = {
      userId: memberId,
      expectedUserRevisionToken: memberDetailRevisions.user_revision_token,
      expectedProfileRevisionToken: memberDetailRevisions.profile_revision_token,
      displayName: canEditUsers && displayNameChanged ? memberDetailForm.displayName : undefined,
      profile: canEditUsers && profileChanged ? memberDetailForm : undefined,
      role: canAssignUserRoles && roleChanged ? memberDetailForm.role : undefined,
      isActive: canActivateUsers && statusChanged ? memberDetailForm.isActive : undefined,
    };
    if (update.displayName === undefined && !update.profile && !update.role && update.isActive === undefined) return true;
    try {
      const result = await adminMutations.updateMemberProfileMutation.mutateAsync(update);
      markMemberDetailSaved(memberId, savedForm, {
        user_revision_token: result.user_revision_token,
        profile_revision_token: result.profile_revision_token,
      });
      return true;
    } catch {
      return false;
    }
  }, [
    adminMutations.updateMemberProfileMutation,
    canActivateUsers,
    canAssignUserRoles,
    canEditUsers,
    markMemberDetailSaved,
    memberDetailRevisions,
    memberDetailForm,
    selectedMemberDetail,
    user,
  ]);
  const createMember = useCallback(async (data: {
    login_name: string;
    display_name: string;
    notes: string;
    roleId: string;
  }) => {
    const result = await adminMutations.createMemberMutation.mutateAsync(data);
    return result;
  }, [adminMutations.createMemberMutation]);

  usePageHeaderActions(null);
  useLoadWarningToast(
    usersQuery.isError || memberDetailQuery.isError ||
      inviteLinksQuery.isError ||
      inviteStatsQuery.isError ||
      auditLogQuery.isError ||
      auditMonthsQuery.isError ||
      rolesQuery.isError ||
      siteConfigQuery.isError ||
      operationsQuery.isError ||
      statusQuery.isError,
    t("common:loadErrorRetry"),
  );

  return {
    activeTab,
    auditFilter,
    auditLogQuery,
    auditMonthsQuery,
    auditRows,
    badgesController,
    batchSelectionLimit: BATCH_SELECTION_LIMIT,
    canAccessAdmin: userCanAccessAdmin(user),
    createMember,
    createMemberModalHandlers,
    createMemberModalOpen,
    firstAvailableTab,
    inviteLinksQuery,
    inviteRows,
    inviteTotal,
    inviteStatsQuery,
    operationsQuery,
    ...inviteController,
    isModerator,
    canEditUsers,
    canAssignUserRoles,
    canActivateUsers,
    canDeleteUsers,
    canResetUserPasswords,
    memberDetailForm,
    memberDetailIsDirty,
    memberMediaController,
    memberSearch,
    memberPagination,
    setMemberPagination,
    memberSorting,
    setMemberSorting,
    memberStatusFilter,
    setMemberStatusFilter,
    memberDetailQuery,
    rolesQuery,
    roleCatalog,
    assignableRoles,
    selectedMemberDetail,
    setAuditDateFrom,
    setAuditDatePreset,
    setAuditDateTo,
    setAuditSearch,
    setAuditEntityTarget,
    clearAuditEntityTarget,
    setMemberDetailId,
    setMemberSearch,
    statusHealthLogs,
    statusLatencyMs,
    refreshStatus,
    statusQuery,
    siteConfigQuery,
    siteConfigMutations,
    tabAccess,
    userColumns,
    userMap,
    userRows,
    userRowsRaw,
    usersQuery,
    closeMemberDetail,
    patchMemberDetailForm,
    resetMemberDetailForm,
    saveSelectedMemberProfile,
    ...adminMutations,
  };
}

export type AdminPageController = ReturnType<typeof useAdminPageController>;
