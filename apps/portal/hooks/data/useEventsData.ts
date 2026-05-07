import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchEventsList } from "../../services/EventService";
import { queryKeys } from "../../api/query-keys";
import { fetchUsersList } from "../../services/UserService";
import { useEffect, useRef, useState } from "react";
import type { Event } from "@guild/shared";
import type { EventStatusFilter } from "../../utils/event-navigation";

const PAGE_LIMIT = 50;

type UseEventsDataOptions = {
  eventType?: string;
  status: EventStatusFilter;
  searchQuery: string;
  pinnedOnly: boolean;
  lockedOnly: boolean;
};

function toArchivedParam(status: EventStatusFilter): boolean | undefined {
  if (status === "active") return false;
  if (status === "archived") return true;
  return undefined;
}

export function useEventsData(options: UseEventsDataOptions) {
  const { eventType, status, searchQuery, pinnedOnly, lockedOnly } = options;
  const normalizedSearch = searchQuery.trim();

  const [eventsPage, setEventsPage] = useState(1);
  const accumulatedEventsRef = useRef<Event[]>([]);
  const [accumulatedEvents, setAccumulatedEvents] = useState<Event[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);

  // Reset accumulated events when filter params change
  useEffect(() => {
    accumulatedEventsRef.current = [];
    setAccumulatedEvents([]);
    setEventsTotal(0);
    setEventsPage(1);
   
  }, [eventType, status, normalizedSearch, pinnedOnly, lockedOnly]);

  const eventsQuery = useQuery({
    queryKey: queryKeys.events.list({
      eventType: eventType ?? "all",
      status,
      search: normalizedSearch,
      pinnedOnly,
      lockedOnly,
      page: eventsPage,
    }),
    queryFn: () =>
      fetchEventsList({
        page: eventsPage,
        limit: PAGE_LIMIT,
        type: eventType,
        archived: toArchivedParam(status),
        search: normalizedSearch || undefined,
        pinned: pinnedOnly ? true : undefined,
        locked: lockedOnly ? true : undefined,
      }),
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });

  // Accumulate events across pages
  useEffect(() => {
    if (!eventsQuery.data || eventsQuery.isFetching) return;
    const newItems = eventsQuery.data.data;
    if (eventsPage === 1) {
      accumulatedEventsRef.current = newItems;
    } else {
      const existingIds = new Set(accumulatedEventsRef.current.map((item) => item.id));
      const deduplicated = newItems.filter((item) => !existingIds.has(item.id));
      accumulatedEventsRef.current = [...accumulatedEventsRef.current, ...deduplicated];
    }
    setAccumulatedEvents([...accumulatedEventsRef.current]);
    setEventsTotal(eventsQuery.data.total);
  }, [eventsQuery.data, eventsQuery.isFetching, eventsPage]);

  const eventsHasMore = accumulatedEvents.length < eventsTotal;

  const usersQuery = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: fetchUsersList,
    staleTime: 10 * 60_000,
  });

  return {
    eventsQuery,
    eventsQueryData: accumulatedEvents,
    eventsHasMore,
    eventsLoadingMore: eventsQuery.isFetching && eventsPage > 1,
    onLoadMoreEvents: () => setEventsPage((p) => p + 1),
    usersQuery,
  };
}
