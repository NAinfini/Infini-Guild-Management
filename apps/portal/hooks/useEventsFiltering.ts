import type { Event, MemberProfile, User } from "@guild/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { useEventsData } from "./data/useEventsData";
import { fetchEventDetailBatch } from "../services/EventService";
import { queryKeys } from "../api/query-keys";
import { buildAvailabilityHeatData } from "../utils/availability";
import { sanitizeEventsRouteSearch, type EventStatusFilter, type EventsRouteSearch } from "../utils/event-navigation";
type MemberEntry = { user: User; profile: MemberProfile };

const EVENTS_LAST_SEEN_KEY = "events.last_seen_at";

type UseEventsFilteringParams = {
  currentUserId: string | undefined;
};

export function useEventsFiltering({ currentUserId }: UseEventsFilteringParams) {
  const { t } = useTranslation("events");
  const navigate = useNavigate();
  const routeSearch = useSearch({ strict: false }) as EventsRouteSearch;
  const eventType = routeSearch.type;
  const searchQuery = routeSearch.search ?? "";
  const eventStatus = routeSearch.status ?? "active";
  const archivedOnly = eventStatus === "archived";
  const pinnedOnly = routeSearch.pinned ?? false;
  const lockedOnly = routeSearch.locked ?? false;
  const focusEventId = routeSearch.eventId ?? null;
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);

  const updateSearch = useCallback(
    (updater: Partial<EventsRouteSearch> | ((prev: EventsRouteSearch) => Partial<EventsRouteSearch>)) => {
      void navigate({
        to: "/events",
        search: (prev) => {
          const nextPartial = typeof updater === "function" ? updater(prev as EventsRouteSearch) : updater;
          return sanitizeEventsRouteSearch({
            ...(prev as EventsRouteSearch),
            ...nextPartial,
          });
        },
        replace: true,
        resetScroll: false,
        viewTransition: false,
      });
    },
    [navigate],
  );

  const setEventType = useCallback((value: EventsRouteSearch["type"]) => {
    updateSearch({ type: value });
  }, [updateSearch]);

  const setSearchQuery = useCallback((value: string) => {
    updateSearch((prev) => ({
      search: value,
      eventId: prev.search?.trim() === value.trim() ? prev.eventId : undefined,
    }));
  }, [updateSearch]);

  const setArchivedOnly = useCallback((value: boolean) => {
    updateSearch({ status: value ? "archived" : undefined });
  }, [updateSearch]);

  const setEventStatus = useCallback((value: EventStatusFilter) => {
    updateSearch({ status: value === "active" ? undefined : value });
  }, [updateSearch]);

  const setPinnedOnly = useCallback((value: boolean) => {
    updateSearch({ pinned: value || undefined });
  }, [updateSearch]);

  const setLockedOnly = useCallback((value: boolean) => {
    updateSearch({ locked: value || undefined });
  }, [updateSearch]);

  const { eventsQuery, eventsQueryData, eventsHasMore, eventsLoadingMore, onLoadMoreEvents, usersQuery } = useEventsData({
    eventType,
    status: eventStatus,
    searchQuery,
    pinnedOnly,
    lockedOnly,
  });

  const events = eventsQueryData;
  const users = usersQuery.data?.data ?? [];

  const sortedEvents = useMemo(() => {
    return [...events].sort((left, right) => {
      if (focusEventId && left.id !== right.id) {
        if (left.id === focusEventId) {
          return -1;
        }
        if (right.id === focusEventId) {
          return 1;
        }
      }
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
      }
      return left.start_at.localeCompare(right.start_at);
    });
  }, [events, focusEventId]);

  const eventFlags = useMemo(() => {
    if (!lastSeenAt) {
      return new Map<string, "NEW" | "UPDATED">();
    }
    const lastSeenMs = Date.parse(lastSeenAt);
    if (!Number.isFinite(lastSeenMs)) {
      return new Map<string, "NEW" | "UPDATED">();
    }
    const flags = new Map<string, "NEW" | "UPDATED">();
    for (const event of events) {
      const createdMs = Date.parse(event.created_at);
      const updatedMs = Date.parse(event.updated_at);
      if (!Number.isFinite(updatedMs) || updatedMs <= lastSeenMs) {
        continue;
      }
      if (Number.isFinite(createdMs) && createdMs > lastSeenMs) {
        flags.set(event.id, "NEW");
      } else {
        flags.set(event.id, "UPDATED");
      }
    }
    return flags;
  }, [events, lastSeenAt]);

  const previewEventIds = useMemo(() => sortedEvents.map((event) => event.id), [sortedEvents]);
  const stableIdsKey = useMemo(() => [...previewEventIds].sort().join(","), [previewEventIds]);
  const eventPreviewDetailsQuery = useQuery({
    queryKey: queryKeys.events.previewDetailsByIds(stableIdsKey),
    enabled: previewEventIds.length > 0,
    queryFn: async () => {
      const response = await fetchEventDetailBatch(previewEventIds);
      return response.data;
    },
    staleTime: 30_000,
  });

  const eventMembersMap = useMemo(() => {
    const membersByEventId = new Map<string, MemberEntry[]>();
    const usersById = new Map(users.map((entry) => [entry.user.id, entry]));
    const details = eventPreviewDetailsQuery.data ?? [];
    for (const detail of details) {
      const members = detail.participants.flatMap((participant) => {
        const match = usersById.get(participant.user_id);
        return match ? [match] : [];
      });
      membersByEventId.set(detail.id, members);
    }
    return membersByEventId;
  }, [eventPreviewDetailsQuery.data, users]);

  const joinedEventRanges = useMemo(() => {
    if (!currentUserId) {
      return [] as Array<{ eventId: string; title: string; startMs: number; endMs: number }>;
    }

    const details = eventPreviewDetailsQuery.data ?? [];
    const ranges: Array<{ eventId: string; title: string; startMs: number; endMs: number }> = [];
    for (const detail of details) {
      if (!detail.participants.some((participant) => participant.user_id === currentUserId)) {
        continue;
      }
      const startMs = Date.parse(detail.start_at);
      const endMs = Date.parse(detail.end_at ?? detail.start_at);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        continue;
      }
      ranges.push({
        eventId: detail.id,
        title: detail.title,
        startMs,
        endMs,
      });
    }
    return ranges;
  }, [currentUserId, eventPreviewDetailsQuery.data]);

  const eventById = useMemo(() => new Map(sortedEvents.map((event) => [event.id, event])), [sortedEvents]);

  const eventsByDay = useMemo(() => {
    const byDay = new Map<string, Event[]>();
    for (const event of sortedEvents) {
      const key = format(new Date(event.start_at), "yyyy-MM-dd");
      const list = byDay.get(key) ?? [];
      list.push(event);
      byDay.set(key, list);
    }
    return byDay;
  }, [sortedEvents]);

  const availabilityHeatData = useMemo(() => buildAvailabilityHeatData(users), [users]);

  const hasAnyFilter =
    Boolean(eventType) || eventStatus !== "active" || pinnedOnly || lockedOnly || Boolean(searchQuery.trim());
  const cardsEmptyDescription = archivedOnly
    ? eventType
      ? t("empty.archivedFiltered")
      : t("empty.archived")
    : hasAnyFilter
      ? t("empty.filtered")
      : t("empty.default");

  const resetFilters = () => {
    updateSearch({
      search: undefined,
      type: undefined,
      status: undefined,
      pinned: undefined,
      locked: undefined,
      eventId: undefined,
    });
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(EVENTS_LAST_SEEN_KEY);
      if (raw && raw.trim()) {
        setLastSeenAt(raw);
      }
    } catch {
      // ignore storage parse errors
    }
    return () => {
      try {
        localStorage.setItem(EVENTS_LAST_SEEN_KEY, new Date().toISOString());
      } catch {
        // ignore storage write errors
      }
    };
  }, []);

  return {
    eventType,
    setEventType,
    eventStatus,
    setEventStatus,
    searchQuery,
    setSearchQuery,
    archivedOnly,
    setArchivedOnly,
    pinnedOnly,
    setPinnedOnly,
    lockedOnly,
    setLockedOnly,
    eventsQuery,
    usersQuery,
    previewDetailsQuery: eventPreviewDetailsQuery,
    sortedEvents,
    eventFlags,
    eventById,
    focusEventId,
    eventMembersMap,
    joinedEventRanges,
    eventsByDay,
    availabilityHeatData,
    cardsEmptyDescription,
    hasAnyFilter,
    resetFilters,
    eventsHasMore,
    eventsLoadingMore,
    onLoadMoreEvents,
  };
}
