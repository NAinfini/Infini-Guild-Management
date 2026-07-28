import { keepPreviousData, useQuery } from "@tanstack/react-query";
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

  const warEventsQuery = useQuery({
    queryKey: queryKeys.guildWar.events(),
    queryFn: () =>
      fetchEventsList({
        page: 1,
        limit: 100,
        type: "guild_war",
      }),
    staleTime: 10 * 60_000,
  });

  const concludedEventIdsQuery = useQuery({
    queryKey: queryKeys.guildWar.concludedEventIds(),
    queryFn: () => fetchGuildWarConcludedEventIds(),
    staleTime: 10 * 60_000,
  });

  const selectedEventDetailQuery = useQuery({
    queryKey: queryKeys.guildWar.eventDetail(selectedEventId ?? null),
    enabled: Boolean(selectedEventId),
    queryFn: () => fetchEventDetail(selectedEventId as string),
    staleTime: 10 * 60_000,
  });

  const activeQuery = useQuery({
    queryKey: queryKeys.guildWar.active(selectedEventId ?? null),
    queryFn: () => fetchGuildWarActive(selectedEventId),
    enabled: Boolean(selectedEventId),
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
    selectedEventDetailQuery,
    activeQuery,
    historyQuery,
    historyDetailQuery,
  };
}
