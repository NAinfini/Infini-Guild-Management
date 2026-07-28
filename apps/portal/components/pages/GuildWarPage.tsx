import { SwordsIcon } from "@portal/components/icons";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { buildEChartsTheme } from "../../theme/echarts";
import { useTheme } from "../../providers/ThemeProvider";
import { useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@mantine/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useAppError } from "../../hooks/useAppError";
import { useGuildWarData } from "../../hooks/data/useGuildWarData";
import { useExternalView } from "../../hooks/useExternalView";
import { useGuildWarDragController } from "../../hooks/guild-war/useGuildWarDragController";
import { useGuildWarHistory } from "../../hooks/guild-war/useGuildWarHistory";
import { useGuildWarMutations } from "../../hooks/guild-war/useGuildWarMutations";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { GuildWarService } from "../../services/GuildWarService";
import { fetchAllUsersListWithOptions } from "../../services/UserService";
import { queryKeys } from "../../api/query-keys";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { useGuildWarStore } from "../../stores/guildWar";
import { PageLayout } from "../layout/PageLayout";
import { PageTabPanel, PageTabs } from "../layout/PageTabs";
import { useGuildWarActiveController } from "../feature/guild-war/useGuildWarActiveController";
import { GuildWarActiveTab } from "./guild-war/GuildWarActiveTab";
import { GuildWarHistoryTabWrapper } from "./guild-war/GuildWarHistoryTabWrapper";
import { GuildWarAnalyticsTabWrapper } from "./guild-war/GuildWarAnalyticsTabWrapper";
import "./GuildWarPage.css";

export function GuildWarPage() {
  const { t } = useTranslation("guild-war");
  const guildWarSearch = useSearch({ strict: false }) as {
    tab?: "active" | "history" | "analytics";
    warName?: string;
  };
  const queryClient = useQueryClient();
  const { theme: currentTheme } = useTheme();

  useEffect(() => {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => {
        import("../feature/guild-war/GuildWarAnalyticsTab");
        import("../feature/guild-war/WarHistoryTab");
      });
    }
  }, []);

  const isExternalView = useExternalView();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const isModerator = canManagePermission(["guildwar.teams.edit"]);
  const canManageActive = isModerator && !isExternalView;
  const { showError } = useAppError();
  const chartThemeName = useMemo(() => `guild-${currentTheme}`, [currentTheme]);
  const chartThemeConfig = useMemo(() => buildEChartsTheme(currentTheme), [currentTheme]);
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
  const [debouncedHistorySearch] = useDebouncedValue(historySearch.trim(), 250);
  const setHistorySearch = useCallback((value: string) => {
    setHistorySearchValue(value);
    setHistoryPage(1);
  }, [setHistoryPage]);

  useEffect(() => {
    setHistorySearchValue(guildWarSearch.warName ?? "");
    setHistoryPage(1);
  }, [guildWarSearch.warName, setHistoryPage]);

  const initialTabKey = useMemo(() => {
    if (guildWarSearch.tab) {
      return guildWarSearch.tab;
    }
    if (guildWarSearch.warName) {
      return "history";
    }
    return undefined;
  }, [guildWarSearch.tab, guildWarSearch.warName]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor),
  );

  const {
    warEventsQuery,
    concludedEventIdsQuery,
    selectedEventDetailQuery,
    activeQuery,
    historyQuery,
    historyDetailQuery,
  } = useGuildWarData({
    selectedEventId,
    selectedHistoryId,
    historyDateFrom,
    historyDateTo,
    historySearch: debouncedHistorySearch,
    historyPage,
    historyPerPage,
  });

  const activeController = useGuildWarActiveController({
    selectedEventId,
    activeData: activeQuery.data,
    guildWarService,
    showError,
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: () => fetchAllUsersListWithOptions(),
    staleTime: 10 * 60_000,
  });

  const guildWarMutations = useGuildWarMutations({
    selectedEventId,
    selectedHistoryId: selectedHistoryId ?? "",
    historyDateFrom,
    historyDateTo,
    setSelectedHistoryId,
  });

  const guildWarHistory = useGuildWarHistory({
    historyDetailData: historyDetailQuery.data ?? null,
  });

  const guildWarDrag = useGuildWarDragController({
    activeData: activeQuery.data,
    usersData: usersQuery.data?.data,
    canManageActive,
    selectedEventId,
    activeController,
    roleTagMutation: guildWarMutations.roleTagMutation,
    guildWarService,
    showError,
  });

  const concludedEventIdSet = useMemo(
    () => new Set(concludedEventIdsQuery.data?.data ?? []),
    [concludedEventIdsQuery.data],
  );

  useEffect(() => {
    if (selectedEventId) {
      return;
    }
    const events = warEventsQuery.data?.data ?? [];
    const active = events.find((e) => !concludedEventIdSet.has(e.id));
    if (active) {
      setSelectedEventId(active.id);
    }
  }, [selectedEventId, setSelectedEventId, warEventsQuery.data, concludedEventIdSet]);

  useEffect(() => {
    if (selectedHistoryId) {
      return;
    }
    const first = historyQuery.data?.data[0];
    if (first) {
      setSelectedHistoryId(first.id);
    }
  }, [historyQuery.data, selectedHistoryId, setSelectedHistoryId]);

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

  useLoadWarningToast(
    warEventsQuery.isError ||
      selectedEventDetailQuery.isError ||
      activeQuery.isError ||
      historyQuery.isError ||
      historyDetailQuery.isError,
    t("common:loadErrorRetry"),
  );

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<SwordsIcon size={22} />} className="guild-war-page">
      <PageTabs
        keepMounted={false}
        defaultValue={initialTabKey ?? (isExternalView ? "history" : "active")}
        tabs={[
          ...(!isExternalView
            ? [
                {
                  value: "active" as const,
                  label: t("tab.active"),
                },
              ]
            : []),
          {
            value: "history" as const,
            label: t("tab.history"),
          },
          {
            value: "analytics" as const,
            label: t("tab.analytics"),
          },
        ]}
      >
        {!isExternalView ? (
          <PageTabPanel value="active" pt="sm">
            <GuildWarActiveTab
              selectedEventId={selectedEventId}
              setSelectedEventId={setSelectedEventId}
              canManageActive={canManageActive}
              activeController={activeController}
              guildWarDrag={guildWarDrag}
              guildWarHistory={guildWarHistory}
              warEventsQuery={warEventsQuery}
              concludedEventIdSet={concludedEventIdSet}
              activeQuery={activeQuery}
              sensors={sensors}
              concludeWarDisabled={concludeWarDisabled}
              concludeWarDisabledReason={concludeWarDisabledReason}
            />
          </PageTabPanel>
        ) : null}

        <PageTabPanel value="history" pt="sm">
          <GuildWarHistoryTabWrapper
            canManageActive={canManageActive}
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
            chartThemeName={chartThemeName}
            chartThemeConfig={chartThemeConfig}
            chartPalette={chartPalette}
            initialSearch={guildWarSearch.warName}
          />
        </PageTabPanel>

        <PageTabPanel value="analytics" pt="sm">
          <GuildWarAnalyticsTabWrapper
            historyQuery={historyQuery}
            chartPalette={chartPalette}
            guildWarService={guildWarService}
            chartThemeName={chartThemeName}
            chartThemeConfig={chartThemeConfig}
            canManageWeights={isModerator}
          />
        </PageTabPanel>
      </PageTabs>
    </PageLayout>
  );
}
