import type { SensorDescriptor, SensorOptions } from "@dnd-kit/core";
import { Button, Card, Group, Modal, MultiSelect, Skeleton, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppError } from "../../../hooks/useAppError";
import { absenceQueryKeys, concludeGuildWar, guildWarQueryKeys, moveGuildWarMember, usersQueryKeys } from "../../../services/GuildWarService";
import { fetchAbsencesWindow, fetchAllUsersListWithOptions } from "../../../services/UserService";
import { notifySuccess } from "../../../utils/notifications";
import type { ConcludeWarMember, ConcludeWarSubmitData } from "../../feature/guild-war/ConcludeWarModal";
import type { useGuildWarActiveController } from "../../feature/guild-war/useGuildWarActiveController";
import type { useGuildWarDragController } from "../../../hooks/guild-war/useGuildWarDragController";
import type { useGuildWarHistory } from "../../../hooks/guild-war/useGuildWarHistory";
import type { useGuildWarData } from "../../../hooks/data/useGuildWarData";

const LazyWarMemberDetailModal = lazy(() =>
  import("../../feature/guild-war/WarMemberDetailModal").then((mod) => ({ default: mod.WarMemberDetailModal })),
);
const LazyGuildWarActiveTopCard = lazy(() =>
  import("../../feature/guild-war/GuildWarActiveTopCard").then((mod) => ({ default: mod.GuildWarActiveTopCard })),
);
const LazyGuildWarDragBoard = lazy(() =>
  import("../../feature/guild-war/GuildWarDragBoard").then((mod) => ({ default: mod.GuildWarDragBoard })),
);
const LazyConcludeWarModal = lazy(() =>
  import("../../feature/guild-war/ConcludeWarModal").then((mod) => ({ default: mod.ConcludeWarModal })),
);

type GuildWarActiveTabProps = {
  selectedEventId: string | undefined;
  setSelectedEventId: (id: string) => void;
  canManageActive: boolean;
  activeController: ReturnType<typeof useGuildWarActiveController>;
  guildWarDrag: ReturnType<typeof useGuildWarDragController>;
  guildWarHistory: ReturnType<typeof useGuildWarHistory>;
  warEventsQuery: ReturnType<typeof useGuildWarData>["warEventsQuery"];
  concludedEventIdSet: Set<string>;
  activeQuery: ReturnType<typeof useGuildWarData>["activeQuery"];
  sensors: SensorDescriptor<SensorOptions>[];
  concludeWarDisabled: boolean;
  concludeWarDisabledReason: string | undefined;
};

export function resolveGuildWarAbsenceWindow(
  startAt: string | null | undefined,
): { from: string; to: string } | null {
  const day = startAt?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  return { from: day, to: day };
}

