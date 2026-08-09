import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { GuildWarActiveResponse } from "@guild/shared";
import { useTranslation } from "react-i18next";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useBeforeUnloadPrompt } from "../../../hooks/useBeforeUnloadPrompt";
import type { GuildWarService } from "../../../services/GuildWarService";

const AUTO_SAVE_DELAY_MS = 350;

function teamOrdersEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

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
  const [teamDraftNames, setTeamDraftNamesState] = useState<Record<string, string>>({});
  const [teamDraftNotes, setTeamDraftNotesState] = useState<Record<string, string>>({});
  const [teamDraftLocks, setTeamDraftLocksState] = useState<Record<string, boolean>>({});
  const [teamOrder, setTeamOrder] = useState<string[]>([]);
  const [draftBaselineRevision, setDraftBaselineRevision] = useState(0);
  const [activeSearch, setActiveSearch] = useState("");
  const [searchJumpIndex, setSearchJumpIndex] = useState(0);
  const [activeDetailUserId, setActiveDetailUserId] = useState<string | null>(null);
  const serverTeams = activeData?.teams ?? [];
  const serverPool = activeData?.pool ?? [];
  const serverTeamsRef = useRef(serverTeams);
  serverTeamsRef.current = serverTeams;
  const draftBaselinesRef = useRef({
    names: {} as Record<string, string>,
    notes: {} as Record<string, string>,
    locks: {} as Record<string, boolean>,
    order: null as string[] | null,
  });

  const setTeamDraftNames = useCallback<Dispatch<SetStateAction<Record<string, string>>>>((action) => {
    setTeamDraftNamesState((current) => {
      const next = typeof action === "function" ? action(current) : action;
      const teams = new Map(serverTeamsRef.current.map((team) => [team.id, team]));
      for (const id of new Set([...Object.keys(current), ...Object.keys(next)])) {
        if (!(id in next)) delete draftBaselinesRef.current.names[id];
        else if (!(id in draftBaselinesRef.current.names)) {
          draftBaselinesRef.current.names[id] = teams.get(id)?.team_name ?? "";
        }
      }
      return next;
    });
  }, []);

  const setTeamDraftNotes = useCallback<Dispatch<SetStateAction<Record<string, string>>>>((action) => {
    setTeamDraftNotesState((current) => {
      const next = typeof action === "function" ? action(current) : action;
      const teams = new Map(serverTeamsRef.current.map((team) => [team.id, team]));
      for (const id of new Set([...Object.keys(current), ...Object.keys(next)])) {
        if (!(id in next)) delete draftBaselinesRef.current.notes[id];
        else if (!(id in draftBaselinesRef.current.notes)) {
          draftBaselinesRef.current.notes[id] = teams.get(id)?.notes ?? "";
        }
      }
      return next;
    });
  }, []);

  const setTeamDraftLocks = useCallback<Dispatch<SetStateAction<Record<string, boolean>>>>((action) => {
    setTeamDraftLocksState((current) => {
      const next = typeof action === "function" ? action(current) : action;
      const teams = new Map(serverTeamsRef.current.map((team) => [team.id, team]));
      for (const id of new Set([...Object.keys(current), ...Object.keys(next)])) {
        if (!(id in next)) delete draftBaselinesRef.current.locks[id];
        else if (!(id in draftBaselinesRef.current.locks)) {
          draftBaselinesRef.current.locks[id] = teams.get(id)?.is_locked ?? false;
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setSearchJumpIndex(0);
    draftBaselinesRef.current = { names: {}, notes: {}, locks: {}, order: null };
    setTeamDraftNamesState({});
    setTeamDraftNotesState({});
    setTeamDraftLocksState({});
    setTeamOrder([]);
  }, [selectedEventId]);

  const moveTeamOrder = useCallback((teamId: string, direction: "up" | "down") => {
    setTeamOrder((current) => {
      const currentOrder = current.length > 0
        ? current
        : serverTeamsRef.current.map((team) => team.id);
      const fromIndex = currentOrder.indexOf(teamId);
      if (fromIndex < 0) {
        return current;
      }
      const delta = direction === "up" ? -1 : 1;
      const toIndex = fromIndex + delta;
      if (toIndex < 0 || toIndex >= currentOrder.length) {
        return current;
      }
      const next = [...currentOrder];
      const moved = next.splice(fromIndex, 1)[0]!;
      next.splice(toIndex, 0, moved);
      if (draftBaselinesRef.current.order === null) {
        draftBaselinesRef.current.order = serverTeamsRef.current.map((team) => team.id);
      }
      return next;
    });
  }, []);

  const isTeamsDirty = useMemo(() => {
    if (serverTeams.length === 0) return false;

    const orderBaseline = draftBaselinesRef.current.order;
    if (teamOrder.length > 0 && orderBaseline && !teamOrdersEqual(teamOrder, orderBaseline)) return true;

    for (const team of serverTeams) {
      const draftName = teamDraftNames[team.id];
      if (draftName !== undefined && draftName !== (draftBaselinesRef.current.names[team.id] ?? team.team_name)) return true;

      const draftNote = teamDraftNotes[team.id];
      const serverNote = team.notes ?? "";
      if (draftNote !== undefined && draftNote !== (draftBaselinesRef.current.notes[team.id] ?? serverNote)) return true;

      const draftLock = teamDraftLocks[team.id];
      if (draftLock !== undefined && draftLock !== (draftBaselinesRef.current.locks[team.id] ?? team.is_locked)) return true;
    }

    return false;
  }, [draftBaselineRevision, serverTeams, teamDraftLocks, teamDraftNames, teamDraftNotes, teamOrder]);

  const hasTeamDraftConflict = useMemo(() => {
    const serverOrder = serverTeams.map((team) => team.id);
    const orderBaseline = draftBaselinesRef.current.order;
    const hasOrderConflict = teamOrder.length > 0
      && orderBaseline !== null
      && !teamOrdersEqual(orderBaseline, serverOrder)
      && !teamOrdersEqual(teamOrder, serverOrder);

    return hasOrderConflict || serverTeams.some((team) => (
      (teamDraftNames[team.id] !== undefined
        && draftBaselinesRef.current.names[team.id] !== undefined
        && draftBaselinesRef.current.names[team.id] !== team.team_name
        && teamDraftNames[team.id] !== team.team_name)
      || (teamDraftNotes[team.id] !== undefined
        && draftBaselinesRef.current.notes[team.id] !== undefined
        && draftBaselinesRef.current.notes[team.id] !== (team.notes ?? "")
        && teamDraftNotes[team.id] !== (team.notes ?? ""))
      || (teamDraftLocks[team.id] !== undefined
        && draftBaselinesRef.current.locks[team.id] !== undefined
        && draftBaselinesRef.current.locks[team.id] !== team.is_locked
        && teamDraftLocks[team.id] !== team.is_locked)
    ));
  }, [draftBaselineRevision, serverTeams, teamDraftLocks, teamDraftNames, teamDraftNotes, teamOrder]);

  useBeforeUnloadPrompt(isTeamsDirty);

  const [saveTeamsPending, setSaveTeamsPending] = useState(false);
  const saveTeamsInFlightRef = useRef(false);

  const acceptRemoteTeamChanges = useCallback(() => {
    if (saveTeamsInFlightRef.current) return;
    draftBaselinesRef.current = { names: {}, notes: {}, locks: {}, order: null };
    setTeamDraftNamesState({});
    setTeamDraftNotesState({});
    setTeamDraftLocksState({});
    setTeamOrder([]);
  }, []);

  const retryLocalTeamChanges = useCallback(() => {
    if (saveTeamsInFlightRef.current) return;
    const teams = new Map(serverTeamsRef.current.map((team) => [team.id, team]));
    draftBaselinesRef.current = {
      names: Object.fromEntries(
        Object.keys(teamDraftNames).map((id) => [id, teams.get(id)?.team_name ?? ""]),
      ),
      notes: Object.fromEntries(
        Object.keys(teamDraftNotes).map((id) => [id, teams.get(id)?.notes ?? ""]),
      ),
      locks: Object.fromEntries(
        Object.keys(teamDraftLocks).map((id) => [id, teams.get(id)?.is_locked ?? false]),
      ),
      order: teamOrder.length > 0 ? serverTeamsRef.current.map((team) => team.id) : null,
    };
    setDraftBaselineRevision((current) => current + 1);
  }, [teamDraftLocks, teamDraftNames, teamDraftNotes, teamOrder.length]);

  const handleSaveTeams = useCallback(async () => {
    if (!selectedEventId || !isTeamsDirty || hasTeamDraftConflict || saveTeamsInFlightRef.current) return false;

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
      draftBaselinesRef.current = { names: {}, notes: {}, locks: {}, order: null };
      setTeamDraftNamesState({});
      setTeamDraftNotesState({});
      setTeamDraftLocksState({});
      setTeamOrder([]);
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
    hasTeamDraftConflict,
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
    if (!selectedEventId || !isTeamsDirty || hasTeamDraftConflict || saveTeamsInFlightRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void handleSaveTeams();
    }, AUTO_SAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [handleSaveTeams, hasTeamDraftConflict, isTeamsDirty, selectedEventId]);

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
    hasTeamDraftConflict,
    saveTeamsPending,
    acceptRemoteTeamChanges,
    retryLocalTeamChanges,
    confirmDiscardTeamsChanges,
  };
}
