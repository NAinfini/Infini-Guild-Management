import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuildWarActiveResponse } from "@guild/shared";
import { useTranslation } from "react-i18next";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useBeforeUnloadPrompt } from "../../../hooks/useBeforeUnloadPrompt";
import type { GuildWarService } from "../../../services/GuildWarService";

const AUTO_SAVE_DELAY_MS = 350;

type UseGuildWarActiveControllerParams = {
  selectedEventId: string | undefined;
  activeData: GuildWarActiveResponse | undefined;
  guildWarService: GuildWarService;
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useGuildWarActiveController({
  selectedEventId,
  activeData,
  guildWarService,
  showError,
}: UseGuildWarActiveControllerParams) {
  const { t } = useTranslation("guild-war");
  const confirm = useConfirmDialog();
  const [activeDragItemId, setActiveDragItemId] = useState<string | null>(null);
  const [teamDraftNames, setTeamDraftNames] = useState<Record<string, string>>({});
  const [teamDraftNotes, setTeamDraftNotes] = useState<Record<string, string>>({});
  const [teamDraftLocks, setTeamDraftLocks] = useState<Record<string, boolean>>({});
  const [teamOrder, setTeamOrder] = useState<string[]>([]);
  const [activeSearch, setActiveSearch] = useState("");
  const [searchJumpIndex, setSearchJumpIndex] = useState(0);
  const [activeDetailUserId, setActiveDetailUserId] = useState<string | null>(null);

  useEffect(() => {
    setSearchJumpIndex(0);
    setTeamDraftNames({});
    setTeamDraftNotes({});
    setTeamDraftLocks({});
    setTeamOrder([]);
  }, [selectedEventId]);

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
      const moved = next.splice(fromIndex, 1)[0]!;
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
  const saveTeamsInFlightRef = useRef(false);

  const handleSaveTeams = useCallback(async () => {
    if (!selectedEventId || !isTeamsDirty || saveTeamsInFlightRef.current) return false;

    // Build ordered teams from current draft state
    const orderedTeamIds = teamOrder.length > 0 ? teamOrder : serverTeams.map((t) => t.id);
    const teamById = new Map(serverTeams.map((t) => [t.id, t]));
    const teams = orderedTeamIds
      .map((id) => teamById.get(id))
      .filter((t): t is GuildWarActiveResponse["teams"][number] => Boolean(t));

    saveTeamsInFlightRef.current = true;
    setSaveTeamsPending(true);
    try {
      await guildWarService.persistTeamSnapshot({
        eventId: selectedEventId,
        teams,
        pool: serverPool,
        teamDraftNames,
        teamDraftNotes,
        teamDraftLocks,
        etag: activeData?.etag ?? undefined,
      });
      return true;
    } catch (error) {
      showError(error, t("message.teamsSaveFailed"));
      return false;
    } finally {
      saveTeamsInFlightRef.current = false;
      setSaveTeamsPending(false);
    }
  }, [
    activeData?.etag,
    guildWarService,
    isTeamsDirty,
    selectedEventId,
    serverPool,
    serverTeams,
    showError,
    t,
    teamDraftLocks,
    teamDraftNames,
    teamDraftNotes,
    teamOrder,
  ]);

  useEffect(() => {
    if (!selectedEventId || !isTeamsDirty || saveTeamsInFlightRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void handleSaveTeams();
    }, AUTO_SAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [handleSaveTeams, isTeamsDirty, selectedEventId]);

  const confirmDiscardTeamsChanges = useCallback(async () => {
    if (!isTeamsDirty) return true;
    if (saveTeamsInFlightRef.current) return false;
    return confirm({
      title: t("active.unsavedSwitchTitle"),
      description: t("active.unsavedSwitchDescription"),
      confirmLabel: t("active.discardChanges"),
      cancelLabel: t("common:action.cancel"),
      intent: "warning",
    });
  }, [confirm, isTeamsDirty, t]);

  return {
    activeDragItemId,
    setActiveDragItemId,
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
    confirmDiscardTeamsChanges,
  };
}
