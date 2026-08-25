import { GUILD_WAR_CAPTAIN_ROLE_TAG, type GuildWarActiveResponse } from "@guild/shared";
import { useQueryClient } from "@tanstack/react-query";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import type { UsersListResponse } from "../../services/UserService";
import {
  fetchGuildWarActive,
  GuildWarService,
  guildWarQueryKeys,
  moveGuildWarMember,
} from "../../services/GuildWarService";
import { copyPlainText } from "../../utils/copy";
import { notifySuccess, notifyWarning } from "../../utils/notifications";
import { useGuildWarDragData, type DragMemberColumn } from "./useGuildWarDragData";
import { useGuildWarSearch } from "./useGuildWarSearch";
import type { GuildWarTeamEditTarget } from "../../components/feature/guild-war/GuildWarTeamEditModal";

type MovePayload = {
  event_id: string;
  user_id: string;
  to: string;
  from?: string;
  etag?: string;
};

type ActiveControllerState = {
  activeDragItemId: string | null;
  setActiveDragItemId: Dispatch<SetStateAction<string | null>>;
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

function parseUserIdFromDragId(value: string): string | null {
  if (!value.startsWith("member:")) return null;
  const userId = value.slice("member:".length).trim();
  return userId.length > 0 ? userId : null;
}

/* 投放目标只有两种：某一列，或回收区。成员行不是 droppable，落在行上命中的也是它所在的列。 */
function resolveContainerFromOverId(overId: string | number | null | undefined): string | null {
  if (typeof overId !== "string") return null;
  if (overId === "trash-zone") return "remove";
  if (overId.startsWith("container:")) return overId.slice("container:".length);
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
  const confirm = useConfirmDialog();
  const queryClient = useQueryClient();
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);

  const {
    activeDragItemId,
    setActiveDragItemId,
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
  } = dragData;

  const search = useGuildWarSearch({
    activeSearch: activeController.activeSearch,
    searchJumpIndex: activeController.searchJumpIndex,
    setSearchJumpIndex: activeController.setSearchJumpIndex,
    selectedEventId,
    dragColumns,
  });

  const activeDragItem = activeDragItemId ? dragItemMap.get(activeDragItemId) ?? null : null;
  const activeDetail = activeDetailUserId ? activeMemberDetailByUserId.get(activeDetailUserId) ?? null : null;

  // Member and team mutations share one server snapshot and ETag.

  const resolveTeamName = useCallback((containerId: string) => {
    if (containerId === "pool") return t("active.pool");
    if (containerId === "remove") return t("active.removed");
    const team = teamById.get(containerId);
    return (teamDraftNames[containerId] ?? team?.team_name ?? containerId).trim() || containerId;
  }, [teamById, teamDraftNames, t]);

  const resolveUsername = useCallback((userId: string) => {
    return userDataMap.get(userId)?.display_name ?? userId;
  }, [userDataMap]);

  const applyMove = useCallback((payloads: MovePayload[]) => {
    if (!canManageActive || payloads.length === 0) return;
    const firstPayload = payloads[0];
    if (!firstPayload) return;
    const normalizedMoves = payloads
      .map((p) => ({ userId: p.user_id, from: p.from ?? "unknown", to: p.to }))
      .filter((p) => p.from !== p.to);
    if (normalizedMoves.length === 0) return;

    const eventId = firstPayload.event_id;
    const etag = firstPayload.etag ?? activeData?.etag ?? undefined;

    const commitMoves = async () => {
      try {
        await moveGuildWarMember({
          event_id: eventId,
          moves: normalizedMoves.map((move) => ({ user_id: move.userId, to: move.to })),
          etag,
        });
        await queryClient.invalidateQueries({
          queryKey: guildWarQueryKeys.active(selectedEventId ?? null),
        });
        notifySuccess(
          normalizedMoves.length === 1
            ? t("message.memberMoved")
            : t("message.membersMoved", { count: normalizedMoves.length }),
        );
      } catch (error) {
        showError(
          error,
          normalizedMoves.length > 1 ? t("message.batchMoveCommitFailed") : t("message.memberMoveFailed"),
        );
      }
    };
    void commitMoves();
  }, [activeData?.etag, canManageActive, queryClient, selectedEventId, showError, t]);

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
      applyMove(
        moves.map((move) => ({
          event_id: selectedEventId,
          user_id: move.userId,
          from: move.from,
          to: move.to,
          etag: activeData?.etag ?? undefined,
        })),
      );
    },
    [activeData?.etag, applyMove, selectedEventId],
  );

  const handleCopyTeamMentions = (containerId: string) => {
    const column = dragColumns.find((c) => c.containerId === containerId);
    if (!column) return;
    void copyPlainText(column.members.map((m) => `@${m.display_name}`).join(" "));
    notifySuccess(t("active.teamCopied"));
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

  const handleAddTeam = () => {
    const tempId = `new:${Date.now()}`;
    const teamName = t("active.newTeamName", { number: orderedTeams.length + 1 });
    const newTeam = {
      id: tempId,
      war_history_id: null,
      event_id: selectedEventId ?? null,
      team_name: teamName,
      sort_order: orderedTeams.length,
      notes: "",
      is_locked: false,
      members: [] as typeof orderedTeams[number]["members"],
    };
    const nextTeams = [...orderedTeams, newTeam];
    setTeamDraftNames((cur) => ({ ...cur, [tempId]: teamName }));
    void persistTeamSnapshot(nextTeams).catch((error) => {
      showError(error, t("message.addTeamFailed"));
    });
  };

  const handleDeleteTeam = useCallback((containerId: string) => {
    const team = teamById.get(containerId);
    if (!team) return;

    void (async () => {
      const confirmed = await confirm({
        title: t("active.deleteTeamConfirm.title"),
        description: t("active.deleteTeamConfirm.desc", {
          teamName: resolveTeamName(containerId),
        }),
        confirmLabel: t("active.deleteTeamConfirm.confirm"),
        cancelLabel: t("common:action.cancel"),
        intent: "danger",
      });
      if (!confirmed) return;

      if (!selectedEventId) return;
      try {
        let snapshot = activeData;
        if (team.members.length > 0) {
          await moveGuildWarMember({
            event_id: selectedEventId,
            moves: team.members.map((member) => ({ user_id: member.user_id, to: "pool" })),
            etag: activeData?.etag ?? undefined,
          });
          snapshot = await fetchGuildWarActive(selectedEventId);
          queryClient.setQueryData(guildWarQueryKeys.active(selectedEventId), snapshot);
        }
        if (!snapshot) return;
        const nextTeams = snapshot.teams
          .filter((candidate) => candidate.id !== containerId)
          .map((candidate, index) => ({ ...candidate, sort_order: index }));
        await guildWarService.persistTeamSnapshot({
          eventId: selectedEventId,
          teams: nextTeams,
          pool: snapshot.pool,
          teamDraftNames,
          teamDraftNotes,
          teamDraftLocks,
          etag: snapshot.etag ?? undefined,
        });
      } catch (error) {
        await queryClient.invalidateQueries({ queryKey: guildWarQueryKeys.active(selectedEventId) });
        showError(error, t("message.deleteTeamFailed"));
      }
    })();
  }, [
    activeData,
    confirm,
    guildWarService,
    queryClient,
    resolveTeamName,
    selectedEventId,
    showError,
    t,
    teamById,
    teamDraftLocks,
    teamDraftNames,
    teamDraftNotes,
  ]);

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
    roleTagMutation.mutate({ event_id: selectedEventId, user_id: userId, role_tag: GUILD_WAR_CAPTAIN_ROLE_TAG });
  };

  const handleRemoveCaptain = (userId: string) => {
    const member = allTeamMembers.find((c) => c.user_id === userId);
    if (!member || !selectedEventId || member.role_tag !== GUILD_WAR_CAPTAIN_ROLE_TAG) return;
    roleTagMutation.mutate({ event_id: selectedEventId, user_id: userId, role_tag: null });
  };

  const handleManageTags = (userId: string) => {
    setActiveDetailUserId(userId);
  };

  const handleViewHistory = (userId: string) => {
    setActiveDetailUserId(userId);
  };

  // Drag-and-drop lifecycle

  const handleDragStart = (event: DragStartEvent) => {
    const nextActiveId = String(event.active.id);
    setActiveDragItemId(nextActiveId);
  };

  const handleDragCancel = () => {
    setActiveDragItemId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragItemId(null);
    if (!canManageActive || !selectedEventId) return;

    const activeId = String(event.active.id);
    const sourceContainer = memberContainerMap.get(activeId);
    const targetContainer = resolveContainerFromOverId(event.over?.id);
    const userId = parseUserIdFromDragId(activeId);
    if (!sourceContainer || !targetContainer || !userId || sourceContainer === targetContainer) return;

    if (lockedTeamIds.has(targetContainer)) {
      notifyWarning(t("message.targetTeamLocked"));
      return;
    }

    if (targetContainer === "remove") {
      const payload = {
        event_id: selectedEventId,
        user_id: userId,
        to: "remove" as const,
        from: sourceContainer,
        etag: activeData?.etag ?? undefined,
      };
      void (async () => {
        const confirmed = await confirm({
          title: t("active.removeConfirm.title"),
          description: t("active.removeConfirm.descSingle", {
            display_name: resolveUsername(userId),
          }),
          confirmLabel: t("active.removeConfirm.confirm"),
          cancelLabel: t("common:action.cancel"),
          intent: "danger",
        });
        if (confirmed) {
          applyMove([payload]);
        }
      })();
      return;
    }

    applyMove([{
      event_id: selectedEventId,
      user_id: userId,
      to: targetContainer,
      from: sourceContainer,
      etag: activeData?.etag ?? undefined,
    }]);
  };

  // Team details editor: name and notes, opened from the column head.

  const teamEditorTarget = useMemo<GuildWarTeamEditTarget | null>(() => {
    if (!canManageActive || !editingTeamId) return null;
    const team = orderedTeams.find((entry) => entry.id === editingTeamId);
    if (!team) return null;
    return {
      containerId: team.id,
      name: teamDraftNames[team.id] ?? team.team_name,
      notes: teamDraftNotes[team.id] ?? team.notes ?? "",
      locked: teamDraftLocks[team.id] ?? team.is_locked,
    };
  }, [canManageActive, editingTeamId, orderedTeams, teamDraftLocks, teamDraftNames, teamDraftNotes]);

  const handleDraftNotesChange = useCallback((containerId: string, value: string) => {
    setTeamDraftNotes((cur) => ({ ...cur, [containerId]: value }));
  }, [setTeamDraftNotes]);

  const closeTeamEditor = useCallback(() => setEditingTeamId(null), []);

  const handleToggleLock = useCallback((containerId: string) => {
    setTeamDraftLocks((cur) => ({ ...cur, [containerId]: !cur[containerId] }));
  }, [setTeamDraftLocks]);

  const handleDraftNameChange = useCallback((containerId: string, value: string) => {
    setTeamDraftNames((cur) => ({ ...cur, [containerId]: value }));
  }, [setTeamDraftNames]);

  const teamIndexMap = useMemo(
    () => new Map(orderedTeams.map((team, i) => [team.id, i])),
    [orderedTeams],
  );

  const handleRemoveFromWar = useCallback(
    (userId: string) => {
      if (!selectedEventId || !canManageActive) return;
      applyMove([{
        event_id: selectedEventId,
        user_id: userId,
        to: "remove",
        from: memberContainerMap.get(`member:${userId}`) ?? "pool",
        etag: activeData?.etag ?? undefined,
      }]);
    },
    [activeData?.etag, canManageActive, memberContainerMap, applyMove, selectedEventId],
  );

  return {
    orderedTeams,
    allTeamMembers,
    userDataMap,
    teamDraftNames,
    activeDetail,
    activeDragItem,
    matchedItemIds: search.matchedItemIds,
    activeMatchIndex: search.activeMatchIndex,
    dragColumns,
    teamEditorTarget,
    toMemberDomId: search.toMemberDomId,
    memberContainerMap,
    handleCopyTeamMentions,
    handleTeamClear,
    handleTeamDuplicate,
    handleTeamSwap,
    handleAddTeam,
    handleDeleteTeam,
    handleMemberPinToTop,
    handleMemberSwap,
    handleSetCaptain,
    handleRemoveCaptain,
    handleViewHistory,
    handleManageTags,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
    handleToggleLock,
    handleDraftNameChange,
    handleDraftNotesChange,
    handleEditTeam: setEditingTeamId,
    handleCloseTeamEditor: closeTeamEditor,
    handleMoveTeamOrder: moveTeamOrder,
    handleRemoveFromWar,
    lockedTeamIds,
    teamIndexMap,
    teamCount: orderedTeams.length,
    resolveTeamName,
    resolveUsername,
  };
}

export type { DragMemberColumn };
