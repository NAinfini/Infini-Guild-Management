import { useQuery } from "@tanstack/react-query";
import {
  fetchEventDetail,
  fetchEventsList,
} from "../../services/EventService";
import {
  fetchGuildWarActive,
  fetchGuildWarHistory,
  fetchGuildWarHistoryDetail,
  fetchGuildWarTemplates,
} from "../../services/GuildWarService";
import { queryKeys } from "../../services/PortalQueryKeys";

type UseGuildWarDataOptions = {
  selectedEventId?: string;
  selectedHistoryId: string | null;
  historyDateFrom: string;
  historyDateTo: string;
};

export function useGuildWarData(options: UseGuildWarDataOptions) {
  const { selectedEventId, selectedHistoryId, historyDateFrom, historyDateTo } = options;

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
    enabled: Boolean(selectedEventId),
  });

  const templatesQuery = useQuery({
    queryKey: queryKeys.guildWar.templates(selectedEventId ?? "none"),
    queryFn: () => fetchGuildWarTemplates(selectedEventId),
    enabled: Boolean(selectedEventId),
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.guildWar.history(historyDateFrom || "none", historyDateTo || "none"),
    queryFn: () =>
      fetchGuildWarHistory({
        page: 1,
        limit: 50,
        date_from: historyDateFrom ? `${historyDateFrom}T00:00:00.000Z` : undefined,
        date_to: historyDateTo ? `${historyDateTo}T23:59:59.999Z` : undefined,
      }),
  });

  const historyDetailQuery = useQuery({
    queryKey: queryKeys.guildWar.historyDetail(selectedHistoryId),
    enabled: Boolean(selectedHistoryId),
    queryFn: () => fetchGuildWarHistoryDetail(selectedHistoryId as string),
  });

  return {
    warEventsQuery,
    selectedEventDetailQuery,
    activeQuery,
    templatesQuery,
    historyQuery,
    historyDetailQuery,
  };
}
