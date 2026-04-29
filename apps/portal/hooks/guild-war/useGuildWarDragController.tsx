import type { GuildWarActiveResponse } from "@guild/shared";
import { notifications } from "@mantine/notifications";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  useCallback,
  useMemo,
  type Dispatch,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import type { UsersListResponse } from "../../services/UserService";
import { GuildWarService } from "../../services/GuildWarService";
import { copyPlainText } from "../../utils/copy";
import { useGuildWarDragData, type DragMemberColumn } from "./useGuildWarDragData";
import { useGuildWarSearch } from "./useGuildWarSearch";
import { TeamStatusPanel } from "../../components/feature/guild-war/TeamStatusPanel";

type UndoMoveState = {
  eventId: string;
  moves: Array<{ userId: string; from: string; to: string }>;
  etag?: string;
  expiresAt: number;
};

type MovePayload = {
  event_id: string;
  user_id: string;
  to: string;
  from?: string;
  etag?: string;
};

type ActiveControllerState = {
  selectedDragUserIds: string[];
  setSelectedDragUserIds: Dispatch<SetStateAction<string[]>>;
  selectionAnchorUserId: string | null;
  setSelectionAnchorUserId: Dispatch<SetStateAction<string | null>>;
  activeDragItemId: string | null;
  setActiveDragItemId: Dispatch<SetStateAction<string | null>>;
  undoMove: UndoMoveState | null;
  setUndoMove: Dispatch<SetStateAction<UndoMoveState | null>>;
  teamDraftNames: Record<string, string>;
  setTeamDraftNames: Dispatch<SetStateAction<Record<string, string>>>;
  teamDraftNotes: Record<string, string>;
  setTeamDraftNotes: Dispatch<SetStateAction<Record<string, string>>>;
  teamDraftLocks: Record<string, boolean>;
  setTeamDraftLocks: Dispatch<SetStateAction<Record<string, boolean>>>;
  teamOrder: string[];
  setTeamOrder: Dispatch<SetStateAction<string[]>>;
  activeSearch: string;
  searchJumpIndex: number;
  setSearchJumpIndex: Dispatch<SetStateAction<number>>;
  activeDetailUserId: string | null;
  setActiveDetailUserId: Dispatch<SetStateAction<string | null>>;
  moveTeamOrder: (teamId: string, direction: "up" | "down") => void;
};

type RoleTagMutation = {
  isPending: boolean;
  mutate: (payload: { event_id: string; user_id: string; role_tag: string | null }) => void;
};

type UseGuildWarDragControllerParams = {
  activeData: GuildWarActiveResponse | undefined;
  usersData: UsersListResponse["data"] | undefined;
  canManageActive: boolean;
  selectedEventId: string | undefined;
  activeController: ActiveControllerState;
  roleTagMutation: RoleTagMutation;
  guildWarService: GuildWarService;
  showError: (error: unknown, fallbackMessage: string) => void;
};

const message = {
  success: (content: string) => notifications.show({ color: "green", message: content }),
  warning: (content: string) => notifications.show({ color: "yellow", message: content }),
  info: (content: string) => notifications.show({ color: "blue", message: content }),
};

function parseUserIdFromDragId(value: string): string | null {
  if (!value.startsWith("member:")) return null;
  const userId = value.slice("member:".length).trim();
  return userId.length > 0 ? userId : null;
}

function resolveContainerFromOverId(
  overId: string | number | null | undefined,
  memberContainerMap: Map<string, string>,
): string | null {
  if (typeof overId !== "string") return null;
  if (overId.startsWith("container:")) return overId.slice("container:".length);
  if (overId.startsWith("member:")) return memberContainerMap.get(overId) ?? null;
  return null;
}

