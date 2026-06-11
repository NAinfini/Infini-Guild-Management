import { ArrowLeftIcon } from "@portal/components/icons";
import type { SensorDescriptor, SensorOptions } from "@dnd-kit/core";
import { Button, Card, Group, Modal, MultiSelect, Skeleton, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppError } from "../../../hooks/useAppError";
import { absenceQueryKeys, concludeGuildWar, guildWarQueryKeys, moveGuildWarMember, usersQueryKeys } from "../../../services/GuildWarService";
import { fetchAbsencesWindow, fetchAllUsersListWithOptions } from "../../../services/UserService";
import { notifySuccess } from "../../../utils/notifications";
import { useQuery } from "@tanstack/react-query";
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

const message = {
  success: (content: string) => notifySuccess(content),
};

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
  const warDate = activeQuery.data?.event?.start_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const absencesQuery = useQuery({
    queryKey: absenceQueryKeys.window(warDate, warDate),
    queryFn: () => fetchAbsencesWindow(warDate, warDate),
    enabled: Boolean(selectedEventId),
    staleTime: 60_000,
  });
  const absentUserIds = useMemo(
    () => new Set((absencesQuery.data?.data ?? []).map((absence) => absence.user_id)),
    [absencesQuery.data],
  );

  // --- Add to Pool ---
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
        queryKey: guildWarQueryKeys.active(selectedEventId ?? null),
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

  const handleConcludeWar = useCallback(async (data: ConcludeWarSubmitData) => {
    if (!selectedEventId) return;

    setConcludeWarPending(true);
    try {
      const ownStats: Record<string, number | null> = {};
      const enemyStats: Record<string, number | null> = {};
      for (const [key, val] of Object.entries(data.warInfo.ownStats)) {
        if (val !== null) ownStats[key] = val;
      }
      for (const [key, val] of Object.entries(data.warInfo.enemyStats)) {
        if (val !== null) enemyStats[key] = val;
      }

      await concludeGuildWar({
        event_id: selectedEventId,
        war_info: {
          enemy_name: data.warInfo.enemyName || undefined,
          result: data.warInfo.result as "win" | "loss" | "draw",
          duration_minutes: data.warInfo.durationMinutes,
          own_stats: Object.keys(ownStats).length > 0 ? ownStats : undefined,
          enemy_stats: Object.keys(enemyStats).length > 0 ? enemyStats : undefined,
        },
        member_stats: data.memberStats.length > 0 ? data.memberStats : undefined,
      });

      await queryClient.invalidateQueries({ queryKey: guildWarQueryKeys.active(selectedEventId ?? null) });
      await queryClient.invalidateQueries({ queryKey: guildWarQueryKeys.events() });
      await queryClient.invalidateQueries({ queryKey: guildWarQueryKeys.concludedEventIds() });
      await queryClient.invalidateQueries({ queryKey: guildWarQueryKeys.historyAll() });

      message.success(t("message.warConcluded"));
      concludeWarHandlers.close();
      setSelectedEventId("");
    } catch (error) {
      showError(error, t("message.concludeFailed"));
    } finally {
      setConcludeWarPending(false);
    }
  }, [concludeWarHandlers, queryClient, selectedEventId, setSelectedEventId, showError, t]);

  // --- Undo commit timeout ---
  const undoMoveRef = activeController.undoMove;

  useEffect(() => {
    if (!undoMoveRef) return;

    const delay = Math.max(0, undoMoveRef.expiresAt - Date.now());
    const pendingMove = undoMoveRef;

    activeController.commitTimeoutRef.current = window.setTimeout(() => {
      activeController.commitTimeoutRef.current = null;
      activeController.setUndoMove(null);
      const commitQueuedMoves = async () => {
        try {
          await moveGuildWarMember({
            event_id: pendingMove.eventId,
            moves: pendingMove.moves.map((move) => ({ user_id: move.userId, to: move.to })),
            etag: pendingMove.etag ?? activeQuery.data?.etag ?? undefined,
          });
          await queryClient.invalidateQueries({
            queryKey: guildWarQueryKeys.active(selectedEventId ?? null),
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
    }, delay);

    return () => {
      if (activeController.commitTimeoutRef.current !== null) {
        window.clearTimeout(activeController.commitTimeoutRef.current);
        activeController.commitTimeoutRef.current = null;
      }
    };
   
  }, [undoMoveRef]);

  // --- Undo notification toast ---
  const UNDO_NOTIFICATION_ID = "guild-war-undo-move";
  const undoCancelRef = useRef(() => activeController.setUndoMove(null));
  undoCancelRef.current = () => activeController.setUndoMove(null);
  const undoNotificationShownRef = useRef(false);

  useEffect(() => {
    if (!activeController.undoMove || activeController.undoRemainingSec <= 0) {
      if (undoNotificationShownRef.current) {
        notifications.hide(UNDO_NOTIFICATION_ID);
        undoNotificationShownRef.current = false;
      }
      return;
    }
    const undoText = activeController.undoMove.moves.length === 1
      ? t("active.undo.single", {
          userId: guildWarDrag.resolveUsername(activeController.undoMove.moves[0]?.userId ?? "-"),
          to: guildWarDrag.resolveTeamName(activeController.undoMove.moves[0]?.to ?? "-"),
          seconds: activeController.undoRemainingSec,
        })
      : t("active.undo.multi", {
          count: activeController.undoMove.moves.length,
          seconds: activeController.undoRemainingSec,
        });
    const payload = {
      id: UNDO_NOTIFICATION_ID,
      color: "blue" as const,
      autoClose: false as const,
      withCloseButton: false,
      message: (
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Text size="sm">{undoText}</Text>
          <Button
            size="xs"
            variant="light"
            color="red"
            leftSection={<ArrowLeftIcon size={16} />}
            onClick={() => undoCancelRef.current()}
          >
            {t("active.undo.cancel")}
          </Button>
        </Group>
      ),
    };
    if (undoNotificationShownRef.current) {
      notifications.update(payload);
    } else {
      notifications.show(payload);
      undoNotificationShownRef.current = true;
    }
  }, [activeController.undoMove, activeController.undoRemainingSec, guildWarDrag, t]);

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
          concludeWarDisabledReason={concludeWarDisabledReason}
          onAddTeam={canManageActive && selectedEventId ? guildWarDrag.handleAddTeam : undefined}
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

      <Modal
        opened={Boolean(guildWarDrag.pendingRemove)}
        onClose={guildWarDrag.cancelRemove}
        title={t("active.removeConfirm.title")}
        centered
        size="sm"
      >
        <Stack gap={12}>
          <Text size="sm">
            {guildWarDrag.pendingRemove?.userIds.length === 1
              ? t("active.removeConfirm.descSingle", {
                  username: guildWarDrag.resolveUsername(guildWarDrag.pendingRemove.userIds[0] ?? ""),
                })
              : t("active.removeConfirm.descMulti", {
                  count: guildWarDrag.pendingRemove?.userIds.length ?? 0,
                })}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={guildWarDrag.cancelRemove}>
              {t("common:action.cancel")}
            </Button>
            <Button color="red" onClick={guildWarDrag.confirmRemove}>
              {t("active.removeConfirm.confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(guildWarDrag.pendingDeleteTeamId)}
        onClose={guildWarDrag.cancelDeleteTeam}
        title={t("active.deleteTeamConfirm.title")}
        centered
        size="sm"
      >
        <Stack gap={12}>
          <Text size="sm">
            {t("active.deleteTeamConfirm.desc", {
              teamName: guildWarDrag.pendingDeleteTeamId
                ? guildWarDrag.resolveTeamName(guildWarDrag.pendingDeleteTeamId)
                : "",
            })}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={guildWarDrag.cancelDeleteTeam}>
              {t("common:action.cancel")}
            </Button>
            <Button color="red" onClick={guildWarDrag.confirmDeleteTeam}>
              {t("active.deleteTeamConfirm.confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
