import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { guildWarKeyboardCoordinates } from "../feature/guild-war/guildWarDragGeometry";
import { buildEChartsTheme } from "../../theme/echarts";
import { useTheme } from "../../providers/ThemeProvider";
import { useSearch } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useAppError } from "../../hooks/useAppError";
import { useGuildWarData } from "../../hooks/data/useGuildWarData";
import { useExternalView } from "../../hooks/useExternalView";
import { useGuildWarDragController } from "../../hooks/guild-war/useGuildWarDragController";
import { useGuildWarHistory } from "../../hooks/guild-war/useGuildWarHistory";
import { useGuildWarMutations } from "../../hooks/guild-war/useGuildWarMutations";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { GuildWarService, isApiRequestError } from "../../services/GuildWarService";
import { fetchAllUsersListWithOptions } from "../../services/UserService";
import { queryKeys } from "../../api/query-keys";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { useGuildWarStore } from "../../stores/guildWar";
import { useAuthStore } from "../../stores/auth";
import { viewerIdentity } from "../../session-storage";
import { PageLayout } from "../layout/PageLayout";
import { PageSubnav } from "../shared/PageSubnav";
import { useGuildWarActiveController } from "../feature/guild-war/useGuildWarActiveController";
import { GuildWarActiveTab } from "./guild-war/GuildWarActiveTab";
import { GuildWarHistoryTabWrapper } from "./guild-war/GuildWarHistoryTabWrapper";
import { GuildWarAnalyticsTabWrapper } from "./guild-war/GuildWarAnalyticsTabWrapper";
import "./GuildWarPage.css";

export type GuildWarTab = "active" | "history" | "analytics";

type GuildWarRouteSearch = {
  tab?: GuildWarTab;
  warName?: string;
  [key: string]: unknown;
};

type GuildWarTabResolution = {
  activeTab: GuildWarTab;
  replacementTab: GuildWarTab | null;
};

type GuildWarActiveAvailability = "loading" | "available" | "empty";

export function resolveGuildWarManagementPermissions(
  permissions: {
    teamsEdit: boolean;
    historyEdit: boolean;
    eventsEdit: boolean;
  },
  isExternalView: boolean,
) {
  if (isExternalView) {
    return {
      canManageActive: false,
      canManageHistory: false,
      canRemoveParticipants: false,
    };
  }
  return {
    canManageActive: permissions.teamsEdit,
    canManageHistory: permissions.historyEdit,
    canRemoveParticipants: permissions.teamsEdit && permissions.eventsEdit,
  };
}

export function resolveGuildWarTab(
  search: Pick<GuildWarRouteSearch, "tab" | "warName">,
  isExternalView: boolean,
  activeAvailability: GuildWarActiveAvailability = "available",
): GuildWarTabResolution {
  const firstVisibleTab: GuildWarTab = isExternalView ? "history" : "active";
  const visibleTabs: GuildWarTab[] = isExternalView
    ? ["history", "analytics"]
    : ["active", "history", "analytics"];
  const hasExplicitTab = search.tab !== undefined;
  const hasExplicitWarName = search.warName !== undefined;
  const shouldDefaultToHistory = !isExternalView
    && activeAvailability === "empty"
    && !hasExplicitTab
    && !hasExplicitWarName;
  const requestedTab = search.tab
    ?? (hasExplicitWarName || shouldDefaultToHistory ? "history" : firstVisibleTab);
  const activeTab = visibleTabs.includes(requestedTab)
    ? requestedTab
    : firstVisibleTab;
  const shouldNormalizeExplicitTab = hasExplicitTab && search.tab !== activeTab;

  return {
    activeTab,
    replacementTab: shouldNormalizeExplicitTab || shouldDefaultToHistory
      ? activeTab
      : null,
  };
}

export function buildGuildWarTabSearch(
  previous: GuildWarRouteSearch,
  tab: GuildWarTab,
): GuildWarRouteSearch {
  return {
    ...previous,
    tab,
    ...(tab === "active" ? { warName: undefined } : {}),
  };
}

export function resolveGuildWarHistorySelection(
  rows: readonly Readonly<{ id: string }>[],
  selectedId: string | null,
  excludedId: string | null,
): string | null {
  if (selectedId && selectedId !== excludedId && rows.some(({ id }) => id === selectedId)) {
    return selectedId;
  }
  return rows.find(({ id }) => id !== excludedId)?.id ?? null;
}

export function isMissingGuildWarHistoryDetail(error: unknown): boolean {
  return isApiRequestError(error) && error.status === 404;
}

