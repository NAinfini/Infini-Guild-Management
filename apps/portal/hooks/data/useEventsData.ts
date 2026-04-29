import { useQuery } from "@tanstack/react-query";
import { fetchEventsList } from "../../services/EventService";
import { queryKeys } from "../../api/query-keys";
import { fetchUsersList } from "../../services/UserService";
import { useEffect, useRef, useState } from "react";
import type { Event } from "@guild/shared";

const PAGE_LIMIT = 50;

type UseEventsDataOptions = {
  eventType?: string;
  archivedOnly: boolean;
};

export function useEventsData(options: UseEventsDataOptions) {
  const { eventType, archivedOnly } = options;

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
   
  }, [eventType, archivedOnly]);

  const eventsQuery = useQuery({
    queryKey: queryKeys.events.list(eventType ?? "all", archivedOnly, eventsPage),
    queryFn: () =>
      fetchEventsList({
        page: eventsPage,
        limit: PAGE_LIMIT,
        type: eventType,
        archived: archivedOnly,
      }),
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
    queryKey: queryKeys.events.memberPreviewUsers(),
    queryFn: fetchUsersList,
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
