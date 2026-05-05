import { ArrowLeftIcon, SwordsIcon } from "@portal/components/icons";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { buildEChartsTheme } from "../../theme/echarts";
import { useTheme } from "../../providers/ThemeProvider";
import { Alert, Button, Card, Group, Modal, MultiSelect, Skeleton, Stack, Tabs, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { type ContextMenuItemOptions, useContextMenu } from "mantine-contextmenu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useAppError } from "../../hooks/useAppError";
import { useGuildWarData } from "../../hooks/data/useGuildWarData";
import { useExternalView } from "../../hooks/useExternalView";
import { hashToPaletteColor, getMetricLabelKey, metricValueOrNullFromWarMember } from "../../hooks/guild-war/useGuildWarAnalytics";
import { useGuildWarDragController } from "../../hooks/guild-war/useGuildWarDragController";
import { useGuildWarHistory } from "../../hooks/guild-war/useGuildWarHistory";
import { useGuildWarMutations } from "../../hooks/guild-war/useGuildWarMutations";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { GuildWarService, batchUpdateGuildWarMemberStats, moveGuildWarMember, updateGuildWarHistory } from "../../services/GuildWarService";
import { archiveEvent } from "../../services/EventService";
import { queryKeys } from "../../api/query-keys";
import { fetchUsersList } from "../../services/UserService";
import { useAuthStore } from "../../stores/auth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { useGuildWarStore } from "../../stores/guildWar";
import { notifySuccess } from "../../utils/notifications";
import { PageLayout } from "../layout/PageLayout";
import { useGuildWarActiveController } from "../feature/guild-war/useGuildWarActiveController";
import type { ConcludeWarMember, ConcludeWarSubmitData } from "../feature/guild-war/ConcludeWarModal";
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
const LazyConcludeWarModal = lazy(() =>
  import("../feature/guild-war/ConcludeWarModal").then((mod) => ({ default: mod.ConcludeWarModal })),
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
  success: (content: string) => notifySuccess(content),
};

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
  const user = useAuthStore((state) => state.user);
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

  const {
    warEventsQuery,
    selectedEventDetailQuery,
    activeQuery,
    historyQuery,
    historyDetailQuery,
  } = useGuildWarData({
    selectedEventId,
    selectedHistoryId,
    historyDateFrom,
    historyDateTo,
    historyPage,
    historyPerPage,
    hasSession: Boolean(user),
  });

  const activeController = useGuildWarActiveController({
    selectedEventId,
    activeData: activeQuery.data,
    guildWarService,
    showError,
  });

  const { showContextMenu } = useContextMenu();

  const usersQuery = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: fetchUsersList,
    staleTime: 10 * 60_000,
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

  const [addToPoolOpen, addToPoolHandlers] = useDisclosure(false);
  const [addToPoolSelection, setAddToPoolSelection] = useState<string[]>([]);
  const [addToPoolPending, setAddToPoolPending] = useState(false);

  const availableForPool = useMemo(() => {
    const assignedIds = new Set<string>();
    const activeData = activeQuery.data;
    if (activeData) {
      for (const team of activeData.teams) {
        for (const member of team.members) assignedIds.add(member.user_id);
      }
      for (const poolMember of activeData.pool) assignedIds.add(poolMember.userId);
    }
    return (usersQuery.data?.data ?? [])
      .filter((u) => !assignedIds.has(u.user.id))
      .map((u) => ({ value: u.user.id, label: u.user.username }));
  }, [activeQuery.data, usersQuery.data]);

  const handleAddToPool = useCallback(async () => {
    if (!selectedEventId || addToPoolSelection.length === 0) return;
    setAddToPoolPending(true);
    try {
      await moveGuildWarMember({
        event_id: selectedEventId,
        moves: addToPoolSelection.map((userId) => ({ user_id: userId, to: "pool" })),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.guildWar.active(selectedEventId ?? null),
      });
      message.success(t("message.membersAddedToPool", { count: addToPoolSelection.length }));
      setAddToPoolSelection([]);
      addToPoolHandlers.close();
    } catch (error) {
      showError(error, t("message.addToPoolFailed"));
    } finally {
      setAddToPoolPending(false);
    }
  }, [addToPoolHandlers, addToPoolSelection, queryClient, selectedEventId, showError, t]);

  // --- Conclude War ---
  const [concludeWarOpen, concludeWarHandlers] = useDisclosure(false);
  const [concludeWarPending, setConcludeWarPending] = useState(false);

  const concludeWarMembers = useMemo<ConcludeWarMember[]>(() => {
    const activeData = activeQuery.data;
    if (!activeData) return [];
    const userMap = new Map(
      (usersQuery.data?.data ?? []).map((u) => [u.user.id, u.user.username]),
    );
    const members: ConcludeWarMember[] = [];
    for (const team of activeData.teams) {
      for (const member of team.members) {
        const stats: Record<string, number> = {};
        for (const key of Object.keys(member.stats ?? {})) {
          stats[key] = member.stats?.[key] ?? 0;
        }
        members.push({
          userId: member.user_id,
          username: userMap.get(member.user_id) ?? member.user_id,
          teamName: team.team_name,
          stats,
        });
      }
    }
    return members;
  }, [activeQuery.data, usersQuery.data]);

  const concludeWarDisabled = useMemo(() => {
    const activeData = activeQuery.data;
    if (!activeData) return true;
    const hasTeamMembers = activeData.teams.some((team) => team.members.length > 0);
    return !hasTeamMembers;
  }, [activeQuery.data]);

  const handleConcludeWar = useCallback(async (data: ConcludeWarSubmitData) => {
    const activeData = activeQuery.data;
    const warHistoryId = activeData?.war_history?.id;
    if (!warHistoryId || !selectedEventId) return;

    setConcludeWarPending(true);
    try {
      const warUpdate: Record<string, unknown> = {};
      if (data.warInfo.enemyName) warUpdate.enemy_name = data.warInfo.enemyName;
      if (data.warInfo.result) warUpdate.result = data.warInfo.result;
      if (data.warInfo.durationMinutes !== null) warUpdate.duration_minutes = data.warInfo.durationMinutes;

      const ownStats: Record<string, number | null> = {};
      const enemyStats: Record<string, number | null> = {};
      for (const [key, val] of Object.entries(data.warInfo.ownStats)) {
        if (val !== null) ownStats[key] = val;
      }
      for (const [key, val] of Object.entries(data.warInfo.enemyStats)) {
        if (val !== null) enemyStats[key] = val;
      }
      if (Object.keys(ownStats).length > 0) warUpdate.own_stats = ownStats;
      if (Object.keys(enemyStats).length > 0) warUpdate.enemy_stats = enemyStats;

      if (Object.keys(warUpdate).length > 0) {
        await updateGuildWarHistory(warHistoryId, warUpdate);
      }

      // Step 2: Batch update member stats
      if (data.memberStats.length > 0) {
        await batchUpdateGuildWarMemberStats(
          warHistoryId,
          data.memberStats.map((m) => ({ user_id: m.user_id, stats: { stats: m.stats } })),
        );
      }

      // Step 3: Archive the event
      await archiveEvent(selectedEventId);

      // Invalidate queries and close modal
      await queryClient.invalidateQueries({ queryKey: queryKeys.guildWar.active(selectedEventId ?? null) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.guildWar.events() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.guildWar.historyAll() });

      message.success(t("message.warConcluded"));
      concludeWarHandlers.close();
    } catch (error) {
      showError(error, t("message.concludeFailed"));
    } finally {
      setConcludeWarPending(false);
    }
  }, [activeQuery.data, concludeWarHandlers, queryClient, selectedEventId, showError, t]);

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
      { key: "divider-member-remove" },
      {
        key: "member-remove-from-war",
        color: "red",
        onClick: () => guildWarDrag.handleRemoveFromWar(userId),
        title: t("menu.member.removeFromWar"),
      },
    ];

    showContextMenu(items)(event);
  }, [activeController, guildWarDrag, showContextMenu, t]);

  const handlePoolContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    showContextMenu([
      {
        key: "pool-add-member",
        onClick: () => addToPoolHandlers.open(),
        title: t("menu.pool.addMember"),
      },
    ])(event);
  }, [addToPoolHandlers, showContextMenu, t]);

  useEffect(() => {
    if (!activeController.undoMove || activeController.undoRemainingSec > 0) {
      return;
    }
    const pendingMove = activeController.undoMove;
    activeController.setUndoMove(null);
    const commitQueuedMoves = async () => {
      try {
        await moveGuildWarMember({
          event_id: pendingMove.eventId,
          moves: pendingMove.moves.map((move) => ({ user_id: move.userId, to: move.to })),
          etag: pendingMove.etag ?? activeQuery.data?.etag ?? undefined,
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.guildWar.active(selectedEventId ?? null),
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
      historyQuery.isError ||
      historyDetailQuery.isError,
    t("common:loadErrorRetry"),
  );

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<SwordsIcon size={22} />} className="guild-war-page">
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
                    <Stack gap={12} style={{ display: "flex" }}>
                      <Suspense fallback={<Card><Stack gap={10} p="md"><Skeleton height={32} width="40%" /><Skeleton height={32} /><Group gap={8}><Skeleton height={32} width="30%" /><Skeleton height={32} width="30%" /></Group></Stack></Card>}>
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
                          onConcludeWar={canManageActive && selectedEventId ? () => concludeWarHandlers.open() : undefined}
                          concludeWarDisabled={concludeWarDisabled}
                        />
                      </Suspense>

                      {activeController.undoMove && activeController.undoRemainingSec > 0 ? (
                        <Alert color="blue" variant="light">
                          <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                            <Text size="sm">
                              {activeController.undoMove.moves.length === 1
                                ? t("active.undo.single", {
                                    userId: guildWarDrag.resolveUsername(activeController.undoMove.moves[0]?.userId ?? "-"),
                                    to: guildWarDrag.resolveTeamName(activeController.undoMove.moves[0]?.to ?? "-"),
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
                              color="red"
                              leftSection={<ArrowLeftIcon size={16} />}
                              onClick={() => {
                                activeController.setUndoMove(null);
                              }}
                            >
                              {t("active.undo.cancel")}
                            </Button>
                          </Group>
                        </Alert>
                      ) : null}

                      <Suspense fallback={<Card><Group gap={12} p="md" align="flex-start">{Array.from({ length: 4 }).map((_, i) => <Stack key={i} gap={8} style={{ flex: 1 }}><Skeleton height={24} width="60%" /><Skeleton height={60} /><Skeleton height={60} /><Skeleton height={60} /></Stack>)}</Group></Card>}>
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
                          onToggleLock={canManageActive ? guildWarDrag.handleToggleLock : undefined}
                          onMoveTeam={canManageActive ? guildWarDrag.handleMoveTeamOrder : undefined}
                          lockedTeamIds={guildWarDrag.lockedTeamIds}
                          teamCount={guildWarDrag.teamCount}
                          teamIndexMap={guildWarDrag.teamIndexMap}
                          onAddToPool={canManageActive && selectedEventId ? () => addToPoolHandlers.open() : undefined}
                          onDraftNameChange={canManageActive ? guildWarDrag.handleDraftNameChange : undefined}
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

                      <Modal
                        opened={addToPoolOpen}
                        onClose={addToPoolHandlers.close}
                        title={t("active.addToPoolTitle")}
                        centered
                      >
                        <Stack gap={12}>
                          <MultiSelect
                            searchable
                            clearable
                            placeholder={t("active.addToPoolPlaceholder")}
                            data={availableForPool}
                            value={addToPoolSelection}
                            onChange={setAddToPoolSelection}
                          />
                          <Group justify="flex-end">
                            <Button variant="default" onClick={addToPoolHandlers.close}>{t("common:action.cancel")}</Button>
                            <Button
                              onClick={handleAddToPool}
                              loading={addToPoolPending}
                              disabled={addToPoolSelection.length === 0}
                            >
                              {t("active.addToPoolConfirm", { count: addToPoolSelection.length })}
                            </Button>
                          </Group>
                        </Stack>
                      </Modal>

                      <Suspense fallback={null}>
                        <LazyConcludeWarModal
                          opened={concludeWarOpen}
                          onClose={concludeWarHandlers.close}
                          onSubmit={handleConcludeWar}
                          members={concludeWarMembers}
                          pending={concludeWarPending}
                          warName={activeQuery.data?.event?.title ?? t("conclude.defaultWarName")}
                        />
                      </Suspense>
                    </Stack>
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
                    <Stack gap={10} p="md">
                      <Group gap={8}><Skeleton height={28} width="25%" /><Skeleton height={28} width="25%" /></Group>
                      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={18} />)}
                    </Stack>
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
                  historyTotalPages={historyQuery.data?.total_pages ?? 1}
                  historyPage={historyPage}
                  historyPerPage={historyPerPage}
                  onHistoryPageChange={setHistoryPage}
                  onHistoryPerPageChange={setHistoryPerPage}
                  historyColumns={guildWarHistory.historyColumns}
                  onSelectHistoryId={setSelectedHistoryId}
                  historyDetailLoading={historyDetailQuery.isLoading}
                  historyDetailError={historyDetailQuery.isError}
                  historyDetail={historyDetailQuery.data ?? null}
                  historyMvp={guildWarHistory.historyMvp}
                  historyMissingSlotsByUserId={guildWarHistory.historyMissingSlotsByUserId}
                  onSaveMemberStats={guildWarMutations.saveHistoryMemberStats}
                  saveMemberStatsPending={guildWarMutations.updateMemberStatsMutation.isPending}
                  onDeleteHistory={(id) => guildWarMutations.deleteHistoryMutation.mutate(id)}
                  deleteHistoryPending={guildWarMutations.deleteHistoryMutation.isPending}
                  onBulkDeleteHistory={(ids) => guildWarMutations.batchDeleteHistoryMutation.mutate(ids)}
                  bulkDeleteHistoryPending={guildWarMutations.batchDeleteHistoryMutation.isPending}
                  historyDetailTitle={t("history.detail")}
                  loadErrorMessage={t("common:loadError")}
                  chartThemeName={chartThemeName}
                  chartThemeConfig={chartThemeConfig}
                  chartPalette={chartPalette}
                  hashToPaletteColor={hashToPaletteColor}
                  getMetricLabel={(metric) => t(getMetricLabelKey(metric))}
                  metricValueOrNullFromWarMember={metricValueOrNullFromWarMember}
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
                    <Stack gap={10} p="md">
                      <Group gap={8}><Skeleton height={28} width="25%" /><Skeleton height={28} width="25%" /></Group>
                      <Skeleton height={180} radius={8} />
                      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={18} />)}
                    </Stack>
                  </Card>
                }
              >
                <LazyGuildWarAnalyticsTab
                  historyRows={historyQuery.data?.data ?? []}
                  chartPalette={chartPalette}
                  guildWarService={guildWarService}
                  chartThemeName={chartThemeName}
                  chartThemeConfig={chartThemeConfig}
                  loadErrorMessage={t("common:loadError")}
                />
              </Suspense>
            ),
          },
        ]}
      />

    </PageLayout>
  );
}
