import { type CategoryDef, type EndpointDef } from "./types";

export function buildApiCategories(t: (key: string) => string): CategoryDef[] {
  return [
    {
      key: "system",
      label: t("status.api.cat.system"),
      endpoints: [
        { label: t("status.api.ep.healthCheck"), method: "GET", path: "/api/health" },
        { label: t("status.api.ep.siteConfig"), method: "GET", path: "/api/site-config" },
        { label: t("status.api.ep.adminStatus"), method: "GET", path: "/api/admin/status" },
        { label: t("status.api.ep.analyticsSettings"), method: "GET", path: "/api/admin/analytics-settings" },
        { label: t("status.api.ep.updateAnalyticsSettings"), method: "PATCH", path: "/api/admin/analytics-settings" },
        { label: t("status.api.ep.dashboardMembers"), method: "GET", path: "/api/dashboard/members" },
        { label: t("status.api.ep.dashboardEvents"), method: "GET", path: "/api/dashboard/events" },
        { label: t("status.api.ep.dashboardWars"), method: "GET", path: "/api/dashboard/wars" },
        { label: t("status.api.ep.globalSearch"), method: "GET", path: "/api/search?q=systemtest&limit=5" },
      ],
    },
    {
      key: "auth",
      label: t("status.api.cat.auth"),
      endpoints: [
        { label: t("status.api.ep.checkUsername"), method: "GET", path: "/api/auth/check-username?username=test" },
        { label: t("status.api.ep.currentUser"), method: "GET", path: "/api/auth/me" },
        { label: t("status.api.ep.registerInvitePrep"), method: "GET", path: "/api/admin/invite-links" },
        { label: t("status.api.ep.createInvite"), method: "POST", path: "/api/admin/invite-links" },
        { label: t("status.api.ep.verifyInvite"), method: "GET", path: "/api/auth/verify-invite/:code" },
        { label: t("status.api.ep.register"), method: "POST", path: "/api/auth/register/:inviteCode" },
        { label: t("status.api.ep.login"), method: "POST", path: "/api/auth/login" },
        { label: t("status.api.ep.logout"), method: "POST", path: "/api/auth/logout" },
      ],
    },
    {
      key: "users",
      label: t("status.api.cat.users"),
      endpoints: [
        { label: t("status.api.ep.listUsers"), method: "GET", path: "/api/users?page=1&limit=5" },
        { label: t("status.api.ep.userStats"), method: "GET", path: "/api/users/stats" },
        { label: t("status.api.ep.absenceWindow"), method: "GET", path: "/api/users/absences?from=2026-01-01&to=2026-01-31" },
        { label: t("status.api.ep.getUserById"), method: "GET", path: "/api/users/:id" },
        { label: t("status.api.ep.userAbsences"), method: "GET", path: "/api/users/:id/absences" },
        { label: t("status.api.ep.createAbsence"), method: "POST", path: "/api/users/:id/absences" },
        { label: t("status.api.ep.deleteAbsence"), method: "DELETE", path: "/api/users/:id/absences/:absenceId" },
        { label: t("status.api.ep.updateProfile"), method: "PATCH", path: "/api/users/:id/profile" },
        { label: t("status.api.ep.changePassword"), method: "POST", path: "/api/users/:id/change-password" },
        { label: t("status.api.ep.changeUsername"), method: "POST", path: "/api/users/:id/change-username" },
        { label: t("status.api.ep.uploadImage"), method: "POST", path: "/api/users/:id/media/images" },
        { label: t("status.api.ep.getUserImage"), method: "GET", path: "/api/users/image" },
        { label: t("status.api.ep.deleteImage"), method: "DELETE", path: "/api/users/:id/media/images" },
        { label: t("status.api.ep.uploadAvatar"), method: "POST", path: "/api/users/:id/media/avatar" },
        { label: t("status.api.ep.deleteAvatar"), method: "DELETE", path: "/api/users/:id/media/avatar" },
        { label: t("status.api.ep.uploadAudio"), method: "POST", path: "/api/users/:id/media/audio" },
        { label: t("status.api.ep.deleteAudio"), method: "DELETE", path: "/api/users/:id/media/audio" },
      ],
    },
    {
      key: "events",
      label: t("status.api.cat.events"),
      endpoints: [
        { label: t("status.api.ep.listEvents"), method: "GET", path: "/api/events?page=1&limit=5" },
        { label: t("status.api.ep.createEvent"), method: "POST", path: "/api/events" },
        { label: t("status.api.ep.createPollEvent"), method: "POST", path: "/api/events?fixture=poll" },
        { label: t("status.api.ep.getEvent"), method: "GET", path: "/api/events/:id?fixture=poll" },
        { label: t("status.api.ep.pollVote"), method: "POST", path: "/api/events/:id/poll/vote" },
        { label: t("status.api.ep.createRaffleEvent"), method: "POST", path: "/api/events?fixture=raffle" },
        { label: t("status.api.ep.addParticipant"), method: "POST", path: "/api/events/:id/participants?fixture=raffle" },
        { label: t("status.api.ep.raffleDraw"), method: "POST", path: "/api/events/:id/raffle/draw" },
        { label: t("status.api.ep.getEvent"), method: "GET", path: "/api/events/:id" },
        { label: t("status.api.ep.updateEvent"), method: "PATCH", path: "/api/events/:id" },
        { label: t("status.api.ep.batchEventDetails"), method: "POST", path: "/api/events/batch-details" },
        { label: t("status.api.ep.uploadEventImages"), method: "POST", path: "/api/events/:id/images" },
        { label: t("status.api.ep.getEventImage"), method: "GET", path: "/api/events/image" },
        { label: t("status.api.ep.joinEvent"), method: "POST", path: "/api/events/:id/join" },
        { label: t("status.api.ep.addParticipant"), method: "POST", path: "/api/events/:id/participants" },
        { label: t("status.api.ep.removeParticipant"), method: "DELETE", path: "/api/events/:id/participants" },
        { label: t("status.api.ep.leaveEvent"), method: "DELETE", path: "/api/events/:id/leave" },
        { label: t("status.api.ep.archiveEvent"), method: "DELETE", path: "/api/events/:id" },
        { label: t("status.api.ep.destroyEvent"), method: "DELETE", path: "/api/events/:id/destroy" },
        { label: t("status.api.ep.listTemplates"), method: "GET", path: "/api/events/templates/list" },
        { label: t("status.api.ep.createTemplate"), method: "POST", path: "/api/events/templates" },
        { label: t("status.api.ep.updateTemplate"), method: "PATCH", path: "/api/events/templates/:id" },
        { label: t("status.api.ep.pauseTemplate"), method: "POST", path: "/api/events/templates/:id/pause" },
        { label: t("status.api.ep.resumeTemplate"), method: "POST", path: "/api/events/templates/:id/resume" },
        { label: t("status.api.ep.deleteTemplate"), method: "DELETE", path: "/api/events/templates/:id" },
      ],
    },
    {
      key: "announcements",
      label: t("status.api.cat.announcements"),
      endpoints: [
        { label: t("status.api.ep.listAnnouncements"), method: "GET", path: "/api/announcements?page=1&limit=5" },
        { label: t("status.api.ep.stageAnnouncementImages"), method: "POST", path: "/api/announcements/images/stage" },
        { label: t("status.api.ep.createAnnouncement"), method: "POST", path: "/api/announcements" },
        { label: t("status.api.ep.getAnnouncement"), method: "GET", path: "/api/announcements/:id" },
        { label: t("status.api.ep.updateAnnouncement"), method: "PATCH", path: "/api/announcements/:id" },
        { label: t("status.api.ep.uploadAnnouncementImages"), method: "POST", path: "/api/announcements/:id/images" },
        { label: t("status.api.ep.getAnnouncementImage"), method: "GET", path: "/api/announcements/image" },
        { label: t("status.api.ep.archiveAnnouncement"), method: "DELETE", path: "/api/announcements/:id" },
        { label: t("status.api.ep.deleteAnnouncement"), method: "DELETE", path: "/api/announcements/:id/permanent" },
      ],
    },
    {
      key: "gallery",
      label: t("status.api.cat.gallery"),
      endpoints: [
        { label: t("status.api.ep.listGallery"), method: "GET", path: "/api/gallery?limit=5" },
        { label: t("status.api.ep.uploadGalleryImages"), method: "POST", path: "/api/gallery/images" },
        { label: t("status.api.ep.getGalleryImage"), method: "GET", path: "/api/gallery/image" },
        { label: t("status.api.ep.addVideo"), method: "POST", path: "/api/gallery/videos" },
        { label: t("status.api.ep.batchDeleteGallery"), method: "POST", path: "/api/gallery/batch-delete" },
        { label: t("status.api.ep.deleteGalleryItem"), method: "DELETE", path: "/api/gallery/:id" },
      ],
    },
    {
      key: "guildWar",
      label: t("status.api.cat.guildWar"),
      endpoints: [
        { label: t("status.api.ep.activeWar"), method: "GET", path: "/api/guild-war/active" },
        { label: t("status.api.ep.concludedEventIds"), method: "GET", path: "/api/guild-war/concluded-event-ids" },
        { label: t("status.api.ep.createEvent"), method: "POST", path: "/api/events?fixture=guild-war" },
        { label: t("status.api.ep.moveMember"), method: "POST", path: "/api/guild-war/move" },
        { label: t("status.api.ep.saveTeams"), method: "POST", path: "/api/guild-war/save-teams" },
        { label: t("status.api.ep.updateRoleTag"), method: "PATCH", path: "/api/guild-war/role-tag" },
        { label: t("status.api.ep.exportGuildWar"), method: "GET", path: "/api/guild-war/export?format=json" },
        { label: t("status.api.ep.warHistory"), method: "GET", path: "/api/guild-war/history?page=1&limit=5" },
        { label: t("status.api.ep.historyDetail"), method: "GET", path: "/api/guild-war/history/:id" },
        { label: t("status.api.ep.batchHistoryDetails"), method: "POST", path: "/api/guild-war/history/batch" },
        { label: t("status.api.ep.createHistory"), method: "POST", path: "/api/guild-war/history" },
        { label: t("status.api.ep.analytics"), method: "GET", path: "/api/guild-war/analytics" },
        { label: t("status.api.ep.concludeWar"), method: "POST", path: "/api/guild-war/conclude" },
        { label: t("status.api.ep.updateMemberStats"), method: "PATCH", path: "/api/guild-war/history/:id/member-stats/:userId" },
        { label: t("status.api.ep.batchMemberStats"), method: "PATCH", path: "/api/guild-war/history/:id/member-stats/batch" },
        { label: t("status.api.ep.updateHistory"), method: "PATCH", path: "/api/guild-war/history/:id" },
        { label: t("status.api.ep.batchDeleteHistory"), method: "POST", path: "/api/guild-war/history/batch-delete" },
        { label: t("status.api.ep.deleteHistory"), method: "DELETE", path: "/api/guild-war/history/:id" },
      ],
    },
    {
      key: "wiki",
      label: t("status.api.cat.wiki"),
      endpoints: [
        { label: t("status.api.ep.listCategories"), method: "GET", path: "/api/wiki/categories" },
        { label: t("status.api.ep.createCategory"), method: "POST", path: "/api/wiki/categories" },
        { label: t("status.api.ep.updateCategory"), method: "PATCH", path: "/api/wiki/categories/:id" },
        { label: t("status.api.ep.listArticles"), method: "GET", path: "/api/wiki/articles?page=1&limit=5" },
        { label: t("status.api.ep.createArticle"), method: "POST", path: "/api/wiki/articles" },
        { label: t("status.api.ep.getArticle"), method: "GET", path: "/api/wiki/articles/:slug" },
        { label: t("status.api.ep.updateArticle"), method: "PATCH", path: "/api/wiki/articles/:id" },
        { label: t("status.api.ep.articleRevisions"), method: "GET", path: "/api/wiki/articles/:id/revisions" },
        { label: t("status.api.ep.articleRevision"), method: "GET", path: "/api/wiki/articles/:id/revisions/1" },
        { label: t("status.api.ep.restoreArticleRevision"), method: "POST", path: "/api/wiki/articles/:id/revisions/1/restore" },
        { label: t("status.api.ep.uploadArticleImages"), method: "POST", path: "/api/wiki/articles/:id/images" },
        { label: t("status.api.ep.getWikiImage"), method: "GET", path: "/api/wiki/image" },
        { label: t("status.api.ep.archiveArticle"), method: "DELETE", path: "/api/wiki/articles/:id" },
        { label: t("status.api.ep.deleteArticle"), method: "DELETE", path: "/api/wiki/articles/:id/permanent" },
        { label: t("status.api.ep.deleteCategory"), method: "DELETE", path: "/api/wiki/categories/:id" },
      ],
    },
    {
      key: "storage",
      label: t("status.api.cat.storage"),
      endpoints: [
        { label: t("status.api.ep.storageTree"), method: "GET", path: "/api/storage" },
        { label: t("status.api.ep.createStorage"), method: "POST", path: "/api/storage/storages" },
        { label: t("status.api.ep.updateStorage"), method: "PATCH", path: "/api/storage/storages/:id" },
        { label: t("status.api.ep.createStorageCategory"), method: "POST", path: "/api/storage/storages/:storageId/categories" },
        { label: t("status.api.ep.updateStorageCategory"), method: "PATCH", path: "/api/storage/storages/:storageId/categories/:id" },
        { label: t("status.api.ep.listStorageItems"), method: "GET", path: "/api/storage/items" },
        { label: t("status.api.ep.createStorageItem"), method: "POST", path: "/api/storage/items" },
        { label: t("status.api.ep.getStorageItem"), method: "GET", path: "/api/storage/items/:id" },
        { label: t("status.api.ep.updateStorageItem"), method: "PATCH", path: "/api/storage/items/:id" },
        { label: t("status.api.ep.uploadStorageItemImages"), method: "POST", path: "/api/storage/items/:id/images" },
        { label: t("status.api.ep.getStorageImage"), method: "GET", path: "/api/storage/image" },
        { label: t("status.api.ep.deleteStorageItemImage"), method: "DELETE", path: "/api/storage/items/:id/images/:imageId" },
        { label: t("status.api.ep.storageTransactionIntake"), method: "POST", path: "/api/storage/items/:id/transactions?fixture=intake" },
        { label: t("status.api.ep.storageTransactionDistribute"), method: "POST", path: "/api/storage/items/:id/transactions?fixture=distribute" },
        { label: t("status.api.ep.storageTransactionAdjust"), method: "POST", path: "/api/storage/items/:id/transactions?fixture=adjust" },
        { label: t("status.api.ep.storageTransactionBatch"), method: "POST", path: "/api/storage/transactions/batch" },
        { label: t("status.api.ep.listStorageTransactions"), method: "GET", path: "/api/storage/transactions?page=1&limit=5" },
        { label: t("status.api.ep.deleteStorageItem"), method: "DELETE", path: "/api/storage/items/:id" },
        { label: t("status.api.ep.deleteStorageCategory"), method: "DELETE", path: "/api/storage/storages/:storageId/categories/:id" },
        { label: t("status.api.ep.deleteStorage"), method: "DELETE", path: "/api/storage/storages/:id" },
      ],
    },
    {
      key: "badges",
      label: t("status.api.cat.badges"),
      endpoints: [
        { label: t("status.api.ep.listBadges"), method: "GET", path: "/api/badges" },
        { label: t("status.api.ep.createBadge"), method: "POST", path: "/api/badges" },
        { label: t("status.api.ep.getBadge"), method: "GET", path: "/api/badges/:id" },
        { label: t("status.api.ep.updateBadge"), method: "PATCH", path: "/api/badges/:id" },
        { label: t("status.api.ep.badgeAssignments"), method: "GET", path: "/api/badges/:id/assignments" },
        { label: t("status.api.ep.assignBadge"), method: "POST", path: "/api/badges/:id/assign" },
        { label: t("status.api.ep.unassignBadge"), method: "POST", path: "/api/badges/:id/unassign" },
        { label: t("status.api.ep.deleteBadge"), method: "DELETE", path: "/api/badges/:id" },
      ],
    },
    {
      key: "classes",
      label: t("status.api.cat.classes"),
      endpoints: [
        { label: t("status.api.ep.listClasses"), method: "GET", path: "/api/classes" },
        { label: t("status.api.ep.createClass"), method: "POST", path: "/api/classes" },
        { label: t("status.api.ep.updateClass"), method: "PATCH", path: "/api/classes/:id" },
        { label: t("status.api.ep.uploadClassIcon"), method: "POST", path: "/api/classes/:id/icon" },
        { label: t("status.api.ep.getClassIcon"), method: "GET", path: "/api/classes/icon" },
        { label: t("status.api.ep.deleteClassIcon"), method: "DELETE", path: "/api/classes/:id/icon" },
        { label: t("status.api.ep.deleteClass"), method: "DELETE", path: "/api/classes/:id" },
      ],
    },
    {
      key: "adminInvites",
      label: t("status.api.cat.adminInvites"),
      endpoints: [
        { label: t("status.api.ep.listInviteLinks"), method: "GET", path: "/api/admin/invite-links" },
        { label: t("status.api.ep.inviteStats"), method: "GET", path: "/api/admin/invite-links/stats" },
        { label: t("status.api.ep.createInvite"), method: "POST", path: "/api/admin/invite-links" },
        { label: t("status.api.ep.revokeInvite"), method: "DELETE", path: "/api/admin/invite-links/:id" },
        { label: t("status.api.ep.permanentDeleteInvite"), method: "DELETE", path: "/api/admin/invite-links/:id/permanent" },
      ],
    },
    {
      key: "adminAudit",
      label: t("status.api.cat.adminAudit"),
      endpoints: [
        { label: t("status.api.ep.auditLog"), method: "GET", path: "/api/admin/audit-log?page=1&limit=5" },
        { label: t("status.api.ep.auditLogExport"), method: "GET", path: "/api/admin/audit-log/export?format=json" },
        { label: t("status.api.ep.archiveMonths"), method: "GET", path: "/api/admin/audit-archive/months" },
        { label: t("status.api.ep.archiveDownload"), method: "GET", path: "/api/admin/audit-archive/download" },
        { label: t("status.api.ep.archiveDownloadFile"), method: "GET", path: "/api/admin/audit-archive/download/file" },
      ],
    },
    {
      key: "adminUsers",
      label: t("status.api.cat.adminUsers"),
      endpoints: [
        { label: t("status.api.ep.createMember"), method: "POST", path: "/api/admin/users" },
        { label: t("status.api.ep.changeUserRole"), method: "PATCH", path: "/api/admin/users/:id/role" },
        { label: t("status.api.ep.deactivateUser"), method: "PATCH", path: "/api/admin/users/:id/deactivate" },
        { label: t("status.api.ep.reactivateUser"), method: "PATCH", path: "/api/admin/users/:id/reactivate" },
        { label: t("status.api.ep.resetPassword"), method: "POST", path: "/api/admin/users/:id/reset-password" },
        { label: t("status.api.ep.resetLoginLock"), method: "POST", path: "/api/admin/users/:id/reset-login-lock" },
        { label: t("status.api.ep.batchRoleChange"), method: "PATCH", path: "/api/admin/users/batch/role" },
        { label: t("status.api.ep.batchDeactivate"), method: "PATCH", path: "/api/admin/users/batch/deactivate" },
        { label: t("status.api.ep.batchReactivate"), method: "PATCH", path: "/api/admin/users/batch/reactivate" },
        { label: t("status.api.ep.batchDelete"), method: "PATCH", path: "/api/admin/users/batch/delete" },
      ],
    },
    {
      key: "adminRoles",
      label: t("status.api.cat.adminRoles"),
      endpoints: [
        { label: t("status.api.ep.listRoles"), method: "GET", path: "/api/admin/roles" },
        { label: t("status.api.ep.createRole"), method: "POST", path: "/api/admin/roles" },
        { label: t("status.api.ep.updateRole"), method: "PATCH", path: "/api/admin/roles/:id" },
        { label: t("status.api.ep.deleteRole"), method: "DELETE", path: "/api/admin/roles/:id" },
      ],
    },
    {
      key: "adminSiteConfig",
      label: t("status.api.cat.adminSiteConfig"),
      endpoints: [
        { label: t("status.api.ep.adminSiteConfig"), method: "GET", path: "/api/admin/site-config" },
        { label: t("status.api.ep.updateSiteConfig"), method: "PATCH", path: "/api/admin/site-config" },
        { label: t("status.api.ep.uploadSiteLogo"), method: "POST", path: "/api/admin/site-config/logo" },
        { label: t("status.api.ep.siteLogo"), method: "GET", path: "/api/site-config/logo" },
      ],
    },
    {
      key: "adminErrorLog",
      label: t("status.api.cat.adminErrorLog"),
      endpoints: [
        { label: t("status.api.ep.errorLog"), method: "GET", path: "/api/admin/error-log?page=1&limit=5" },
      ],
    },
  ];
}

