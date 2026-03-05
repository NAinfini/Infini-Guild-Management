import { useCallback, useEffect, useState } from "react";

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
};

export function useGuildWarActiveController({ selectedEventId }: UseGuildWarActiveControllerParams) {
  const [selectedDragUserIds, setSelectedDragUserIds] = useState<string[]>([]);
  const [selectionAnchorUserId, setSelectionAnchorUserId] = useState<string | null>(null);
  const [activeDragItemId, setActiveDragItemId] = useState<string | null>(null);
  const [undoMove, setUndoMove] = useState<UndoMove | null>(null);
  const [undoRemainingSec, setUndoRemainingSec] = useState(0);
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

  return {
    selectedDragUserIds,
    setSelectedDragUserIds,
    selectionAnchorUserId,
    setSelectionAnchorUserId,
    activeDragItemId,
    setActiveDragItemId,
    undoMove,
    setUndoMove,
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
  };
}
