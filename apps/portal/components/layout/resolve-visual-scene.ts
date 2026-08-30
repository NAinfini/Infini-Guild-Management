import type { VisualPageSceneId } from "../../visual/themes";
import type { AdminContextTab } from "./admin-context-nav";

const ADMIN_SCENE_BY_TAB: Readonly<Record<AdminContextTab, VisualPageSceneId>> = {
  member: "admin",
  invite: "admin-invite",
  roles: "admin-roles",
  classes: "admin-classes",
  badges: "admin-badges",
  siteConfig: "admin-site-config",
  importantNotices: "admin-important-notices",
  operations: "admin-operations",
  diagnostics: "admin-diagnostics",
  audit: "admin-audit",
};

type VisualSceneContext = Readonly<{
  baseScene?: VisualPageSceneId;
  pathname: string;
  searchStr: string;
  adminTab: AdminContextTab;
  isExternalView: boolean;
}>;

export function resolveVisualPageScene({
  baseScene,
  pathname,
  searchStr,
  adminTab,
  isExternalView,
}: VisualSceneContext): VisualPageSceneId | undefined {
  if (!baseScene) return undefined;

  if (baseScene === "events" && (
    pathname === "/events/recurring" || pathname.startsWith("/events/recurring/")
  )) {
    return "events-recurring";
  }

  const search = new URLSearchParams(searchStr);
  if (baseScene === "guild-war") {
    const tab = search.get("tab");
    if (tab === "analytics") return "guild-war-analytics";
    if (tab === "history" || search.has("warName") || (tab === null && isExternalView)) {
      return "guild-war-history";
    }
    return "guild-war";
  }

  if (baseScene === "profile") {
    const tab = search.get("tab");
    if (tab === "availability") return "profile-availability";
    if (tab === "account") return "profile-account";
    return "profile";
  }

  if (baseScene === "admin") return ADMIN_SCENE_BY_TAB[adminTab];
  return baseScene;
}