export function useGuildWarDragController({
  activeData,
  usersData,
  canManageActive,
  selectedEventId,
  activeController,
  roleTagMutation,
  guildWarService,
  showError,
}: UseGuildWarDragControllerParams) {
  const { t } = useTranslation("guild-war");

  const {
    selectedDragUserIds,
    setSelectedDragUserIds,
    selectionAnchorUserId,
    setSelectionAnchorUserId,
    activeDragItemId,
    setActiveDragItemId,
    undoMove,
    setUndoMove,
    teamDraftNames,
    setTeamDraftNames,
    teamDraftNotes,
    setTeamDraftNotes,
    teamDraftLocks,
    setTeamDraftLocks,
    activeDetailUserId,
    setActiveDetailUserId,
    moveTeamOrder,
  } = activeController;

  const dragData = useGuildWarDragData({
    activeData,
    usersData,
    poolLabel: t("active.pool"),
    draft: {
      teamDraftNames,
      setTeamDraftNames,
      setTeamDraftNotes,
      teamDraftLocks,
      setTeamDraftLocks,
      teamOrder: activeController.teamOrder,
      setTeamOrder: activeController.setTeamOrder,
    },
  });

  const {
    orderedTeams,
    teamById,
    memberTeamByUserId,
    allTeamMembers,
    userDataMap,
    lockedTeamIds,
    activeMemberDetailByUserId,
    dragColumns,
    memberContainerMap,
    dragItemMap,
    pool,
    draggableUserOrder,
    draggableUserOrderIndexMap,
  } = dragData;

  const search = useGuildWarSearch({
    activeSearch: activeController.activeSearch,
    searchJumpIndex: activeController.searchJumpIndex,
    setSearchJumpIndex: activeController.setSearchJumpIndex,
    selectedEventId,
    dragColumns,
  });

  const activeDragItem = activeDragItemId ? dragItemMap.get(activeDragItemId) ?? null : null;
  const selectedDragUserIdSet = useMemo(() => new Set(selectedDragUserIds), [selectedDragUserIds]);
  const activeDetail = activeDetailUserId ? activeMemberDetailByUserId.get(activeDetailUserId) ?? null : null;

  // --- Move / Undo ---

  const queueMoveWithUndo = useCallback((payloads: MovePayload[]) => {
    if (!canManageActive || payloads.length === 0) return;
    if (undoMove) {
      message.warning(t("message.moveQueueBusy"));
      return;
    }
    const firstPayload = payloads[0];
    if (!firstPayload) return;
    const normalizedMoves = payloads
      .map((p) => ({ userId: p.user_id, from: p.from ?? "unknown", to: p.to }))
      .filter((p) => p.from !== p.to);
    if (normalizedMoves.length === 0) return;
    setUndoMove({
      eventId: firstPayload.event_id,
      moves: normalizedMoves,
      etag: firstPayload.etag,
      expiresAt: Date.now() + 5_000,
    });
    if (normalizedMoves.length === 1) {
      const m = normalizedMoves[0];
      if (m) message.info(t("message.moveQueuedSingle", { userId: m.userId, from: m.from, to: m.to }));
      return;
    }
    message.info(t("message.moveQueuedMulti", { count: normalizedMoves.length }));
  }, [canManageActive, setUndoMove, t, undoMove]);

  const persistTeamSnapshot = useCallback(
    async (nextTeams: typeof orderedTeams) => {
      if (!selectedEventId) return;
      await guildWarService.persistTeamSnapshot({
        eventId: selectedEventId,
        teams: nextTeams,
        pool,
        teamDraftNames,
        teamDraftNotes,
        teamDraftLocks,
        etag: activeData?.etag ?? undefined,
      });
    },
    [activeData?.etag, guildWarService, pool, selectedEventId, teamDraftLocks, teamDraftNames, teamDraftNotes],
  );

  const handleBatchMove = useCallback(
    (moves: Array<{ userId: string; from: string; to: string }>) => {
      if (!selectedEventId) return;
      queueMoveWithUndo(
        moves.map((move) => ({
          event_id: selectedEventId,
          user_id: move.userId,
          from: move.from,
          to: move.to,
          etag: activeData?.etag ?? undefined,
        })),
      );
    },
    [activeData?.etag, queueMoveWithUndo, selectedEventId],
  );

  const handleCopyTeamMentions = (containerId: string) => {
    const team = teamById.get(containerId);
    if (!team) return;
    const members = team.members.map((m) => userDataMap.get(m.user_id)?.username ?? m.user_id);
    void copyPlainText(members.map((name) => `@${name}`).join(" "));
    message.success(t("active.teamCopied"));
  };

  const handleTeamSelectAll = (containerId: string) => {
    const team = teamById.get(containerId);
    if (!team) return;
    setSelectedDragUserIds(team.members.map((m) => m.user_id));
  };

  const handleTeamClear = (containerId: string) => {
    const team = teamById.get(containerId);
    if (!team) return;
    handleBatchMove(team.members.map((m) => ({ userId: m.user_id, from: containerId, to: "pool" })));
  };

  const handleMemberPinToTop = (userId: string) => {
    const currentTeam = memberTeamByUserId.get(userId);
    const member = currentTeam?.members.find((c) => c.user_id === userId);
    if (!currentTeam || !member) return;
    const nextTeams = orderedTeams.map((team) =>
      team.id === currentTeam.id
        ? { ...team, members: [member, ...team.members.filter((c) => c.user_id !== userId)] }
        : team,
    );
    void persistTeamSnapshot(nextTeams).catch((error) => {
      showError(error, t("message.memberMoveFailed"));
    });
  };

  const handleTeamDuplicate = (containerId: string) => {
    const team = teamById.get(containerId);
    const targetTeam = orderedTeams.find((c) => c.id !== containerId && c.members.length === 0);
    if (!team || !targetTeam || pool.length < team.members.length) return;
    const moves = team.members
      .map((_, i) => {
        const poolMember = pool[i];
        if (!poolMember) return null;
        return { userId: poolMember.userId, from: "pool", to: targetTeam.id };
      })
      .filter((m): m is { userId: string; from: string; to: string } => m !== null);
    handleBatchMove(moves);
  };

  const handleTeamSwap = (fromId: string, toId: string) => {
    const fromTeam = teamById.get(fromId);
    const toTeam = teamById.get(toId);
    if (!fromTeam || !toTeam) return;
    handleBatchMove([
      ...fromTeam.members.map((m) => ({ userId: m.user_id, from: fromId, to: "pool" })),
      ...toTeam.members.map((m) => ({ userId: m.user_id, from: toId, to: fromId })),
      ...fromTeam.members.map((m) => ({ userId: m.user_id, from: "pool", to: toId })),
    ]);
  };

  const handleMemberSwap = (userId: string, targetId: string) => {
    const memberTeam = memberTeamByUserId.get(userId);
    const targetTeam = memberTeamByUserId.get(targetId);
    if (!memberTeam || !targetTeam) return;
    handleBatchMove([
      { userId, from: memberTeam.id, to: "pool" },
      { userId: targetId, from: targetTeam.id, to: memberTeam.id },
      { userId, from: "pool", to: targetTeam.id },
    ]);
  };

  const handleSetCaptain = (userId: string) => {
    if (!selectedEventId) return;
    roleTagMutation.mutate({ event_id: selectedEventId, user_id: userId, role_tag: "Captain" });
  };

  const handleRemoveCaptain = (userId: string) => {
    const member = allTeamMembers.find((c) => c.user_id === userId);
    if (!member || !selectedEventId || member.role_tag !== "Captain") return;
    roleTagMutation.mutate({ event_id: selectedEventId, user_id: userId, role_tag: null });
  };

  const handleManageTags = (userId: string) => {
    setActiveDetailUserId(userId);
  };

  const handleViewHistory = (userId: string) => {
    setActiveDetailUserId(userId);
  };

  // --- Selection ---

  const handleSelectMember = (userId: string, event: MouseEvent<HTMLButtonElement>) => {
    if (!canManageActive) return;
    if (event.shiftKey) {
      setSelectedDragUserIds((current) => {
        const anchor = selectionAnchorUserId ?? current[current.length - 1] ?? userId;
        const anchorIndex = draggableUserOrderIndexMap.get(anchor);
        const targetIndex = draggableUserOrderIndexMap.get(userId);
        if (anchorIndex === undefined || targetIndex === undefined) {
          return event.metaKey || event.ctrlKey ? Array.from(new Set([...current, userId])) : [userId];
        }
        const rangeUserIds = draggableUserOrder.slice(
          Math.min(anchorIndex, targetIndex),
          Math.max(anchorIndex, targetIndex) + 1,
        );
        return event.metaKey || event.ctrlKey ? Array.from(new Set([...current, ...rangeUserIds])) : rangeUserIds;
      });
      setSelectionAnchorUserId(userId);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedDragUserIds((current) =>
        current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
      );
      setSelectionAnchorUserId(userId);
      return;
    }
    setSelectedDragUserIds([userId]);
    setSelectionAnchorUserId(userId);
  };

  // --- Drag Events ---

  const handleDragStart = (event: DragStartEvent) => {
    const nextActiveId = String(event.active.id);
    setActiveDragItemId(nextActiveId);
    const activeUserId = parseUserIdFromDragId(nextActiveId);
    if (activeUserId && !selectedDragUserIdSet.has(activeUserId)) {
      setSelectedDragUserIds([activeUserId]);
    }
  };

  const handleDragCancel = () => {
    setActiveDragItemId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragItemId(null);
    if (!canManageActive || !selectedEventId) return;

    const activeId = String(event.active.id);
    const sourceContainer = memberContainerMap.get(activeId);
    const targetContainer = resolveContainerFromOverId(event.over?.id, memberContainerMap);
    const userId = parseUserIdFromDragId(activeId);
    if (!sourceContainer || !targetContainer || !userId || sourceContainer === targetContainer) return;

    if (lockedTeamIds.has(targetContainer)) {
      message.warning("Target team is locked");
      return;
    }

    const movingUserIds = selectedDragUserIdSet.has(userId) ? selectedDragUserIds : [userId];
    const uniqueUserIds = Array.from(new Set(movingUserIds));

    if (uniqueUserIds.length <= 1) {
      queueMoveWithUndo([{
        event_id: selectedEventId,
        user_id: userId,
        to: targetContainer,
        from: sourceContainer,
        etag: activeData?.etag ?? undefined,
      }]);
      return;
    }

    queueMoveWithUndo(
      uniqueUserIds.map((uid) => ({
        event_id: selectedEventId,
        user_id: uid,
        to: targetContainer,
        from: memberContainerMap.get(`member:${uid}`),
        etag: activeData?.etag ?? undefined,
      })),
    );
  };

  // --- Team Status Panels (component-based, no longer JSX in hook) ---

  const teamStatusContentByContainerId = useMemo<Record<string, ReactNode>>(() => {
    if (!canManageActive) return {};
    const result: Record<string, ReactNode> = {};
    for (let i = 0; i < orderedTeams.length; i += 1) {
      const team = orderedTeams[i];
      if (!team) continue;
      result[team.id] = (
        <TeamStatusPanel
          key={team.id}
          team={team}
          teamIndex={i}
          totalTeams={orderedTeams.length}
          draftName={teamDraftNames[team.id] ?? team.team_name}
          draftNotes={teamDraftNotes[team.id] ?? team.notes ?? ""}
          draftLocked={teamDraftLocks[team.id] ?? team.is_locked}
          selectedEventId={selectedEventId}
          roleTagMutation={roleTagMutation}
          onDraftNameChange={(teamId, value) =>
            setTeamDraftNames((cur) => ({ ...cur, [teamId]: value }))
          }
          onDraftNotesChange={(teamId, value) =>
            setTeamDraftNotes((cur) => ({ ...cur, [teamId]: value }))
          }
          onDraftLockChange={(teamId, locked) =>
            setTeamDraftLocks((cur) => ({ ...cur, [teamId]: locked }))
          }
          onMoveTeamOrder={moveTeamOrder}
        />
      );
    }
    return result;
  }, [canManageActive, moveTeamOrder, orderedTeams, roleTagMutation, selectedEventId, setTeamDraftLocks, setTeamDraftNames, setTeamDraftNotes, teamDraftLocks, teamDraftNames, teamDraftNotes]);

  return {
    orderedTeams,
    allTeamMembers,
    userDataMap,
    teamDraftNames,
    activeDetail,
    activeDragItem,
    selectedDragUserIdSet,
    matchedItemIds: search.matchedItemIds,
    activeMatchIndex: search.activeMatchIndex,
    dragColumns,
    activePoolStatus: null as ReactNode,
    teamStatusContentByContainerId,
    toMemberDomId: search.toMemberDomId,
    handleCopyTeamMentions,
    handleTeamSelectAll,
    handleTeamClear,
    handleTeamDuplicate,
    handleTeamSwap,
    handleMemberPinToTop,
    handleMemberSwap,
    handleSetCaptain,
    handleRemoveCaptain,
    handleViewHistory,
    handleManageTags,
    handleSelectMember,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
  };
}

export type { DragMemberColumn };
