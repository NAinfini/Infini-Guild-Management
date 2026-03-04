import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../api/query-keys";
import { fetchEventsList } from "../../api/queries/events";
import { fetchUsersList } from "../../api/queries/users";

type UseEventsDataOptions = {
  eventType?: string;
  archivedOnly: boolean;
};

export function useEventsData(options: UseEventsDataOptions) {
  const { eventType, archivedOnly } = options;

  const eventsQuery = useQuery({
    queryKey: queryKeys.events.list(eventType ?? "all", archivedOnly),
    queryFn: () =>
      fetchEventsList({
        page: 1,
        limit: 100,
        type: eventType,
        archived: archivedOnly,
      }),
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.events.memberPreviewUsers(),
    queryFn: fetchUsersList,
  });

  return {
    eventsQuery,
    usersQuery,
  };
}