export function filterApiCategoriesForPermissions(
  categories: CategoryDef[],
  permissions: Record<string, boolean> | null | undefined,
): CategoryDef[] {
  const canRunEndpoint = (endpoint: EndpointDef): boolean => {
    const requirement = permissionRequirementForEndpoint(endpoint);
    if (requirement.all.length > 0 && !requirement.all.every((permission) => permissions?.[permission] === true)) {
      return false;
    }
    return requirement.any.length === 0 || requirement.any.some((permission) => permissions?.[permission] === true);
  };

  return categories
    .map((category) => ({
      ...category,
      endpoints: category.endpoints.filter(canRunEndpoint),
    }))
    .filter((category) => category.endpoints.length > 0);
}

type EndpointPermissionRequirement = {
  all: string[];
  any: string[];
};

function requiresAll(...permissions: string[]): EndpointPermissionRequirement {
  return { all: permissions, any: [] };
}

function requiresAny(...permissions: string[]): EndpointPermissionRequirement {
  return { all: [], any: permissions };
}

function requiresStoragePermission(permission: string): EndpointPermissionRequirement {
  return requiresAny(permission, "admin.storage.manage");
}

function publicEndpoint(): EndpointPermissionRequirement {
  return { all: [], any: [] };
}

function permissionRequirementForEndpoint(endpoint: EndpointDef): EndpointPermissionRequirement {
  const key = `${endpoint.method} ${endpoint.path}`;
  if (key === "GET /api/admin/status") return requiresAll("admin.status.view");
  if (endpoint.path.startsWith("/api/admin/site-config")) return requiresAll("admin.siteConfig.manage");
  /* GET /api/classes 和 GET /api/classes/icon 本身是公开读，但它们在这里只作为
     创建-上传-删除链条的一环运行，没有管理权限时整条链都跑不起来。 */
  if (endpoint.path.startsWith("/api/classes")) return requiresAll("admin.classes.manage");
  if (endpoint.path.startsWith("/api/admin/error-log")) return requiresAll("admin.status.view");
  if (key === "GET /api/admin/analytics-settings") return requiresAll("admin.analytics.view");
  if (key === "PATCH /api/admin/analytics-settings") return requiresAll("admin.analytics.manage");
  if (endpoint.path === "/api/auth/verify-invite/:code" || endpoint.path === "/api/auth/register/:inviteCode" || endpoint.path === "/api/auth/login") return requiresAll("admin.invite.manage", "admin.users.delete");
  if (endpoint.path.startsWith("/api/admin/invite-links")) {
    return endpoint.method === "GET" ? requiresAll("admin.invite.view") : requiresAll("admin.invite.manage");
  }
  if (endpoint.path.startsWith("/api/admin/audit-log") || endpoint.path.startsWith("/api/admin/audit-archive")) {
    return endpoint.path.includes("export") || endpoint.path.includes("download") ? requiresAll("admin.audit.export") : requiresAll("admin.audit.view");
  }
  if (endpoint.path.startsWith("/api/wiki/articles") && endpoint.path.includes("/revisions")) return requiresAll("wiki.articles.edit");
  if (endpoint.path.startsWith("/api/admin/users")) {
    if (endpoint.path.includes("role")) return requiresAll("admin.users.edit", "admin.users.role", "admin.users.delete");
    if (endpoint.path.includes("deactivate") || endpoint.path.includes("reactivate")) return requiresAll("admin.users.edit", "admin.users.activate", "admin.users.delete");
    if (endpoint.path.includes("delete")) return requiresAll("admin.users.edit", "admin.users.delete");
    if (endpoint.path.includes("reset-password") || endpoint.path.includes("reset-login-lock")) return requiresAll("admin.users.edit", "admin.users.password", "admin.users.delete");
    return requiresAll("admin.users.edit", "admin.users.delete");
  }
  if (endpoint.path.startsWith("/api/admin/roles")) {
    return endpoint.method === "GET" ? requiresAny("admin.roles.view", "admin.roles.manage") : requiresAll("admin.roles.manage");
  }
  if (endpoint.path.startsWith("/api/badges")) return requiresAll("admin.badges.manage");
  if (endpoint.path.startsWith("/api/events/templates")) return requiresAll("events.templates");
  if (endpoint.path === "/api/events?fixture=poll" || endpoint.path === "/api/events?fixture=raffle") {
    return requiresAll("events.create", "events.edit", "events.archive", "events.delete");
  }
  if (endpoint.path === "/api/events/:id/participants?fixture=raffle") {
    return requiresAll("events.create", "events.edit", "events.archive", "events.delete");
  }
  if (endpoint.path === "/api/events/:id/raffle/draw") {
    return requiresAll("events.create", "events.edit", "events.archive", "events.delete");
  }
  if (endpoint.path === "/api/events?fixture=guild-war") return requiresAll("events.create", "events.archive", "events.delete", "guildwar.teams.edit", "guildwar.history.edit");
  if (endpoint.path.startsWith("/api/events")) {
    if (endpoint.method === "POST") {
      return endpoint.path.includes("batch-details") || endpoint.path.includes("/join")
        ? publicEndpoint()
        : requiresAll("events.create", "events.edit", "events.archive", "events.delete");
    }
    if (endpoint.method === "PATCH") return requiresAll("events.create", "events.edit", "events.archive", "events.delete");
    if (endpoint.method === "DELETE") {
      return endpoint.path.includes("participants") || endpoint.path.includes("leave")
        ? requiresAll("events.create", "events.edit", "events.archive", "events.delete")
        : endpoint.path.includes("destroy")
          ? requiresAll("events.delete")
          : requiresAll("events.archive");
    }
  }
  if (endpoint.path.startsWith("/api/announcements")) {
    if (endpoint.method === "POST") return requiresAll("announcements.create", "announcements.edit", "announcements.delete");
    if (endpoint.method === "PATCH") return requiresAll("announcements.create", "announcements.edit", "announcements.delete");
    if (endpoint.method === "DELETE") return endpoint.path.includes("permanent")
      ? requiresAll("announcements.delete")
      : requiresAll("announcements.archive");
  }
  if (endpoint.path.startsWith("/api/gallery")) {
    if (endpoint.path.includes("batch-delete")) return requiresAll("gallery.upload", "gallery.delete");
    if (endpoint.method === "POST" && (endpoint.path.includes("/images") || endpoint.path.includes("/videos"))) return requiresAll("gallery.upload");
    if (endpoint.method === "DELETE") return requiresAll("gallery.upload", "gallery.delete");
  }
  if (endpoint.path.startsWith("/api/guild-war/save-teams") || endpoint.path.startsWith("/api/guild-war/move") || endpoint.path.startsWith("/api/guild-war/role-tag") || endpoint.path.startsWith("/api/guild-war/conclude")) return requiresAll("events.create", "events.archive", "events.delete", "guildwar.teams.edit", "guildwar.history.edit");
  if (endpoint.path.startsWith("/api/guild-war/export")) return requiresAll("guildwar.history.edit");
  if (endpoint.path.startsWith("/api/guild-war/history")) {
    return endpoint.method === "GET" || endpoint.method === "POST" && endpoint.path.includes("/batch")
      ? publicEndpoint()
      : requiresAll("guildwar.history.edit");
  }
  if (endpoint.path.startsWith("/api/wiki/categories")) return endpoint.method === "GET" ? publicEndpoint() : requiresAll("wiki.categories.manage");
  if (endpoint.path.startsWith("/api/wiki/articles")) {
    if (endpoint.method === "POST") return requiresAll("wiki.categories.manage", "wiki.articles.create", "wiki.articles.edit", "wiki.articles.delete");
    if (endpoint.method === "PATCH") return requiresAll("wiki.categories.manage", "wiki.articles.create", "wiki.articles.edit", "wiki.articles.delete");
    if (endpoint.method === "DELETE") return endpoint.path.includes("permanent")
      ? requiresAll("wiki.articles.delete")
      : requiresAll("wiki.articles.archive");
  }
  if (endpoint.path.startsWith("/api/storage")) {
    if (endpoint.method === "GET") return publicEndpoint();
    if (endpoint.path.includes("/transactions")) return requiresStoragePermission("admin.storage.stock");
    if (endpoint.path.includes("/items")) return requiresStoragePermission("admin.storage.items");
    return requiresStoragePermission("admin.storage.structure");
  }
  return publicEndpoint();
}