export function GuildWarActiveTab({
  selectedEventId,
  setSelectedEventId,
  canManageActive,
  activeController,
  guildWarDrag,
  guildWarHistory,
  warEventsQuery,
  concludedEventIdSet,
  activeQuery,
  sensors,
  concludeWarDisabled,
  concludeWarDisabledReason,
}: GuildWarActiveTabProps) {
  const { t } = useTranslation("guild-war");
  const queryClient = useQueryClient();
  const { showError } = useAppError();

  const usersQuery = useQuery({
    queryKey: usersQueryKeys.all,
    queryFn: () => fetchAllUsersListWithOptions(),
    staleTime: 10 * 60_000,
  });

  // Absences (请假) covering the war date — marks members on the drag board.
  const absenceWindow = resolveGuildWarAbsenceWindow(activeQuery.data?.event?.start_at);
  const absencesQuery = useQuery({
    queryKey: absenceQueryKeys.window(absenceWindow?.from ?? "", absenceWindow?.to ?? ""),
    queryFn: () => {
      if (!absenceWindow) {
        throw new Error("Guild war absence query requires the selected event date");
      }
      return fetchAbsencesWindow(absenceWindow.from, absenceWindow.to);
    },
    enabled: canManageActive && Boolean(selectedEventId) && Boolean(absenceWindow),
    staleTime: 60_000,
  });
  const absentUserIds = useMemo(
    () => new Set((absencesQuery.data?.data ?? []).map((absence) => absence.user_id)),
    [absencesQuery.data],
  );

  // --- Add to Pool ---
  const [addToPoolOpen, addToPoolHandlers] = useDisclosure(false);
  const [addToPoolSelection, setAddToPoolSelection] = useState<string[]>([]);

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

  const addToPoolMutation = useMutation({
    mutationFn: ({ eventId, userIds }: { eventId: string; userIds: string[] }) =>
      moveGuildWarMember({
        event_id: eventId,
        moves: userIds.map((userId) => ({ user_id: userId, to: "pool" })),
      }),
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({
        queryKey: guildWarQueryKeys.active(variables.eventId),
      });
      notifySuccess(t("message.membersAddedToPool", { count: variables.userIds.length }));
      setAddToPoolSelection([]);
      addToPoolHandlers.close();
    },
    onError: (error) => {
      showError(error, t("message.addToPoolFailed"));
    },
  });

  const handleAddToPool = useCallback(() => {
    if (!selectedEventId || addToPoolSelection.length === 0 || addToPoolMutation.isPending) return;
    addToPoolMutation.mutate({
      eventId: selectedEventId,
      userIds: [...addToPoolSelection],
    });
  }, [addToPoolMutation, addToPoolSelection, selectedEventId]);

  // --- Conclude War ---
  const [concludeWarOpen, concludeWarHandlers] = useDisclosure(false);

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

  const concludeWarMutation = useMutation({
    mutationFn: async ({ eventId, data }: { eventId: string; data: ConcludeWarSubmitData }) => {
      const ownStats: Record<string, number | null> = {};
      const enemyStats: Record<string, number | null> = {};
      for (const [key, val] of Object.entries(data.warInfo.ownStats)) {
        if (val !== null) ownStats[key] = val;
      }
      for (const [key, val] of Object.entries(data.warInfo.enemyStats)) {
        if (val !== null) enemyStats[key] = val;
      }

      return concludeGuildWar({
        event_id: eventId,
        war_info: {
          enemy_name: data.warInfo.enemyName || undefined,
          result: data.warInfo.result as "win" | "loss" | "draw",
          duration_minutes: data.warInfo.durationMinutes,
          own_stats: Object.keys(ownStats).length > 0 ? ownStats : undefined,
          enemy_stats: Object.keys(enemyStats).length > 0 ? enemyStats : undefined,
        },
        member_stats: data.memberStats.length > 0 ? data.memberStats : undefined,
      });
    },
    onSuccess: async (_response, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: guildWarQueryKeys.active(variables.eventId) }),
        queryClient.invalidateQueries({ queryKey: guildWarQueryKeys.events() }),
        queryClient.invalidateQueries({ queryKey: guildWarQueryKeys.concludedEventIds() }),
        queryClient.invalidateQueries({ queryKey: guildWarQueryKeys.historyAll() }),
      ]);
      notifySuccess(t("message.warConcluded"));
      concludeWarHandlers.close();
      setSelectedEventId("");
    },
    onError: (error) => {
      showError(error, t("message.concludeFailed"));
    },
  });

  const handleConcludeWar = useCallback((data: ConcludeWarSubmitData) => {
    if (!selectedEventId || concludeWarMutation.isPending) return;
    concludeWarMutation.mutate({ eventId: selectedEventId, data });
  }, [concludeWarMutation, selectedEventId]);

  const handleSelectedEventIdChange = useCallback(async (nextEventId: string) => {
    if (nextEventId === (selectedEventId ?? "")) return;
    const canChangeEvent = await activeController.confirmDiscardTeamsChanges();
    if (canChangeEvent) {
      setSelectedEventId(nextEventId);
    }
  }, [activeController, selectedEventId, setSelectedEventId]);

  return (
    <Stack gap={12} style={{ display: "flex" }}>
      <Suspense fallback={<Card><Stack gap={10} p="md"><Skeleton height={32} width="40%" /><Skeleton height={32} /><Group gap={8}><Skeleton height={32} width="30%" /><Skeleton height={32} width="30%" /></Group></Stack></Card>}>
        <LazyGuildWarActiveTopCard
          selectedEventId={selectedEventId}
          eventOptions={(warEventsQuery.data?.data ?? []).filter((item) => !concludedEventIdSet.has(item.id)).map((item) => ({
            value: item.id,
            label: `${item.title} (${guildWarHistory.formatDateTime(item.start_at)})`,
          }))}
          eventPlaceholder={t("active.event")}
          onSelectedEventIdChange={(nextEventId) => {
            void handleSelectedEventIdChange(nextEventId);
          }}
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
          concludeWarDisabledReason={concludeWarDisabledReason}
          onAddTeam={canManageActive && selectedEventId ? guildWarDrag.handleAddTeam : undefined}
          onSaveTeams={canManageActive && selectedEventId ? activeController.handleSaveTeams : undefined}
          saveTeamsPending={activeController.saveTeamsPending}
          teamsDirty={activeController.isTeamsDirty}
        />
      </Suspense>

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
            selectedEventId
              ? (userId) => activeController.setActiveDetailUserId(userId)
              : undefined
          }
          onDragStart={guildWarDrag.handleDragStart}
          onDragCancel={guildWarDrag.handleDragCancel}
          onDragEnd={guildWarDrag.handleDragEnd}
          teamStatusContentByContainerId={guildWarDrag.teamStatusContentByContainerId}
          onCopyTeamMentions={guildWarDrag.handleCopyTeamMentions}
          onToggleLock={canManageActive ? guildWarDrag.handleToggleLock : undefined}
          onMoveTeam={canManageActive ? guildWarDrag.handleMoveTeamOrder : undefined}
          onDeleteTeam={canManageActive ? guildWarDrag.handleDeleteTeam : undefined}
          lockedTeamIds={guildWarDrag.lockedTeamIds}
          teamCount={guildWarDrag.teamCount}
          teamIndexMap={guildWarDrag.teamIndexMap}
          onAddToPool={canManageActive && selectedEventId ? () => addToPoolHandlers.open() : undefined}
          onDraftNameChange={canManageActive ? guildWarDrag.handleDraftNameChange : undefined}
          disabled={!selectedEventId}
          absentUserIds={absentUserIds}
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
              loading={addToPoolMutation.isPending}
              disabled={addToPoolSelection.length === 0 || addToPoolMutation.isPending}
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
          pending={concludeWarMutation.isPending}
          warName={activeQuery.data?.event?.title ?? t("conclude.defaultWarName")}
        />
      </Suspense>

    </Stack>
  );
}
