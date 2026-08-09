import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { fetchEventsList } from "../../services/EventService";
import { queryKeys } from "../../api/query-keys";
import { fetchAllUsersListWithOptions } from "../../services/UserService";
import type { EventStatusFilter } from "../../utils/event-navigation";
import { viewerIdentity } from "../../session-storage";
import { useAuthStore } from "../../stores/auth";

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
  const viewerKey = useAuthStore((state) => viewerIdentity(state.user?.id));

  const eventsQuery = useInfiniteQuery({
    queryKey: [
      ...queryKeys.events.all,
      "infinite",
      viewerKey,
      eventType ?? "all",
      status,
      normalizedSearch,
      pinnedOnly,
      lockedOnly,
    ],
    queryFn: ({ pageParam }) =>
      fetchEventsList({
        page: pageParam,
        limit: PAGE_LIMIT,
        type: eventType,
        archived: toArchivedParam(status),
        search: normalizedSearch || undefined,
        pinned: pinnedOnly ? true : undefined,
        locked: lockedOnly ? true : undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const totalFetched = allPages.reduce(
        (sum, page) => sum + page.data.length,
        0,
      );
      return totalFetched < lastPage.total ? allPages.length + 1 : undefined;
    },
    staleTime: 10 * 60_000,
  });

  const accumulatedEvents =
    eventsQuery.data?.pages.flatMap((page) => page.data) ?? [];

  const usersQuery = useQuery({
    queryKey: [...queryKeys.users.all, viewerKey],
    queryFn: () => fetchAllUsersListWithOptions(),
    staleTime: 10 * 60_000,
  });

  return {
    eventsQuery,
    eventsQueryData: accumulatedEvents,
    eventsHasMore: eventsQuery.hasNextPage ?? false,
    eventsLoadingMore: eventsQuery.isFetchingNextPage,
    onLoadMoreEvents: () => eventsQuery.fetchNextPage(),
    usersQuery,
  };
}
