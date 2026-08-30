import { useQuery } from "@tanstack/react-query";
import { DEFAULT_GAME_RULES } from "@guild/shared";
import { useMemo } from "react";
import {
  fetchEventsList,
} from "../../services/EventService";
import {
  fetchGuildWarActive,
  fetchGuildWarConcludedEventIds,
  fetchGuildWarHistory,
  fetchGuildWarHistoryDetail,
} from "../../services/GuildWarService";
import { queryKeys } from "../../api/query-keys";
import { localDayEndIso, localDayStartIso } from "../../utils/datetime";

type UseGuildWarDataOptions = {
  tab: "active" | "history" | "analytics";
  selectedEventId?: string;
  selectedHistoryId: string | null;
  historyDateFrom: string;
  historyDateTo: string;
  historySearch: string;
  historyPage: number;
  historyPerPage: number;
};

export function useGuildWarData(options: UseGuildWarDataOptions) {
  const {
    tab,
    selectedEventId,
    selectedHistoryId,
    historyDateFrom,
    historyDateTo,
    historySearch,
    historyPage,
    historyPerPage,
  } = options;
  const activeEnabled = tab === "active";
  const historyEnabled = tab !== "active";
  const guildWarEventTypeId = DEFAULT_GAME_RULES.events.types
    .find((definition) => definition.behavior === "guild_war")?.id;

  const warEventsQuery = useQuery({
    queryKey: [...queryKeys.guildWar.events(), guildWarEventTypeId ?? "missing"],
    queryFn: () =>
      fetchEventsList({
        page: 1,
        limit: 100,
        type: guildWarEventTypeId,
        archived: false,
      }),
    enabled: activeEnabled && Boolean(guildWarEventTypeId),
    staleTime: 10 * 60_000,
  });

  const concludedEventIdsQuery = useQuery({
    queryKey: queryKeys.guildWar.concludedEventIds(),
    queryFn: () => fetchGuildWarConcludedEventIds(),
    enabled: activeEnabled,
    staleTime: 10 * 60_000,
  });

  const activeEligibilityReady = activeEnabled && warEventsQuery.isSuccess && concludedEventIdsQuery.isSuccess;
  const eligibleWarEvents = useMemo(() => {
    if (!activeEligibilityReady) return [];
    const concludedIds = new Set(concludedEventIdsQuery.data?.data ?? []);
    return (warEventsQuery.data?.data ?? []).filter(
      (event) => event.archived_at === null && !concludedIds.has(event.id),
    );
  }, [
    activeEligibilityReady,
    concludedEventIdsQuery.data,
    warEventsQuery.data,
  ]);
  const activeSelectedEventId = selectedEventId
    && eligibleWarEvents.some((event) => event.id === selectedEventId)
    ? selectedEventId
    : undefined;

  const activeQuery = useQuery({
    queryKey: queryKeys.guildWar.active(activeSelectedEventId ?? null),
    queryFn: () => fetchGuildWarActive(activeSelectedEventId),
    enabled: activeEnabled && Boolean(activeSelectedEventId),
    staleTime: 10 * 60_000,
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.guildWar.history(
      historyDateFrom || "none",
      historyDateTo || "none",
      historySearch || "none",
      historyPage,
      historyPerPage,
    ),
    queryFn: () =>
      fetchGuildWarHistory({
        page: historyPage,
        limit: historyPerPage,
        date_from: localDayStartIso(historyDateFrom),
        date_to: localDayEndIso(historyDateTo),
        search: historySearch || undefined,
      }),
    enabled: historyEnabled,
    staleTime: 10 * 60_000,
  });

  const historyDetailQuery = useQuery({
    queryKey: queryKeys.guildWar.historyDetail(selectedHistoryId),
    enabled: tab === "history" && Boolean(selectedHistoryId),
    queryFn: () => fetchGuildWarHistoryDetail(selectedHistoryId as string),
    staleTime: 10 * 60_000,
  });

  return {
    warEventsQuery,
    concludedEventIdsQuery,
    activeEligibilityReady,
    eligibleWarEvents,
    activeSelectedEventId,
    activeQuery,
    historyQuery,
    historyDetailQuery,
  };
}
