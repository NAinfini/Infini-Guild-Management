import { hasRoleAtLeast } from "@guild/shared";
import { IconSwords, IconX } from "@tabler/icons-react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { buildEChartsTheme } from "@infini-dev-kit/frontend/theme/echarts/echarts-adapter";
import { useThemeSnapshot } from "@infini-dev-kit/frontend/provider";
import { Alert, Button, Card, Group, Loader, Stack, Tabs, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { type ContextMenuItemOptions, useContextMenu } from "mantine-contextmenu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppError } from "../../hooks/useAppError";
import { useGuildWarData } from "../../hooks/data/useGuildWarData";
import { useExternalView } from "../../hooks/useExternalView";
import { useGuildWarAnalytics } from "../../hooks/guild-war/useGuildWarAnalytics";
import { useGuildWarDragController } from "../../hooks/guild-war/useGuildWarDragController";
import { useGuildWarHistory } from "../../hooks/guild-war/useGuildWarHistory";
import { useGuildWarMutations } from "../../hooks/guild-war/useGuildWarMutations";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { GuildWarService, moveGuildWarMember } from "../../services/GuildWarService";
import { queryKeys } from "../../services/PortalQueryKeys";
import { fetchUsersList } from "../../services/UserService";
import { useAuthStore } from "../../stores/auth";
import { useGuildWarStore } from "../../stores/guildWar";
import { PageLayout } from "../layout/PageLayout";
import { useGuildWarActiveController } from "../feature/guild-war/useGuildWarActiveController";
import "./GuildWarPage.css";

const LazyGuildWarAnalyticsTab = lazy(() =>
  import("../feature/guild-war/GuildWarAnalyticsTab").then((mod) => ({ default: mod.GuildWarAnalyticsTab })),
);
const LazyWarHistoryTab = lazy(() =>
  import("../feature/guild-war/WarHistoryTab").then((mod) => ({ default: mod.WarHistoryTab })),
);
const LazyWarMemberDetailModal = lazy(() =>
  import("../feature/guild-war/WarMemberDetailModal").then((mod) => ({ default: mod.WarMemberDetailModal })),
);
const LazyGuildWarActiveTopCard = lazy(() =>
  import("../feature/guild-war/GuildWarActiveTopCard").then((mod) => ({ default: mod.GuildWarActiveTopCard })),
);
const LazyGuildWarDragBoard = lazy(() =>
  import("../feature/guild-war/GuildWarDragBoard").then((mod) => ({ default: mod.GuildWarDragBoard })),
);

type TabItem = {
  key: string;
  label: ReactNode;
  children: ReactNode;
};

type PageTabsProps = {
  items: TabItem[];
  destroyInactiveTabPane?: boolean;
  initialActiveKey?: string;
};

const message = {
  success: (content: string) => notifications.show({ color: "infini-success", message: content }),
};

function Spin() {
  return (
    <Group justify="center" py="sm">
      <Loader size="sm" />
    </Group>
  );
}

function Space({
  direction = "horizontal",
  style,
  size,
  children,
}: {
  direction?: "horizontal" | "vertical";
  style?: CSSProperties;
  size?: number;
  children: ReactNode;
}) {
  if (direction === "vertical") {
    return (
      <Stack gap={size} style={style}>
        {children}
      </Stack>
    );
  }

  return (
    <Group gap={size} style={style}>
      {children}
    </Group>
  );
}

function PageTabs({ items, destroyInactiveTabPane = false, initialActiveKey }: PageTabsProps) {
  const [activeKey, setActiveKey] = useState<string | null>(initialActiveKey ?? items[0]?.key ?? null);

  useEffect(() => {
    if (!initialActiveKey) {
      return;
    }
    if (!items.some((item) => item.key === initialActiveKey)) {
      return;
    }
    setActiveKey((current) => (current === initialActiveKey ? current : initialActiveKey));
  }, [initialActiveKey, items]);

  useEffect(() => {
    if (activeKey && items.some((item) => item.key === activeKey)) {
      return;
    }
    setActiveKey(items[0]?.key ?? null);
  }, [activeKey, items]);

  if (!activeKey) {
    return null;
  }

  return (
    <Tabs value={activeKey} onChange={setActiveKey} keepMounted={!destroyInactiveTabPane}>
      <Tabs.List>
        {items.map((item) => (
          <Tabs.Tab key={item.key} value={item.key}>
            {item.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {items.map((item) => (
        <Tabs.Panel key={item.key} value={item.key} pt="sm">
          {item.children}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

function sectionHeading(text: string) {
  return (
    <h3 className="guild-war-section-heading">
      {text}
    </h3>
  );
}

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export function GuildWarPage() {
  const { t } = useTranslation("guild-war");
  const guildWarSearch = useSearch({ strict: false }) as {
    tab?: "active" | "history" | "analytics";
    warName?: string;
  };
  const queryClient = useQueryClient();
  const themeSnapshot = useThemeSnapshot();
  const user = useAuthStore((state) => state.user);
  const isExternalView = useExternalView();
  const isModerator = Boolean(user && hasRoleAtLeast(user.role, "moderator"));
  const canManageActive = isModerator && !isExternalView;
  const { showError } = useAppError();
  const chartThemeName = useMemo(() => `infini-kit-${themeSnapshot.state.themeId}`, [themeSnapshot.state.themeId]);
  const chartThemeConfig = useMemo(() => buildEChartsTheme(themeSnapshot.state.themeId), [themeSnapshot.state.themeId]);
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
    selectedTemplateId,
    setSelectedTemplateId,
    templateName,
    setTemplateName,
    templateDescription,
    setTemplateDescription,
    historyViewMode,
    setHistoryViewMode,
    historyChartMetric,
    setHistoryChartMetric,
    historyDateFrom,
    setHistoryDateFrom,
    historyDateTo,
    setHistoryDateTo,
  } = useGuildWarStore();

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
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    echarts.registerTheme(chartThemeName, chartThemeConfig);
  }, [chartThemeConfig, chartThemeName]);

  const {
    warEventsQuery,
    selectedEventDetailQuery,
    activeQuery,
    templatesQuery,
    historyQuery,
    historyDetailQuery,
  } = useGuildWarData({
    selectedEventId,
    selectedHistoryId,
    historyDateFrom,
    historyDateTo,
  });

  const activeController = useGuildWarActiveController({
    selectedEventId,
    activeData: activeQuery.data,
    guildWarService,
    showError,
  });

  const { showContextMenu } = useContextMenu();

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsersList,
  });

  useEffect(() => {
    if (selectedEventId) {
      return;
    }
    const first = warEventsQuery.data?.data[0];
    if (first) {
      setSelectedEventId(first.id);
    }
  }, [selectedEventId, setSelectedEventId, warEventsQuery.data]);

  useEffect(() => {
    if (selectedHistoryId) {
      return;
    }
    const first = historyQuery.data?.data[0];
    if (first) {
      setSelectedHistoryId(first.id);
    }
  }, [historyQuery.data, selectedHistoryId, setSelectedHistoryId]);

  useEffect(() => {
    const templates = templatesQuery.data ?? [];
    if (templates.length === 0) {
      if (selectedTemplateId) {
        setSelectedTemplateId("");
      }
      return;
    }
    if (!selectedTemplateId || !templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0]?.id ?? "");
    }
  }, [selectedTemplateId, setSelectedTemplateId, templatesQuery.data]);

  const guildWarMutations = useGuildWarMutations({
    selectedEventId,
    selectedHistoryId: selectedHistoryId ?? "",
    selectedTemplateId,
    templateName,
    templateDescription,
    historyDateFrom,
    historyDateTo,
    setTemplateName,
    setTemplateDescription,
    setSelectedTemplateId,
    setSelectedHistoryId,
  });

  const guildWarHistory = useGuildWarHistory({
    historyDetailData: historyDetailQuery.data ?? null,
    templatesData: templatesQuery.data ?? [],
    canManageActive,
    selectedEventId,
    createTemplatePending: guildWarMutations.createTemplateMutation.isPending,
    applyTemplatePending: guildWarMutations.applyTemplateMutation.isPending,
    deleteTemplatePending: guildWarMutations.deleteTemplateMutation.isPending,
  });

  const guildWarAnalytics = useGuildWarAnalytics({
    historyRows: historyQuery.data?.data ?? [],
    chartPalette,
    guildWarService,
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

  const handleTeamContextMenu = useCallback((containerId: string, event: ReactMouseEvent<HTMLDivElement>) => {
    const items: ContextMenuItemOptions[] = [
      {
        key: "team-select-all",
        onClick: () => guildWarDrag.handleTeamSelectAll(containerId),
        title: t("menu.team.selectAll"),
      },
      {
        key: "team-clear",
        onClick: () => guildWarDrag.handleTeamClear(containerId),
        title: t("menu.team.clear"),
      },
      {
        key: "team-duplicate",
        onClick: () => guildWarDrag.handleTeamDuplicate(containerId),
        title: t("menu.team.duplicate"),
      },
      { key: "divider-team-swap" },
      {
        key: "team-swap-label",
        className: "infini-menu-item--label",
        disabled: true,
        onClick: () => {},
        title: t("menu.team.swapWith"),
      },
      ...guildWarDrag.orderedTeams
        .filter((team) => team.id !== containerId)
        .map((team) => ({
          key: `team-swap-${team.id}`,
          onClick: () => guildWarDrag.handleTeamSwap(containerId, team.id),
          title: guildWarDrag.teamDraftNames[team.id] || team.team_name || `Team ${team.id}`,
        } satisfies ContextMenuItemOptions)),
    ];

    showContextMenu(items)(event);
  }, [guildWarDrag, showContextMenu, t]);

  const handleMemberContextMenu = useCallback((userId: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    const items: ContextMenuItemOptions[] = [
      {
        key: "member-pin-to-top",
        onClick: () => guildWarDrag.handleMemberPinToTop(userId),
        title: t("menu.member.pinToTop"),
      },
      { key: "divider-member-swap" },
      {
        key: "member-swap-label",
        className: "infini-menu-item--label",
        disabled: true,
        onClick: () => {},
        title: t("menu.member.swapWith"),
      },
      ...guildWarDrag.allTeamMembers
        .filter((member) => member.user_id !== userId)
        .slice(0, 10)
        .map((member) => ({
          key: `member-swap-${member.user_id}`,
          onClick: () => guildWarDrag.handleMemberSwap(userId, member.user_id),
          title: guildWarDrag.userDataMap.get(member.user_id)?.username ?? member.user_id,
        } satisfies ContextMenuItemOptions)),
      { key: "divider-member-actions" },
      {
        key: "member-set-captain",
        onClick: () => guildWarDrag.handleSetCaptain(userId),
        title: t("menu.member.setCaptain"),
      },
      {
        key: "member-remove-captain",
        onClick: () => guildWarDrag.handleRemoveCaptain(userId),
        title: t("menu.member.removeCaptain"),
      },
      {
        key: "member-view-history",
        onClick: () => guildWarDrag.handleViewHistory(userId),
        title: t("menu.member.viewHistory"),
      },
      {
        key: "member-manage-tags",
        onClick: () => guildWarDrag.handleManageTags(userId),
        title: t("menu.member.manageTags"),
      },
      {
        key: "member-view-details",
        onClick: () => activeController.setActiveDetailUserId(userId),
        title: t("menu.member.viewDetails"),
      },
    ];

    showContextMenu(items)(event);
  }, [activeController, guildWarDrag, showContextMenu, t]);

  const handlePoolContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    showContextMenu([
      {
        key: "pool-add-member",
        onClick: () => {},
        title: t("menu.pool.addMember"),
      },
    ])(event);
  }, [showContextMenu, t]);

  const templateActionDisabled =
    !canManageActive ||
    !selectedEventId ||
    guildWarMutations.createTemplateMutation.isPending ||
    guildWarMutations.applyTemplateMutation.isPending ||
    guildWarMutations.deleteTemplateMutation.isPending;

  useEffect(() => {
    if (!activeController.undoMove || activeController.undoRemainingSec > 0) {
      return;
    }
    const pendingMove = activeController.undoMove;
    activeController.setUndoMove(null);
    const commitQueuedMoves = async () => {
      try {
        for (const [index, move] of pendingMove.moves.entries()) {
          await moveGuildWarMember({
            event_id: pendingMove.eventId,
            user_id: move.userId,
            to: move.to,
            etag: index === 0 ? pendingMove.etag ?? activeQuery.data?.etag ?? undefined : undefined,
          });
        }
        await queryClient.invalidateQueries({
          queryKey: queryKeys.guildWar.active(selectedEventId ?? "none"),
        });
        message.success(
          pendingMove.moves.length === 1
            ? t("message.memberMoved")
            : t("message.membersMoved", { count: pendingMove.moves.length }),
        );
      } catch (error) {
        showError(
          error,
          pendingMove.moves.length > 1 ? t("message.batchMoveCommitFailed") : t("message.memberMoveFailed"),
        );
      }
    };
    void commitQueuedMoves();
  }, [
    activeController,
    activeQuery.data?.etag,
    queryClient,
    selectedEventId,
    showError,
    t,
  ]);

  useLoadWarningToast(
    warEventsQuery.isError ||
      selectedEventDetailQuery.isError ||
      activeQuery.isError ||
      templatesQuery.isError ||
      historyQuery.isError ||
      historyDetailQuery.isError ||
      guildWarAnalytics.analyticsQuery.isError ||
      guildWarAnalytics.analyticsDetailsQuery.isError,
    t("common:loadErrorRetry"),
  );

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<IconSwords size={22} />} className="guild-war-page">
      <PageTabs
        destroyInactiveTabPane
        initialActiveKey={initialTabKey}
        items={[
          ...(!isExternalView
            ? [
                {
                  key: "active",
                  label: t("tab.active"),
                  children: (
                    <Space direction="vertical" style={{ display: "flex" }} size={12}>
                      <Suspense fallback={<Card><Spin /></Card>}>
                        <LazyGuildWarActiveTopCard
                          selectedEventId={selectedEventId}
                          eventOptions={(warEventsQuery.data?.data ?? []).map((item) => ({
                            value: item.id,
                            label: `${item.title} (${guildWarHistory.formatDateTime(item.start_at)})`,
                          }))}
                          eventPlaceholder={t("active.event")}
                          onSelectedEventIdChange={setSelectedEventId}
                          canManage={canManageActive}
                          activeSearch={activeController.activeSearch}
                          onActiveSearchChange={activeController.setActiveSearch}
                          matchLabel={
                            guildWarDrag.matchedItemIds.length === 0
                              ? t("active.noMatches")
                              : t("active.matchLabel", {
                                  current: guildWarDrag.activeMatchIndex + 1,
                                  total: guildWarDrag.matchedItemIds.length,
                                })
                          }
                          onPrevMatch={() => activeController.setSearchJumpIndex((current) => current - 1)}
                          onNextMatch={() => activeController.setSearchJumpIndex((current) => current + 1)}
                          hasMatches={guildWarDrag.matchedItemIds.length > 0}
                          searchPlaceholder={t("active.searchPlaceholder")}
                          selectedTemplateId={selectedTemplateId}
                          templateOptions={guildWarHistory.templateOptions}
                          templatePlaceholder={t("active.template.placeholder")}
                          templateName={templateName}
                          templateNamePlaceholder={t("active.template.name")}
                          onTemplateNameChange={setTemplateName}
                          templateDescription={templateDescription}
                          templateDescriptionPlaceholder={t("active.template.description")}
                          onTemplateDescriptionChange={setTemplateDescription}
                          onSelectedTemplateIdChange={(value) => {
                            setSelectedTemplateId(value);
                            const selectedTemplate = (templatesQuery.data ?? []).find((template) => template.id === value);
                            if (!selectedTemplate) {
                              return;
                            }
                            setTemplateName(selectedTemplate.template_name);
                            setTemplateDescription(selectedTemplate.description ?? "");
                          }}
                          onSaveTemplate={() => guildWarMutations.createTemplateMutation.mutate()}
                          onApplyTemplate={() => guildWarMutations.applyTemplateMutation.mutate()}
                          onDeleteTemplate={() => guildWarMutations.deleteTemplateMutation.mutate()}
                          saveTemplateLabel={t("active.template.save")}
                          applyTemplateLabel={t("active.template.apply")}
                          deleteTemplateLabel={t("active.template.delete")}
                          templateSavePending={guildWarMutations.createTemplateMutation.isPending}
                          templateApplyPending={guildWarMutations.applyTemplateMutation.isPending}
                          templateDeletePending={guildWarMutations.deleteTemplateMutation.isPending}
                          templateActionDisabled={templateActionDisabled}
                          isTeamsDirty={activeController.isTeamsDirty}
                          saveTeamsPending={activeController.saveTeamsPending}
                          onSaveTeams={activeController.handleSaveTeams}
                          saveTeamsLabel={t("active.saveTeams")}
                          unsavedLabel={t("active.unsaved")}
                        />
                      </Suspense>

                      {activeController.undoMove && activeController.undoRemainingSec > 0 ? (
                        <Alert color="infini-primary" variant="light">
                          <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                            <Text size="sm">
                              {activeController.undoMove.moves.length === 1
                                ? t("active.undo.single", {
                                    userId: activeController.undoMove.moves[0]?.userId ?? "-",
                                    to: activeController.undoMove.moves[0]?.to ?? "-",
                                    seconds: activeController.undoRemainingSec,
                                  })
                                : t("active.undo.multi", {
                                    count: activeController.undoMove.moves.length,
                                    seconds: activeController.undoRemainingSec,
                                  })}
                            </Text>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={<IconX size={16} />}
                              onClick={() => {
                                activeController.setUndoMove(null);
                              }}
                            >
                              {t("active.undo.cancel")}
                            </Button>
                          </Group>
                        </Alert>
                      ) : null}

                      <Suspense fallback={<Card><Spin /></Card>}>
                        <LazyGuildWarDragBoard
                          dragColumns={guildWarDrag.dragColumns}
                          canDrag={canManageActive && Boolean(selectedEventId)}
                          emptyText={t("empty")}
                          activePoolStatus={guildWarDrag.activePoolStatus}
                          selectedUserIds={guildWarDrag.selectedDragUserIdSet}
                          activeSearch={activeController.activeSearch}
                          activeDragItem={guildWarDrag.activeDragItem}
                          toMemberDomId={guildWarDrag.toMemberDomId}
                          sensors={sensors}
                          onSelectMember={guildWarDrag.handleSelectMember}
                          onOpenMember={
                            canManageActive && selectedEventId
                              ? (userId) => activeController.setActiveDetailUserId(userId)
                              : undefined
                          }
                          onDragStart={guildWarDrag.handleDragStart}
                          onDragCancel={guildWarDrag.handleDragCancel}
                          onDragEnd={guildWarDrag.handleDragEnd}
                          teamStatusContentByContainerId={guildWarDrag.teamStatusContentByContainerId}
                          onTeamContextMenu={handleTeamContextMenu}
                          onMemberContextMenu={handleMemberContextMenu}
                          onPoolContextMenu={handlePoolContextMenu}
                          onCopyTeamMentions={guildWarDrag.handleCopyTeamMentions}
                          disabled={!selectedEventId}
                        />
                      </Suspense>

                      <Suspense fallback={null}>
                        <LazyWarMemberDetailModal
                          open={Boolean(activeController.activeDetailUserId && guildWarDrag.activeDetail)}
                          activeDetailUserId={activeController.activeDetailUserId}
                          activeDetail={guildWarDrag.activeDetail}
                          onClose={() => activeController.setActiveDetailUserId(null)}
                        />
                      </Suspense>
                    </Space>
                  ),
                },
              ]
            : []),
          {
            key: "history",
            label: t("tab.history"),
            children: (
              <Suspense
                fallback={
                  <Card>
                    <Spin />
                  </Card>
                }
              >
                <LazyWarHistoryTab
                  heading={sectionHeading(t("tab.history"))}
                  historyViewMode={historyViewMode}
                  onHistoryViewModeChange={setHistoryViewMode}
                  historyChartMetric={historyChartMetric}
                  onHistoryChartMetricChange={setHistoryChartMetric}
                  historyDateFrom={historyDateFrom}
                  historyDateTo={historyDateTo}
                  onHistoryDateFromChange={setHistoryDateFrom}
                  onHistoryDateToChange={setHistoryDateTo}
                  onClearDates={() => {
                    setHistoryDateFrom("");
                    setHistoryDateTo("");
                  }}
                  onExport={(format) => guildWarMutations.exportHistoryMutation.mutate(format)}
                  exportPending={guildWarMutations.exportHistoryMutation.isPending}
                  exportCsvLabel={t("history.export.csv")}
                  exportJsonLabel={t("history.export.json")}
                  canManage={canManageActive}
                  historyLoading={historyQuery.isLoading}
                  historyError={historyQuery.isError}
                  historyRows={historyQuery.data?.data ?? []}
                  historyColumns={guildWarHistory.historyColumns}
                  onSelectHistoryId={setSelectedHistoryId}
                  historyDetailLoading={historyDetailQuery.isLoading}
                  historyDetailError={historyDetailQuery.isError}
                  historyDetail={historyDetailQuery.data ?? null}
                  historyMvp={guildWarHistory.historyMvp}
                  historyMissingSlotsByUserId={guildWarHistory.historyMissingSlotsByUserId}
                  onPostResults={(platform) => {
                    if (!historyDetailQuery.data) {
                      return;
                    }
                    guildWarMutations.postResultsMutation.mutate({
                      war_history_id: historyDetailQuery.data.id,
                      platform,
                    });
                  }}
                  postResultsPending={guildWarMutations.postResultsMutation.isPending}
                  onSaveMemberStats={guildWarMutations.saveHistoryMemberStats}
                  saveMemberStatsPending={guildWarMutations.updateMemberStatsMutation.isPending}
                  onDeleteHistory={(id) => guildWarMutations.deleteHistoryMutation.mutate(id)}
                  deleteHistoryPending={guildWarMutations.deleteHistoryMutation.isPending}
                  renderCounter={guildWarHistory.renderCounter}
                  historyDetailTitle={t("history.detail")}
                  historyResultLabel={t("history.result")}
                  loadErrorMessage={t("common:loadError")}
                  chartThemeName={chartThemeName}
                  chartPalette={chartPalette}
                  hashToPaletteColor={guildWarAnalytics.hashToPaletteColor}
                  getMetricLabel={(metric) => t(guildWarAnalytics.getMetricLabelKey(metric))}
                  metricValueOrNullFromWarMember={guildWarAnalytics.metricValueOrNullFromWarMember}
                  echarts={echarts}
                  initialSearch={guildWarSearch.warName}
                />
              </Suspense>
            ),
          },
          {
            key: "analytics",
            label: t("tab.analytics"),
            children: (
              <Suspense
                fallback={
                  <Card>
                    <Spin />
                  </Card>
                }
              >
                <LazyGuildWarAnalyticsTab
                  mode={guildWarAnalytics.analyticsMode}
                  onModeChange={guildWarAnalytics.setAnalyticsMode}
                  selectedMetrics={guildWarAnalytics.analyticsSelectedMetrics}
                  onSelectedMetricsChange={guildWarAnalytics.setAnalyticsSelectedMetrics}
                  selectedWarIds={guildWarAnalytics.analyticsSelectedWarIds}
                  onSelectedWarIdsChange={guildWarAnalytics.setAnalyticsSelectedWarIds}
                  warOptions={guildWarAnalytics.analyticsWarOptions}
                  datePreset={guildWarAnalytics.analyticsDatePreset}
                  onDatePresetChange={guildWarAnalytics.handleAnalyticsDatePresetChange}
                  onCopySnapshot={guildWarAnalytics.copyAnalyticsSnapshot}
                  onCopyCsv={guildWarAnalytics.copyAnalyticsCsv}
                  isExternalView={isExternalView}
                  tableRows={guildWarAnalytics.analyticsTableRows as Array<Record<string, unknown>>}
                  focusedUser={guildWarAnalytics.analyticsFocusedUser}
                  onFocusedUserChange={guildWarAnalytics.setAnalyticsFocusedUser}
                  selectableUserIds={guildWarAnalytics.analyticsSelectableUserIds}
                  onlyParticipated={guildWarAnalytics.analyticsOnlyParticipated}
                  onOnlyParticipatedChange={guildWarAnalytics.setAnalyticsOnlyParticipated}
                  selectedUsers={guildWarAnalytics.analyticsSelectedUsers}
                  onSelectedUsersChange={guildWarAnalytics.applyAnalyticsSelection}
                  compareUserIds={guildWarAnalytics.analyticsCompareUserIds}
                  onLegendInteraction={guildWarAnalytics.handleLegendInteraction}
                  hashToPaletteColor={guildWarAnalytics.hashToPaletteColor}
                  chartPalette={chartPalette}
                  aggregation={guildWarAnalytics.analyticsAggregation}
                  onAggregationChange={guildWarAnalytics.setAnalyticsAggregation}
                  topN={guildWarAnalytics.analyticsTopN}
                  onTopNChange={guildWarAnalytics.setAnalyticsTopN}
                  minParticipation={guildWarAnalytics.analyticsMinParticipation}
                  onMinParticipationChange={guildWarAnalytics.setAnalyticsMinParticipation}
                  selectedTeams={guildWarAnalytics.analyticsSelectedTeams}
                  onSelectedTeamsChange={guildWarAnalytics.setAnalyticsSelectedTeams}
                  teamOptions={guildWarAnalytics.analyticsTeamOptions}
                  teamAggregation={guildWarAnalytics.analyticsTeamAggregation}
                  onTeamAggregationChange={guildWarAnalytics.setAnalyticsTeamAggregation}
                  selectionSoftCap={guildWarAnalytics.selectionSoftCap}
                  analyticsQueryLoading={guildWarAnalytics.analyticsQuery.isLoading}
                  analyticsQueryError={guildWarAnalytics.analyticsQuery.isError}
                  analyticsDetailsLoading={guildWarAnalytics.analyticsDetailsQuery.isLoading}
                  analyticsDetailsError={guildWarAnalytics.analyticsDetailsQuery.isError}
                  loadErrorMessage={t("common:loadError")}
                  metricLabel={guildWarAnalytics.analyticsMetricLabel}
                  echarts={echarts}
                  chartThemeName={chartThemeName}
                  chartOption={guildWarAnalytics.analyticsChartOption}
                  normEnabled={guildWarAnalytics.analyticsNormEnabled}
                  onNormEnabledChange={guildWarAnalytics.setAnalyticsNormEnabled}
                  modifierWeights={guildWarAnalytics.modifierWeights}
                  onModifierWeightsChange={guildWarAnalytics.setModifierWeights}
                  referenceDuration={guildWarAnalytics.referenceDuration}
                />
              </Suspense>
            ),
          },
        ]}
      />

    </PageLayout>
  );
}
