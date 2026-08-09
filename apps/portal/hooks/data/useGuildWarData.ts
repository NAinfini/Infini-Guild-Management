import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  fetchEventDetail,
  fetchEventsList,
} from "../../services/EventService";
import {
  fetchGuildWarActive,
  fetchGuildWarConcludedEventIds,
  fetchGuildWarHistory,
  fetchGuildWarHistoryDetail,
} from "../../services/GuildWarService";
import { queryKeys } from "../../api/query-keys";
import { useSiteConfigStore } from "@portal/stores/site-config";

type UseGuildWarDataOptions = {
  selectedEventId?: string;
  selectedHistoryId: string | null;
  historyDateFrom: string;
  historyDateTo: string;
  historySearch: string;
  historyPage: number;
  historyPerPage: number;
};

export function useGuildWarData(options: UseGuildWarDataOptions) {
  const { selectedEventId, selectedHistoryId, historyDateFrom, historyDateTo, historySearch, historyPage, historyPerPage } = options;
  const guildWarEventTypeId = useSiteConfigStore((state) =>
    state.gameRules.events.types.find((definition) => definition.behavior === "guild_war")?.id,
  );

  const warEventsQuery = useQuery({
    queryKey: [...queryKeys.guildWar.events(), guildWarEventTypeId ?? "missing"],
    queryFn: () =>
      fetchEventsList({
        page: 1,
        limit: 100,
        type: guildWarEventTypeId,
        archived: false,
      }),
    enabled: Boolean(guildWarEventTypeId),
    staleTime: 10 * 60_000,
  });

  const concludedEventIdsQuery = useQuery({
    queryKey: queryKeys.guildWar.concludedEventIds(),
    queryFn: () => fetchGuildWarConcludedEventIds(),
    staleTime: 10 * 60_000,
  });

  const activeEligibilityReady = warEventsQuery.isSuccess && concludedEventIdsQuery.isSuccess;
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

  const selectedEventDetailQuery = useQuery({
    queryKey: queryKeys.guildWar.eventDetail(activeSelectedEventId ?? null),
    enabled: Boolean(activeSelectedEventId),
    queryFn: () => fetchEventDetail(activeSelectedEventId as string),
    staleTime: 10 * 60_000,
  });

  const activeQuery = useQuery({
    queryKey: queryKeys.guildWar.active(activeSelectedEventId ?? null),
    queryFn: () => fetchGuildWarActive(activeSelectedEventId),
    enabled: Boolean(activeSelectedEventId),
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
        date_from: historyDateFrom ? `${historyDateFrom}T00:00:00.000Z` : undefined,
        date_to: historyDateTo ? `${historyDateTo}T23:59:59.999Z` : undefined,
        search: historySearch || undefined,
      }),
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });

  const historyDetailQuery = useQuery({
    queryKey: queryKeys.guildWar.historyDetail(selectedHistoryId),
    enabled: Boolean(selectedHistoryId),
    queryFn: () => fetchGuildWarHistoryDetail(selectedHistoryId as string),
    staleTime: 10 * 60_000,
  });

  return {
    warEventsQuery,
    concludedEventIdsQuery,
    activeEligibilityReady,
    eligibleWarEvents,
    activeSelectedEventId,
    selectedEventDetailQuery,
    activeQuery,
    historyQuery,
    historyDetailQuery,
  };
}