export function GuildWarPage() {
  const { t } = useTranslation("guild-war");
  const guildWarSearch = useSearch({ strict: false }) as GuildWarRouteSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme: currentTheme, accent } = useTheme();

  useEffect(() => {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => {
        import("../feature/guild-war/GuildWarAnalyticsTab");
        import("../feature/guild-war/WarHistoryTab");
      });
    }
  }, []);

  const isExternalView = useExternalView();
  const sessionUserId = useAuthStore((state) => state.user?.id);
  const publicMemberProjection = isExternalView || !sessionUserId;
  const { canManage: canManagePermission } = useEffectivePermissions();
  const {
    canManageActive,
    canManageHistory,
    canRemoveParticipants,
  } = resolveGuildWarManagementPermissions({
    teamsEdit: canManagePermission(["guildwar.teams.edit"]),
    historyEdit: canManagePermission(["guildwar.history.edit"]),
    eventsEdit: canManagePermission(["events.edit"]),
  }, isExternalView);
  const canManageAnalyticsSettings = canManagePermission(["admin.analytics.manage"])
    && !isExternalView;
  const canViewMemberNotes = canManagePermission(["admin.users.view"]) && !isExternalView;
  const canCreateWarEvent = canManagePermission(["events.create"]) && !isExternalView;
  const { showError } = useAppError();
  /* 主题名要带上主色：ECharts 的 registerTheme 按名字缓存，同名不会重新读配置。
     只用 currentTheme 的话，换主色后图表会一直用注册时那一套颜色。 */
  const chartThemeName = useMemo(() => `guild-${currentTheme}-${accent}`, [accent, currentTheme]);
  const chartThemeConfig = useMemo(
    () => buildEChartsTheme(currentTheme),
    /* accent 不出现在函数签名里——它通过 <html data-accent> 影响计算值，
       依赖数组必须显式列出，否则换主色时不会重建。 */
    [accent, currentTheme],
  );
  const chartPalette = chartThemeConfig.color;
  const guildWarService = useMemo(
    () =>
      new GuildWarService({
        queryClient,
      }),
    [queryClient],
  );

  const {
    selectedEventId,
    setSelectedEventId,
    selectedHistoryId,
    setSelectedHistoryId,
    historyViewMode,
    setHistoryViewMode,
    historyChartMetric,
    setHistoryChartMetric,
    historyDateFrom,
    setHistoryDateFrom,
    historyDateTo,
    setHistoryDateTo,
    historyPage,
    setHistoryPage,
    historyPerPage,
    setHistoryPerPage,
  } = useGuildWarStore(
    useShallow((s) => ({
      selectedEventId: s.selectedEventId,
      setSelectedEventId: s.setSelectedEventId,
      selectedHistoryId: s.selectedHistoryId,
      setSelectedHistoryId: s.setSelectedHistoryId,
      historyViewMode: s.historyViewMode,
      setHistoryViewMode: s.setHistoryViewMode,
      historyChartMetric: s.historyChartMetric,
      setHistoryChartMetric: s.setHistoryChartMetric,
      historyDateFrom: s.historyDateFrom,
      setHistoryDateFrom: s.setHistoryDateFrom,
      historyDateTo: s.historyDateTo,
      setHistoryDateTo: s.setHistoryDateTo,
      historyPage: s.historyPage,
      setHistoryPage: s.setHistoryPage,
      historyPerPage: s.historyPerPage,
      setHistoryPerPage: s.setHistoryPerPage,
    })),
  );
  const [historySearch, setHistorySearchValue] = useState(guildWarSearch.warName ?? "");
  const missingHistoryIdRef = useRef<string | null>(null);
  const debouncedHistorySearch = useDebouncedValue(historySearch.trim(), 250);
  const setHistorySearch = useCallback((value: string) => {
    setHistorySearchValue(value);
    setHistoryPage(1);
  }, [setHistoryPage]);

  useEffect(() => {
    setHistorySearchValue(guildWarSearch.warName ?? "");
    setHistoryPage(1);
  }, [guildWarSearch.warName, setHistoryPage]);

  const setGuildWarTab = useCallback((tab: GuildWarTab) => {
    void navigate({
      to: "/guild-war",
      search: (previous) => buildGuildWarTabSearch(previous as GuildWarRouteSearch, tab),
      replace: true,
      viewTransition: false,
    });
  }, [navigate]);

  const openEventsPage = useCallback(() => {
    void navigate({ to: "/events", viewTransition: false });
  }, [navigate]);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 180,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: guildWarKeyboardCoordinates,
    }),
  );
  const requestedTab = resolveGuildWarTab(guildWarSearch, isExternalView).activeTab;

  const {
    warEventsQuery,
    concludedEventIdsQuery,
    activeEligibilityReady,
    eligibleWarEvents,
    activeSelectedEventId,
    activeQuery,
    historyQuery,
    historyDetailQuery,
  } = useGuildWarData({
    tab: requestedTab,
    selectedEventId,
    selectedHistoryId,
    historyDateFrom,
    historyDateTo,
    historySearch: debouncedHistorySearch,
    historyPage,
    historyPerPage,
  });
  const historyDetailMissing = isMissingGuildWarHistoryDetail(historyDetailQuery.error);

  const activeAvailability: GuildWarActiveAvailability = !activeEligibilityReady
    ? "loading"
    : eligibleWarEvents.length > 0
      ? "available"
      : "empty";
  const tabResolution = useMemo(
    () => resolveGuildWarTab(guildWarSearch, isExternalView, activeAvailability),
    [activeAvailability, guildWarSearch, isExternalView],
  );
  const activeTab = tabResolution.activeTab;

  useEffect(() => {
    if (tabResolution.replacementTab) {
      setGuildWarTab(tabResolution.replacementTab);
    }
  }, [setGuildWarTab, tabResolution.replacementTab]);

  const activeController = useGuildWarActiveController({
    selectedEventId: activeSelectedEventId,
    activeData: activeQuery.data,
    guildWarService,
    showError,
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.users.directory(
      viewerIdentity(sessionUserId),
      publicMemberProjection ? "public" : "internal",
    ),
    queryFn: () => fetchAllUsersListWithOptions({ externalView: publicMemberProjection }),
    enabled: activeTab === "active",
    staleTime: 10 * 60_000,
  });

  const guildWarMutations = useGuildWarMutations({
    selectedEventId: activeSelectedEventId,
    selectedHistoryId: selectedHistoryId ?? "",
    setSelectedHistoryId,
  });

  const guildWarHistory = useGuildWarHistory({
    historyDetailData: historyDetailQuery.data ?? null,
  });

  const guildWarDrag = useGuildWarDragController({
    activeData: activeQuery.data,
    usersData: usersQuery.data?.data,
    canManageActive,
    canRemoveParticipants,
    selectedEventId: activeSelectedEventId,
    activeController,
    roleTagMutation: guildWarMutations.roleTagMutation,
    guildWarService,
    showError,
  });

  useEffect(() => {
    if (activeTab !== "active") return;
    if (!activeEligibilityReady) return;
    if (activeSelectedEventId) return;
    const nextEventId = eligibleWarEvents[0]?.id;
    if (selectedEventId !== nextEventId) {
      setSelectedEventId(nextEventId);
    }
  }, [
    activeEligibilityReady,
    activeSelectedEventId,
    activeTab,
    eligibleWarEvents,
    selectedEventId,
    setSelectedEventId,
  ]);

  useEffect(() => {
    if (activeTab !== "history") return;
    if (!historyDetailMissing || !selectedHistoryId) return;
    missingHistoryIdRef.current = selectedHistoryId;
    setSelectedHistoryId(null);
    void queryClient.invalidateQueries({ queryKey: queryKeys.guildWar.historyAll() });
  }, [activeTab, historyDetailMissing, queryClient, selectedHistoryId, setSelectedHistoryId]);

  useEffect(() => {
    if (activeTab !== "history") return;
    if (historyQuery.isFetching) return;
    const rows = historyQuery.data?.data ?? [];
    const missingId = missingHistoryIdRef.current;
    if (missingId && !rows.some(({ id }) => id === missingId)) {
      missingHistoryIdRef.current = null;
    }
    const nextId = resolveGuildWarHistorySelection(
      rows,
      selectedHistoryId,
      missingHistoryIdRef.current,
    );
    if (selectedHistoryId !== nextId) setSelectedHistoryId(nextId);
  }, [activeTab, historyQuery.data, historyQuery.isFetching, selectedHistoryId, setSelectedHistoryId]);

  const concludeWarDisabled = useMemo(() => {
    const activeData = activeQuery.data;
    if (!activeData) return true;
    if (activeData.war_history?.result) return true;
    const hasTeamMembers = activeData.teams.some((team) => team.members.length > 0);
    return !hasTeamMembers;
  }, [activeQuery.data]);

  const concludeWarDisabledReason = useMemo(() => {
    const activeData = activeQuery.data;
    if (!activeData) return t("message.concludeNoData");
    if (activeData.war_history?.result) return t("message.concludeAlreadyConcluded");
    const hasTeamMembers = activeData.teams.some((team) => team.members.length > 0);
    if (!hasTeamMembers) return t("message.concludeNoTeamMembers");
    return undefined;
  }, [activeQuery.data, t]);

  const currentTabLoadError = activeTab === "active"
    ? warEventsQuery.isError || concludedEventIdsQuery.isError || usersQuery.isError || activeQuery.isError
    : historyQuery.isError || (activeTab === "history" && historyDetailQuery.isError && !historyDetailMissing);
  useLoadWarningToast(
    currentTabLoadError,
    t("common:loadErrorRetry"),
  );

  return (
    <PageLayout
      className="guild-war-page"
      workspaceMode={activeTab === "analytics" ? "scroll" : "contained"}
      toolbar={(
        <PageSubnav
          value={activeTab}
          label={t("navigation.section")}
          items={[
            ...(!isExternalView ? [{ value: "active" as const, label: t("tab.active") }] : []),
            { value: "history", label: t("tab.history") },
            { value: "analytics", label: t("tab.analytics") },
          ]}
          onChange={setGuildWarTab}
        />
      )}
    >
      <div className="guild-war-page__workspace">
        {!isExternalView && activeTab === "active" ? (
          /* --fill：作战板要顶到内容区底边，池子固定、队伍区自己滚，高度从外层 flex 链上要。 */
          <div className="guild-war-page__panel guild-war-page__panel--fill">
            <GuildWarActiveTab
              selectedEventId={activeSelectedEventId}
              setSelectedEventId={setSelectedEventId}
              canManageActive={canManageActive}
              canRemoveParticipants={canRemoveParticipants}
              canViewMemberNotes={canViewMemberNotes}
              activeController={activeController}
              guildWarDrag={guildWarDrag}
              eligibleWarEvents={eligibleWarEvents}
              activeEligibilityReady={activeEligibilityReady}
              canCreateWarEvent={canCreateWarEvent}
              onCreateWarEvent={openEventsPage}
              onViewHistory={() => setGuildWarTab("history")}
              activeQuery={activeQuery}
              sensors={sensors}
              concludeWarDisabled={concludeWarDisabled}
              concludeWarDisabledReason={concludeWarDisabledReason}
              usersData={usersQuery.data?.data ?? []}
            />
          </div>
        ) : null}

        {/* --fill：这一个页签是主从工作台，两栏各自内滚，高度从外层 flex 链上要。 */}
        {activeTab === "history" ? (
        <div className="guild-war-page__panel guild-war-page__panel--fill">
          <GuildWarHistoryTabWrapper
            canManageHistory={canManageHistory}
            historyViewMode={historyViewMode}
            setHistoryViewMode={setHistoryViewMode}
            historyChartMetric={historyChartMetric}
            setHistoryChartMetric={setHistoryChartMetric}
            historyDateFrom={historyDateFrom}
            setHistoryDateFrom={setHistoryDateFrom}
            historyDateTo={historyDateTo}
            setHistoryDateTo={setHistoryDateTo}
            historySearch={historySearch}
            setHistorySearch={setHistorySearch}
            historyPage={historyPage}
            setHistoryPage={setHistoryPage}
            historyPerPage={historyPerPage}
            setHistoryPerPage={setHistoryPerPage}
            setSelectedHistoryId={setSelectedHistoryId}
            guildWarHistory={guildWarHistory}
            guildWarMutations={guildWarMutations}
            historyQuery={historyQuery}
            historyDetailQuery={historyDetailQuery}
            historyDetailMissing={historyDetailMissing}
            chartThemeName={chartThemeName}
            chartThemeConfig={chartThemeConfig}
            chartPalette={chartPalette}
            initialSearch={guildWarSearch.warName}
          />
        </div>
        ) : null}

        {activeTab === "analytics" ? (
        <div className="guild-war-page__panel">
          <GuildWarAnalyticsTabWrapper
            historyQuery={historyQuery}
            chartPalette={chartPalette}
            guildWarService={guildWarService}
            chartThemeName={chartThemeName}
            chartThemeConfig={chartThemeConfig}
            canManageWeights={canManageAnalyticsSettings}
          />
        </div>
        ) : null}
      </div>
    </PageLayout>
  );
}
