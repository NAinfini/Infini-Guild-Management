import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuildWarActiveResponse } from "@guild/shared";
import { useBeforeUnloadPrompt } from "../../../hooks/useBeforeUnloadPrompt";
import type { GuildWarService } from "../../../services/GuildWarService";

export type UndoMove = {
  eventId: string;
  moves: Array<{
    userId: string;
    from: string;
    to: string;
  }>;
  etag?: string;
  expiresAt: number;
};

type UseGuildWarActiveControllerParams = {
  selectedEventId: string | undefined;
  activeData: GuildWarActiveResponse | undefined;
  guildWarService: GuildWarService;
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useGuildWarActiveController({ selectedEventId, activeData, guildWarService, showError }: UseGuildWarActiveControllerParams) {
  const [selectedDragUserIds, setSelectedDragUserIds] = useState<string[]>([]);
  const [selectionAnchorUserId, setSelectionAnchorUserId] = useState<string | null>(null);
  const [activeDragItemId, setActiveDragItemId] = useState<string | null>(null);
  const [undoMove, setUndoMove] = useState<UndoMove | null>(null);
  const [undoRemainingSec, setUndoRemainingSec] = useState(0);
  const commitTimeoutRef = useRef<number | null>(null);

  const clearCommitTimeout = useCallback(() => {
    if (commitTimeoutRef.current !== null) {
      window.clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = null;
    }
  }, []);

  const wrappedSetUndoMove = useCallback((value: UndoMove | null) => {
    if (!value) {
      clearCommitTimeout();
    }
    setUndoMove(value);
  }, [clearCommitTimeout]);
  const [teamDraftNames, setTeamDraftNames] = useState<Record<string, string>>({});
  const [teamDraftNotes, setTeamDraftNotes] = useState<Record<string, string>>({});
  const [teamDraftLocks, setTeamDraftLocks] = useState<Record<string, boolean>>({});
  const [teamOrder, setTeamOrder] = useState<string[]>([]);
  const [activeSearch, setActiveSearch] = useState("");
  const [searchJumpIndex, setSearchJumpIndex] = useState(0);
  const [activeDetailUserId, setActiveDetailUserId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedDragUserIds([]);
    setSelectionAnchorUserId(null);
    setSearchJumpIndex(0);
    setTeamDraftNames({});
    setTeamDraftNotes({});
    setTeamDraftLocks({});
    setTeamOrder([]);
  }, [selectedEventId]);

  useEffect(() => {
    if (!undoMove) {
      setUndoRemainingSec(0);
      return;
    }

    const update = () => {
      const nextSeconds = Math.max(0, Math.ceil((undoMove.expiresAt - Date.now()) / 1000));
      setUndoRemainingSec(nextSeconds);
    };

    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [undoMove]);

  const moveTeamOrder = useCallback((teamId: string, direction: "up" | "down") => {
    setTeamOrder((current) => {
      const fromIndex = current.indexOf(teamId);
      if (fromIndex < 0) {
        return current;
      }
      const delta = direction === "up" ? -1 : 1;
      const toIndex = fromIndex + delta;
      if (toIndex < 0 || toIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const serverTeams = activeData?.teams ?? [];
  const serverPool = activeData?.pool ?? [];

  const isTeamsDirty = useMemo(() => {
    if (serverTeams.length === 0) return false;

    // Check team order
    const serverOrder = serverTeams.map((t) => t.id);
    if (teamOrder.length > 0 && teamOrder.join(",") !== serverOrder.join(",")) return true;

    // Check names, notes, locks
    for (const team of serverTeams) {
      const draftName = teamDraftNames[team.id];
      if (draftName !== undefined && draftName !== team.team_name) return true;

      const draftNote = teamDraftNotes[team.id];
      const serverNote = team.notes ?? "";
      if (draftNote !== undefined && draftNote !== serverNote) return true;

      const draftLock = teamDraftLocks[team.id];
      if (draftLock !== undefined && draftLock !== team.is_locked) return true;
    }

    return false;
  }, [serverTeams, teamDraftLocks, teamDraftNames, teamDraftNotes, teamOrder]);

  useBeforeUnloadPrompt(isTeamsDirty);

  const [saveTeamsPending, setSaveTeamsPending] = useState(false);

  const handleSaveTeams = useCallback(async () => {
    if (!selectedEventId || !isTeamsDirty) return;

    // Build ordered teams from current draft state
    const orderedTeamIds = teamOrder.length > 0 ? teamOrder : serverTeams.map((t) => t.id);
    const teamById = new Map(serverTeams.map((t) => [t.id, t]));
    const teams = orderedTeamIds
      .map((id) => teamById.get(id))
      .filter((t): t is GuildWarActiveResponse["teams"][number] => Boolean(t));

    setSaveTeamsPending(true);
    try {
      await guildWarService.persistTeamSnapshot({
        eventId: selectedEventId,
        teams,
        pool: serverPool,
        teamDraftNames,
        teamDraftNotes,
        teamDraftLocks,
      });
    } catch (error) {
      showError(error, "Failed to save team setup");
    } finally {
      setSaveTeamsPending(false);
    }
  }, [guildWarService, isTeamsDirty, selectedEventId, serverPool, serverTeams, showError, teamDraftLocks, teamDraftNames, teamDraftNotes, teamOrder]);

  return {
    selectedDragUserIds,
    setSelectedDragUserIds,
    selectionAnchorUserId,
    setSelectionAnchorUserId,
    activeDragItemId,
    setActiveDragItemId,
    undoMove,
    setUndoMove: wrappedSetUndoMove,
    commitTimeoutRef,
    undoRemainingSec,
    teamDraftNames,
    setTeamDraftNames,
    teamDraftNotes,
    setTeamDraftNotes,
    teamDraftLocks,
    setTeamDraftLocks,
    teamOrder,
    setTeamOrder,
    activeSearch,
    setActiveSearch,
    searchJumpIndex,
    setSearchJumpIndex,
    activeDetailUserId,
    setActiveDetailUserId,
    moveTeamOrder,
    isTeamsDirty,
    saveTeamsPending,
    handleSaveTeams,
  };
}
