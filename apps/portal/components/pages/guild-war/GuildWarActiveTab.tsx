import type { SensorDescriptor, SensorOptions } from "@dnd-kit/core";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppError } from "../../../hooks/useAppError";
import { absenceQueryKeys, concludeGuildWar, guildWarQueryKeys, moveGuildWarMember, usersQueryKeys } from "../../../services/GuildWarService";
import { fetchAbsencesWindow, fetchAllUsersListWithOptions } from "../../../services/UserService";
import { formatDateTimeWithTimeZone, localDateKey } from "../../../utils/datetime";
import { notifySuccess } from "../../../utils/notifications";
import { SwordsIcon } from "../../icons";
import { GuildWarTeamEditModal } from "../../feature/guild-war/GuildWarTeamEditModal";
import type { ConcludeWarMember, ConcludeWarSubmitData } from "../../feature/guild-war/ConcludeWarModal";
import type { useGuildWarActiveController } from "../../feature/guild-war/useGuildWarActiveController";
import type { useGuildWarDragController } from "../../../hooks/guild-war/useGuildWarDragController";
import type { useGuildWarData } from "../../../hooks/data/useGuildWarData";
import { EmptyState } from "../../shared/EmptyState";
import { PickList } from "../../shared/PickList";

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
  canViewMemberNotes: boolean;
  activeController: ReturnType<typeof useGuildWarActiveController>;
  guildWarDrag: ReturnType<typeof useGuildWarDragController>;
  eligibleWarEvents: ReturnType<typeof useGuildWarData>["eligibleWarEvents"];
  activeEligibilityReady: boolean;
  canCreateWarEvent: boolean;
  onCreateWarEvent: () => void;
  onViewHistory: () => void;
  activeQuery: ReturnType<typeof useGuildWarData>["activeQuery"];
  sensors: SensorDescriptor<SensorOptions>[];
  concludeWarDisabled: boolean;
  concludeWarDisabledReason: string | undefined;
};

export function resolveGuildWarAbsenceWindow(
  startAt: string | null | undefined,
): { from: string; to: string } | null {
  /* 请假是日历日期，按阅读者本地日期取战役那天，才和界面上显示的日期一致。 */
  const day = startAt ? localDateKey(startAt) : undefined;
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  return { from: day, to: day };
}

type GuildWarActiveEmptyStateProps = {
  canCreateWarEvent: boolean;
  onCreateWarEvent: () => void;
  onViewHistory: () => void;
};

export function GuildWarActiveEmptyState({
  canCreateWarEvent,
  onCreateWarEvent,
  onViewHistory,
}: GuildWarActiveEmptyStateProps) {
  const { t } = useTranslation("guild-war");

  return (
    <Card className="guild-war-active-empty">
      <EmptyState
        className="guild-war-active-empty__state"
        icon={<SwordsIcon size={24} aria-hidden="true" />}
        title={t("active.empty.title")}
        description={
          canCreateWarEvent
            ? t("active.empty.managerDescription")
            : t("active.empty.viewerDescription")
        }
        actions={
          <Button onClick={canCreateWarEvent ? onCreateWarEvent : onViewHistory}>
            {canCreateWarEvent
              ? t("active.empty.createAction")
              : t("active.empty.historyAction")}
          </Button>
        }
      />
    </Card>
  );
}

type GuildWarTeamConflictAlertProps = {
  pending: boolean;
  onAcceptRemote: () => void;
  onRetryLocal: () => void;
};

