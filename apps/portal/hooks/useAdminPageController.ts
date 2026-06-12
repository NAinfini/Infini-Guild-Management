import { type AdminRole } from "@guild/shared";
import { Badge } from "@mantine/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { createElement, type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef as TanStackColumnDef } from "@tanstack/react-table";
import { usePageHeaderActions } from "../context/PageHeaderContext";
import { useAuthStore } from "../stores/auth";
import { copyPlainText } from "../utils/copy";
import { userCanAccessAdmin } from "../utils/permissions";
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

export const BATCH_SELECTION_LIMIT = 50;

const ADMIN_TABS = ["member", "invite", "audit", "roles", "siteConfig", "badges", "gameData", "status"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

function isAdminTab(value: string): value is AdminTab {
  return ADMIN_TABS.includes(value as AdminTab);
}

const BadgeCell = Badge as ComponentType<{ color: string }>;

export function useAdminPageController() {
  const { t } = useTranslation("admin");
  const user = useAuthStore((state) => state.user);
  const { viewingAs, isModerator, canManage: canManagePermission } = useEffectivePermissions();
  const { showError } = useAppError();
  const { member: memberSearchParam, tab: tabSearchParam } = useSearch({ strict: false }) as { member?: string; tab?: string };
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AdminTab>(tabSearchParam && isAdminTab(tabSearchParam) ? tabSearchParam : "member");
  const [memberSearch, setMemberSearch] = useState("");

  const handleTabChange = useCallback((value: string | null) => {
    if (!value || !isAdminTab(value)) return;
    setActiveTab(value);
    const tab = value === "member" ? undefined : value;
    void navigate({ to: "/admin", search: (prev) => ({ ...prev, tab }), replace: true, viewTransition: false });
  }, [navigate]);

  const {
    auditFilter,
    setAuditPage,
    setAuditSearch,
    setAuditDateFrom,
    setAuditDateTo,
    setAuditDatePreset,
  } = useAdminAuditFilter();

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
    canManageGameData: canManagePermission(["admin.gameData.manage"]),
    canManageSiteConfig: canManagePermission(["admin.siteConfig.manage"]),
  }), [canManagePermission, user]);

  const {
    usersQuery,
    inviteLinksQuery,
    inviteStatsQuery,
    auditLogQuery,
    auditMonthsQuery,
    rolesQuery,
    siteConfigQuery,
    statusQuery,
    permissions,
  } = useAdminData({
    isModerator: userCanAccessAdmin(user),
    userRole: viewingAs,
    effectivePermissions: effectiveAdminPermissions,
    auditPage: auditFilter.page,
    auditSearch: auditFilter.search,
    auditDateFrom: auditFilter.dateFrom,
    auditDateTo: auditFilter.dateTo,
    auditEntityType: auditFilter.entityType,
    auditActorId: auditFilter.actorId,
  });

  const inviteController = useAdminInviteController({
    inviteLinks: inviteLinksQuery.data ?? [],
  });

  const userRowsRaw = usersQuery.data?.data ?? [];
  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of userRowsRaw) {
      map.set(row.user.id, row.user.username);
    }
    return map;
  }, [userRowsRaw]);
  const resolveUsername = useCallback((id: string) => userMap.get(id), [userMap]);

  const adminMutations = useAdminMutations({
    invite: inviteController.invite,
    auditFilter,
    batchSelectionLimit: BATCH_SELECTION_LIMIT,
    showError,
    resolveUsername,
  });

  const rolesLoaded = rolesQuery.isSuccess;
  const isAdmin = rolesLoaded
    ? permissions.canManageRoles || permissions.canViewStatus
    : canManagePermission(["admin.roles.manage"]) || canManagePermission(["admin.status.view"]);
  const canViewUsers = rolesLoaded
    ? permissions.canViewUsers
    : canManagePermission(["admin.users.view"]);
  const canViewInvites = rolesLoaded
    ? permissions.canViewInvites
    : canManagePermission(["admin.invite.view"]);
  const canViewAudit = rolesLoaded
    ? permissions.canViewAudit
    : canManagePermission(["admin.audit.view"]);
  const canViewRoles = rolesLoaded
    ? permissions.canViewRoles
    : canManagePermission(["admin.roles.view", "admin.roles.manage"]);
  const canViewStatus = rolesLoaded
    ? permissions.canViewStatus
    : canManagePermission(["admin.status.view"]);
  const canManageBadges = rolesLoaded
    ? permissions.canManageBadges
    : canManagePermission(["admin.badges.manage"]);
  const canManageGameData = rolesLoaded
    ? permissions.canManageGameData
    : canManagePermission(["admin.gameData.manage"]);
  const canManageSiteConfig = rolesLoaded
    ? permissions.canManageSiteConfig
    : canManagePermission(["admin.siteConfig.manage"]);
  const tabAccess = useMemo<Record<AdminTab, boolean>>(() => ({
    member: canViewUsers,
    invite: canViewInvites,
    audit: canViewAudit,
    roles: canViewRoles,
    siteConfig: canManageSiteConfig,
    badges: canManageBadges,
    gameData: canManageGameData,
    status: canViewStatus,
  }), [
    canManageBadges,
    canManageGameData,
    canManageSiteConfig,
    canViewAudit,
    canViewInvites,
    canViewRoles,
    canViewStatus,
    canViewUsers,
  ]);
  const firstAvailableTab = useMemo<AdminTab | null>(() => {
    return ADMIN_TABS.find((tab) => tabAccess[tab]) ?? null;
  }, [tabAccess]);
  const badgesController = useAdminBadgesController(canManageBadges);
  const siteConfigMutations = useSiteConfigMutations({ showError });

  useEffect(() => {
    if (rolesLoaded && !tabAccess[activeTab] && firstAvailableTab) {
      handleTabChange(firstAvailableTab);
    }
  }, [activeTab, firstAvailableTab, handleTabChange, rolesLoaded, tabAccess]);

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

  const userColumns = useMemo((): TanStackColumnDef<(typeof userRows)[number], unknown>[] => [
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
      cell: ({ row }) => {
        const roleId = row.original.user.role;
        const roleDef = rolesQuery.data?.find((r) => r.id === roleId);
        const color = roleDef?.color ?? "blue";
        return createElement(BadgeCell, { color }, t(`role.${roleId}`));
      },
    },
    {
      header: t("member.table.active"),
      id: "active",
      accessorFn: (row) => row.user.is_active,
      cell: ({ row }) => row.original.user.is_active
        ? createElement(BadgeCell, { color: "green" }, t("member.status.active"))
        : createElement(BadgeCell, { color: "red" }, t("member.status.inactive")),
    },
  ], [t, isAdmin, rolesQuery.data]);

  const handleCopyConfigSummary = useCallback(() => {
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
  }, [statusLatencyMs, statusQuery.data]);

  const closeMemberDetail = useCallback(() => setMemberDetailId(null), [setMemberDetailId]);
  const patchMemberDetailForm = useCallback(
    (patch: Partial<typeof memberDetailForm>) => setMemberDetailForm((prev) => ({ ...prev, ...patch })),
    [setMemberDetailForm],
  );
  const saveSelectedMemberProfile = useCallback(() => {
    if (!selectedMemberDetail) return;
    adminMutations.updateMemberProfileMutation.mutate({
      userId: selectedMemberDetail.user.id,
      form: memberDetailForm,
    });
  }, [adminMutations.updateMemberProfileMutation, memberDetailForm, selectedMemberDetail]);
  const createMember = useCallback(async (data: { username: string; notes: string }) => {
    const result = await adminMutations.createMemberMutation.mutateAsync(data);
    return result;
  }, [adminMutations.createMemberMutation]);

  usePageHeaderActions(null);
  useLoadWarningToast(
    usersQuery.isError ||
      inviteLinksQuery.isError ||
      inviteStatsQuery.isError ||
      auditLogQuery.isError ||
      auditMonthsQuery.isError ||
      rolesQuery.isError ||
      siteConfigQuery.isError ||
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
    handleCopyConfigSummary,
    handleTabChange,
    inviteLinksQuery,
    inviteStatsQuery,
    ...inviteController,
    isAdmin,
    isModerator,
    memberDetailForm,
    memberMediaController,
    memberSearch,
    rolesQuery,
    rolesWithExternal,
    selectedMemberDetail,
    setAuditDateFrom,
    setAuditDatePreset,
    setAuditDateTo,
    setAuditPage,
    setAuditSearch,
    setMemberDetailId,
    setMemberSearch,
    statusHealthLogs,
    statusLatencyMs,
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
    saveSelectedMemberProfile,
    ...adminMutations,
  };
}

export type AdminPageController = ReturnType<typeof useAdminPageController>;
