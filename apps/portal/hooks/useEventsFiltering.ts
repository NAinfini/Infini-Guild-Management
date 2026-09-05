import type { Event, MemberDirectoryEntry } from "@guild/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { localDateKey } from "../utils/datetime";
import { useEventsData } from "./data/useEventsData";
import { useMemberAvailabilitySummary, useMemberDirectory } from "./data/useMemberDirectory";
import { fetchEventDetailBatch } from "../services/EventService";
import { queryKeys } from "../api/query-keys";
import { buildAvailabilityHeatDataFromSummary } from "../utils/availability";
import {
  sanitizeEventsRouteSearch,
  type EventStatusFilter,
  type EventsRouteSearch,
} from "../utils/event-navigation";
import { userScopedStorageKey } from "../session-storage";
type MemberEntry = MemberDirectoryEntry;

const EVENTS_LAST_SEEN_KEY = "events.last_seen_at";

type UseEventsFilteringParams = {
  currentUserId: string | undefined;
  externalView?: boolean;
};

export function useEventsFiltering({ currentUserId, externalView = false }: UseEventsFilteringParams) {
  const { t } = useTranslation("events");
  const navigate = useNavigate();
  const routeSearch = useSearch({ strict: false }) as EventsRouteSearch;
  const eventType = routeSearch.type;
  const searchQuery = routeSearch.search ?? "";
  const eventStatus = routeSearch.status ?? "active";
  const archivedOnly = eventStatus === "archived";
  const pinnedOnly = routeSearch.pinned ?? false;
  const lockedOnly = routeSearch.locked ?? false;
  const selectedDateKey = routeSearch.date;
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const lastSeenStorageKey = userScopedStorageKey(EVENTS_LAST_SEEN_KEY, currentUserId);

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
    updateSearch({ search: value });
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

  const setSelectedDate = useCallback((value: string | undefined) => {
    updateSearch({ date: value });
  }, [updateSearch]);

  const { eventsQuery, eventsQueryData, eventsHasMore, eventsLoadingMore, onLoadMoreEvents } = useEventsData({
    eventType,
    status: eventStatus,
    searchQuery,
    pinnedOnly,
    lockedOnly,
  });

  const events = eventsQueryData;

  const sortedEvents = useMemo(() => {
    return [...events].sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
      }
      return left.start_at.localeCompare(right.start_at);
    });
  }, [events]);

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

  const eventDetails = useMemo(() => {
    return eventPreviewDetailsQuery.data ?? [];
  }, [eventPreviewDetailsQuery.data]);

  const previewMemberIds = useMemo(() => [...new Set(eventDetails.flatMap((detail) => [
    ...detail.participants.map((participant) => participant.user_id),
    ...(detail.poll?.options.flatMap((option) => option.voter_ids) ?? []),
    ...(detail.raffle_winners?.map((winner) => winner.user_id) ?? []),
  ]))], [eventDetails]);
  const memberDirectory = useMemberDirectory({
    currentUserId,
    publicMemberProjection: externalView || !currentUserId,
    enabled: false,
    selectedIds: previewMemberIds,
  });
  const users = memberDirectory.entries;
  const availabilitySummaryQuery = useMemberAvailabilitySummary({
    currentUserId,
    enabled: Boolean(currentUserId) && !externalView,
  });
  const canUseAvailabilitySummary = Boolean(currentUserId) && !externalView;

  const eventMembersMap = useMemo(() => {
    const membersByEventId = new Map<string, MemberEntry[]>();
    const usersById = new Map(users.map((entry) => [entry.user.id, entry]));
    for (const detail of eventDetails) {
      const members = detail.participants.flatMap((participant) => {
        const match = usersById.get(participant.user_id);
        return match ? [match] : [];
      });
      membersByEventId.set(detail.id, members);
    }
    return membersByEventId;
  }, [eventDetails, users]);

  const joinedEventRanges = useMemo(() => {
    if (!currentUserId) {
      return [] as Array<{ eventId: string; title: string; startMs: number; endMs: number }>;
    }

    const ranges: Array<{ eventId: string; title: string; startMs: number; endMs: number }> = [];
    for (const detail of eventDetails) {
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
  }, [currentUserId, eventDetails]);

  const eventById = useMemo(() => new Map(sortedEvents.map((event) => [event.id, event])), [sortedEvents]);
  const eventsByDay = useMemo(() => {
    const byDay = new Map<string, Event[]>();
    for (const event of sortedEvents) {
      const key = localDateKey(event.start_at);
      const list = byDay.get(key) ?? [];
      list.push(event);
      byDay.set(key, list);
    }
    return byDay;
  }, [sortedEvents]);

  const availabilityHeatData = useMemo(
    () => buildAvailabilityHeatDataFromSummary(
      canUseAvailabilitySummary ? availabilitySummaryQuery.data : undefined,
    ),
    [availabilitySummaryQuery.data, canUseAvailabilitySummary],
  );

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
      date: undefined,
    });
  };

  useEffect(() => {
    setLastSeenAt(null);
    try {
      const raw = localStorage.getItem(lastSeenStorageKey);
      if (raw && raw.trim()) {
        setLastSeenAt(raw);
      }
    } catch {
      // ignore storage parse errors
    }
    return () => {
      try {
        localStorage.setItem(lastSeenStorageKey, new Date().toISOString());
      } catch {
        // ignore storage write errors
      }
    };
  }, [lastSeenStorageKey]);

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
    selectedDateKey,
    setSelectedDate,
    eventsQuery,
    users,
    memberDirectory,
    availabilitySummaryQuery,
    availabilitySummaryError: canUseAvailabilitySummary && availabilitySummaryQuery.isError,
    previewDetailsQuery: eventPreviewDetailsQuery,
    sortedEvents,
    eventFlags,
    eventById,
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