export function GuildWarTeamConflictAlert({
  pending,
  onAcceptRemote,
  onRetryLocal,
}: GuildWarTeamConflictAlertProps) {
  const { t } = useTranslation("guild-war");

  return (
    <Alert className="guild-war-team-conflict">
      <AlertTitle>{t("active.teamConflict.title")}</AlertTitle>
      <AlertDescription>
        <p>{t("active.teamConflict.description")}</p>
        <div className="guild-war-team-conflict__actions">
          <Button size="xs" variant="default" disabled={pending} onClick={onAcceptRemote}>
            {t("active.teamConflict.useRemote")}
          </Button>
          <Button size="xs" variant="outline" disabled={pending} onClick={onRetryLocal}>
            {t("active.teamConflict.keepLocal")}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function GuildWarActiveTab({
  selectedEventId,
  setSelectedEventId,
  canManageActive,
  canViewMemberNotes,
  activeController,
  guildWarDrag,
  eligibleWarEvents,
  activeEligibilityReady,
  canCreateWarEvent,
  onCreateWarEvent,
  onViewHistory,
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

  // Absence queries use the selected war's calendar date, not today's date.
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

  // Add-to-pool state
  const [addToPoolOpen, setAddToPoolOpen] = useState(false);
  const [addToPoolSelection, setAddToPoolSelection] = useState<string[]>([]);
  const [addToPoolSearch, setAddToPoolSearch] = useState("");

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
      .map((u) => ({ value: u.user.id, label: u.user.display_name }));
  }, [activeQuery.data, usersQuery.data]);
  const filteredAvailableForPool = useMemo(() => {
    const query = addToPoolSearch.trim().toLocaleLowerCase();
    if (!query) return availableForPool;
    return availableForPool.filter((option) => option.label.toLocaleLowerCase().includes(query));
  }, [addToPoolSearch, availableForPool]);

  const togglePoolSelection = useCallback((userId: string) => {
    setAddToPoolSelection((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  }, []);

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
      setAddToPoolSearch("");
      setAddToPoolOpen(false);
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

  // War conclusion state
  const [concludeWarOpen, setConcludeWarOpen] = useState(false);

  const concludeWarMembers = useMemo<ConcludeWarMember[]>(() => {
    const activeData = activeQuery.data;
    if (!activeData) return [];
    const userMap = new Map(
      (usersQuery.data?.data ?? []).map((u) => [u.user.id, u.user.display_name]),
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
          display_name: userMap.get(member.user_id) ?? member.user_id,
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
          result: data.warInfo.result,
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
      setConcludeWarOpen(false);
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

  if (activeEligibilityReady && eligibleWarEvents.length === 0) {
    return (
      <GuildWarActiveEmptyState
        canCreateWarEvent={canCreateWarEvent}
        onCreateWarEvent={onCreateWarEvent}
        onViewHistory={onViewHistory}
      />
    );
  }

  return (
    <div className="guild-war-active-shell">
      <Suspense fallback={(
        <Card className="guild-war-active-skeleton">
          <Skeleton className="h-8 w-2/5" />
          <Skeleton className="h-8 w-full" />
          <div className="guild-war-active-skeleton__row">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-8 w-1/3" />
          </div>
        </Card>
      )}>
        <LazyGuildWarActiveTopCard
          selectedEventId={selectedEventId}
          eventOptions={eligibleWarEvents.map((item) => ({
            value: item.id,
            label: `${item.title} (${formatDateTimeWithTimeZone(item.start_at)})`,
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
          onConcludeWar={canManageActive && selectedEventId ? () => setConcludeWarOpen(true) : undefined}
          concludeWarDisabled={concludeWarDisabled}
          concludeWarDisabledReason={concludeWarDisabledReason}
          onAddTeam={canManageActive && selectedEventId ? guildWarDrag.handleAddTeam : undefined}
          saveTeamsPending={activeController.saveTeamsPending}
        />
      </Suspense>

      {activeController.hasTeamDraftConflict ? (
        <GuildWarTeamConflictAlert
          pending={activeController.saveTeamsPending}
          onAcceptRemote={activeController.acceptRemoteTeamChanges}
          onRetryLocal={activeController.retryLocalTeamChanges}
        />
      ) : null}

      <Suspense fallback={(
        <Card className="guild-war-active-board-skeleton">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="guild-war-active-board-skeleton__column">
              <Skeleton className="h-6 w-3/5" />
              <Skeleton className="h-15 w-full" />
              <Skeleton className="h-15 w-full" />
              <Skeleton className="h-15 w-full" />
            </div>
          ))}
        </Card>
      )}>
        <LazyGuildWarDragBoard
          dragColumns={guildWarDrag.dragColumns}
          canDrag={canManageActive && Boolean(selectedEventId)}
          emptyText={t("empty")}
          activeSearch={activeController.activeSearch}
          activeDragItem={guildWarDrag.activeDragItem}
          toMemberDomId={guildWarDrag.toMemberDomId}
          sensors={sensors}
          onOpenMember={
            selectedEventId
              ? (userId) => activeController.setActiveDetailUserId(userId)
              : undefined
          }
          onDragStart={guildWarDrag.handleDragStart}
          onDragCancel={guildWarDrag.handleDragCancel}
          onDragEnd={guildWarDrag.handleDragEnd}
          onCopyTeamMentions={guildWarDrag.handleCopyTeamMentions}
          onToggleLock={canManageActive ? guildWarDrag.handleToggleLock : undefined}
          onMoveTeam={canManageActive ? guildWarDrag.handleMoveTeamOrder : undefined}
          onDeleteTeam={canManageActive ? guildWarDrag.handleDeleteTeam : undefined}
          lockedTeamIds={guildWarDrag.lockedTeamIds}
          teamCount={guildWarDrag.teamCount}
          teamIndexMap={guildWarDrag.teamIndexMap}
          onAddToPool={canManageActive && selectedEventId ? () => setAddToPoolOpen(true) : undefined}
          onEditTeam={canManageActive ? guildWarDrag.handleEditTeam : undefined}
          disabled={!selectedEventId}
          absentUserIds={absentUserIds}
        />
      </Suspense>

      <GuildWarTeamEditModal
        target={guildWarDrag.teamEditorTarget}
        onNameChange={guildWarDrag.handleDraftNameChange}
        onNotesChange={guildWarDrag.handleDraftNotesChange}
        onClose={guildWarDrag.handleCloseTeamEditor}
      />

      <Suspense fallback={null}>
        <LazyWarMemberDetailModal
          open={Boolean(activeController.activeDetailUserId && guildWarDrag.activeDetail)}
          activeDetailUserId={activeController.activeDetailUserId}
          activeDetail={guildWarDrag.activeDetail}
          canViewNotes={canViewMemberNotes}
          onClose={() => activeController.setActiveDetailUserId(null)}
        />
      </Suspense>

      <Dialog
        open={addToPoolOpen}
        onOpenChange={(open) => {
          if (!open && addToPoolMutation.isPending) return;
          setAddToPoolOpen(open);
          if (!open) setAddToPoolSearch("");
        }}
      >
        <DialogContent
          className="guild-war-task-modal"
          closeLabel={t("common:action.close")}
          closeButtonDisabled={addToPoolMutation.isPending}
        >
          <DialogHeader>
            <DialogTitle>{t("active.addToPoolTitle")}</DialogTitle>
            <DialogDescription>{t("active.addToPoolDescription")}</DialogDescription>
          </DialogHeader>
          <div className="guild-war-task-modal__body">
            <div className="guild-war-task-modal__intro">
              <span>{t("active.addToPoolField")}</span>
              <Badge variant="secondary" className="tabular-nums">
                {t("active.addToPoolAvailable", { count: availableForPool.length })}
              </Badge>
            </div>
            <PickList
              className="guild-war-task-modal__pick-list"
              options={filteredAvailableForPool.map((option) => ({
                id: option.value,
                label: option.label,
              }))}
              selected={new Set(addToPoolSelection)}
              onToggle={togglePoolSelection}
              search={{
                value: addToPoolSearch,
                onChange: setAddToPoolSearch,
                placeholder: t("active.addToPoolPlaceholder"),
              }}
              emptyLabel={t("empty")}
              aria-label={t("active.addToPoolField")}
            />
          </div>
          <DialogFooter className="guild-war-task-modal__footer">
            <span className="guild-war-task-modal__selection tabular-nums">
              {t("active.addToPoolSelected", { count: addToPoolSelection.length })}
            </span>
            <Button
              autoFocus
              variant="outline"
              onClick={() => {
                setAddToPoolOpen(false);
                setAddToPoolSearch("");
              }}
              disabled={addToPoolMutation.isPending}
            >
              {t("common:action.cancel")}
            </Button>
            <Button
              onClick={handleAddToPool}
              loading={addToPoolMutation.isPending}
              disabled={addToPoolSelection.length === 0 || addToPoolMutation.isPending}
            >
              {t("active.addToPoolConfirm", { count: addToPoolSelection.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Suspense fallback={null}>
        <LazyConcludeWarModal
          opened={concludeWarOpen}
          onClose={() => setConcludeWarOpen(false)}
          onSubmit={handleConcludeWar}
          members={concludeWarMembers}
          pending={concludeWarMutation.isPending}
          warName={activeQuery.data?.event?.title ?? t("conclude.defaultWarName")}
        />
      </Suspense>

    </div>
  );
}
