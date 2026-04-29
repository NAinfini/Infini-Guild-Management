import { useQuery } from "@tanstack/react-query";
import {
  fetchEventDetail,
  fetchEventsList,
} from "../../services/EventService";
import {
  fetchGuildWarActive,
  fetchGuildWarHistory,
  fetchGuildWarHistoryDetail,
} from "../../services/GuildWarService";
import { queryKeys } from "../../api/query-keys";

type UseGuildWarDataOptions = {
  selectedEventId?: string;
  selectedHistoryId: string | null;
  historyDateFrom: string;
  historyDateTo: string;
  historyPage: number;
  historyPerPage: number;
  hasSession?: boolean;
};

export function useGuildWarData(options: UseGuildWarDataOptions) {
  const { selectedEventId, selectedHistoryId, historyDateFrom, historyDateTo, historyPage, historyPerPage, hasSession = true } = options;

  const warEventsQuery = useQuery({
    queryKey: queryKeys.guildWar.events(),
    queryFn: () =>
      fetchEventsList({
        page: 1,
        limit: 100,
        type: "guild_war",
        archived: false,
      }),
  });

  const selectedEventDetailQuery = useQuery({
    queryKey: queryKeys.guildWar.eventDetail(selectedEventId ?? null),
    enabled: Boolean(selectedEventId),
    queryFn: () => fetchEventDetail(selectedEventId as string),
  });

  const activeQuery = useQuery({
    queryKey: queryKeys.guildWar.active(selectedEventId ?? "none"),
    queryFn: () => fetchGuildWarActive(selectedEventId),
    enabled: hasSession && Boolean(selectedEventId),
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.guildWar.history(historyDateFrom || "none", historyDateTo || "none", historyPage, historyPerPage),
    queryFn: () =>
      fetchGuildWarHistory({
        page: historyPage,
        limit: historyPerPage,
        date_from: historyDateFrom ? `${historyDateFrom}T00:00:00.000Z` : undefined,
        date_to: historyDateTo ? `${historyDateTo}T23:59:59.999Z` : undefined,
      }),
    enabled: hasSession,
  });

  const historyDetailQuery = useQuery({
    queryKey: queryKeys.guildWar.historyDetail(selectedHistoryId),
    enabled: hasSession && Boolean(selectedHistoryId),
    queryFn: () => fetchGuildWarHistoryDetail(selectedHistoryId as string),
  });

  return {
    warEventsQuery,
    selectedEventDetailQuery,
    activeQuery,
    historyQuery,
    historyDetailQuery,
  };
}
