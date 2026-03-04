import type { Event, MemberProfile, User } from "@guild/shared";
import { hasRoleAtLeast } from "@guild/shared";
import { notifications } from "@mantine/notifications";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Suspense,
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { archiveEvent, createEvent, joinEvent, leaveEvent, updateEvent, uploadEventImages } from "../../api/mutations/events";
import { queryKeys } from "../../api/query-keys";
import { fetchEventDetail } from "../../api/queries/events";
import { usePageHeaderActions } from "../../context/PageHeaderContext";
import { useCopy } from "../../hooks/useCopy";
import { useAppError } from "../../hooks/useAppError";
import { useEventsData } from "../../hooks/data/useEventsData";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useMediaUpload } from "../../hooks/useMediaUpload";
import { portalConfirm } from "../../overlays";
import { useAuthStore } from "../../stores/auth";
import { useEventsEditorController } from "../feature/events/useEventsEditorController";
import { PageLayout } from "../layout/PageLayout";
import "./EventsPage.css";

const LazyEventsFiltersCard = lazy(() =>
  import("../feature/events/EventsFiltersCard").then((mod) => ({ default: mod.EventsFiltersCard })),
);
const LazyEventCardsView = lazy(() =>
  import("../feature/events/EventCardsView").then((mod) => ({ default: mod.EventCardsView })),
);
const LazyEventCalendarView = lazy(() =>
  import("../feature/events/EventCalendarView").then((mod) => ({ default: mod.EventCalendarView })),
);
const LazyEventFormModal = lazy(() =>
  import("../feature/events/EventFormModal").then((mod) => ({ default: mod.EventFormModal })),
);

type EventDetailPayload = Awaited<ReturnType<typeof fetchEventDetail>>;

type AvailabilityMinuteRange = {
  startMinutes: number;
  endMinutes: number;
};

type AvailabilityHeatData = {
  hourlyByDay: Map<number, number[]>;
  dayPeakByDay: Map<number, number>;
  daysWithAny: Set<number>;
  maxCount: number;
  memberCount: number;
};

const MODERN_AVAILABILITY_DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const LEGACY_AVAILABILITY_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const EVENT_VIEW_MODES = ["cards", "month"] as const;
const EVENTS_VIEW_MODE_KEY = "events.viewMode";
const EVENTS_LAST_SEEN_KEY = "events.last_seen_at";

type EventViewMode = (typeof EVENT_VIEW_MODES)[number];

function readEventViewMode(): EventViewMode {
  try {
    const stored = localStorage.getItem(EVENTS_VIEW_MODE_KEY);
    if (stored && EVENT_VIEW_MODES.includes(stored as EventViewMode)) {
      return stored as EventViewMode;
    }
  } catch {
    // ignore storage read errors
  }
  return "cards";
}

function createEmptyHourlyCounts() {
  return Array.from({ length: 24 }, () => 0);
}

function parseUtcMinutes(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1] ?? "", 10);
  const minutes = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function pushAvailabilityRange(
  rangesByDay: Map<number, AvailabilityMinuteRange[]>,
  dayIndex: number,
  startMinutes: number,
  endMinutes: number,
) {
  if (startMinutes === endMinutes) {
    return;
  }

  const current = rangesByDay.get(dayIndex) ?? [];
  const nextDayIndex = (dayIndex + 1) % 7;
  const nextDay = rangesByDay.get(nextDayIndex) ?? [];

  if (startMinutes < endMinutes) {
    current.push({ startMinutes, endMinutes });
    rangesByDay.set(dayIndex, current);
    return;
  }

  current.push({ startMinutes, endMinutes: 24 * 60 });
  nextDay.push({ startMinutes: 0, endMinutes });
  rangesByDay.set(dayIndex, current);
  rangesByDay.set(nextDayIndex, nextDay);
}

function parseAvailabilityRanges(rawAvailability: unknown): Map<number, AvailabilityMinuteRange[]> {
  const rangesByDay = new Map<number, AvailabilityMinuteRange[]>();
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    rangesByDay.set(dayIndex, []);
  }

  if (!rawAvailability || typeof rawAvailability !== "object") {
    return rangesByDay;
  }

  const record = rawAvailability as Record<string, unknown>;
  const daysObject =
    record.days && typeof record.days === "object" && !Array.isArray(record.days)
      ? (record.days as Record<string, unknown>)
      : null;

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const modernKey = MODERN_AVAILABILITY_DAY_KEYS[dayIndex];
    const legacyKey = LEGACY_AVAILABILITY_DAY_KEYS[dayIndex];
    const rowsCandidate =
      (daysObject ? daysObject[modernKey] : undefined) ?? record[modernKey] ?? record[legacyKey];
    if (!Array.isArray(rowsCandidate)) {
      continue;
    }

    for (const row of rowsCandidate) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const item = row as Record<string, unknown>;
      const startMinutes = parseUtcMinutes(item.start_utc);
      const endMinutes = parseUtcMinutes(item.end_utc);
      if (startMinutes === null || endMinutes === null) {
        continue;
      }
      pushAvailabilityRange(rangesByDay, dayIndex, startMinutes, endMinutes);
    }
  }

  return rangesByDay;
}

function buildAvailabilityHeatData(users: Array<{ user: User; profile: MemberProfile }>): AvailabilityHeatData {
  const hourlyByDay = new Map<number, number[]>();
  const dayPeakByDay = new Map<number, number>();
  const daysWithAny = new Set<number>();
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    hourlyByDay.set(dayIndex, createEmptyHourlyCounts());
    dayPeakByDay.set(dayIndex, 0);
  }

  let memberCount = 0;
  for (const entry of users) {
    if (!entry.user.is_active || entry.user.deleted_at !== null) {
      continue;
    }
    const rangesByDay = parseAvailabilityRanges(entry.profile.availability);
    const hasAnyAvailability = Array.from(rangesByDay.values()).some((ranges) => ranges.length > 0);
    if (!hasAnyAvailability) {
      continue;
    }
    memberCount += 1;

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const ranges = rangesByDay.get(dayIndex) ?? [];
      if (ranges.length === 0) {
        continue;
      }
      const hourlyCounts = hourlyByDay.get(dayIndex) ?? createEmptyHourlyCounts();
      for (const range of ranges) {
        for (let hour = 0; hour < 24; hour += 1) {
          const hourStart = hour * 60;
          const hourEnd = hourStart + 60;
          if (range.startMinutes < hourEnd && hourStart < range.endMinutes) {
            hourlyCounts[hour] = (hourlyCounts[hour] ?? 0) + 1;
          }
        }
      }
      hourlyByDay.set(dayIndex, hourlyCounts);
    }
  }

  let maxCount = 0;
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const counts = hourlyByDay.get(dayIndex) ?? [];
    const peak = counts.reduce((currentMax, value) => Math.max(currentMax, value), 0);
    dayPeakByDay.set(dayIndex, peak);
    if (peak > 0) {
      daysWithAny.add(dayIndex);
    }
    maxCount = Math.max(maxCount, peak);
  }

  return {
    hourlyByDay,
    dayPeakByDay,
    daysWithAny,
    maxCount,
    memberCount,
  };
}

export function EventsPage() {
  const { t } = useTranslation("events");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { copyMentionList } = useCopy();
  const { showError } = useAppError();
  const user = useAuthStore((state) => state.user);
  const isExternalView = useExternalView();
  const isModerator = Boolean(user && hasRoleAtLeast(user.role, "moderator"));
  const canManage = isModerator && !isExternalView;
  const canInteract = Boolean(user) && !isExternalView;

  const [eventType, setEventType] = useState<string | undefined>(undefined);
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [viewMode, setViewMode] = useState<EventViewMode>(() => readEventViewMode());
  const [, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showAvailabilityOverlay, setShowAvailabilityOverlay] = useState(false);

  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);

  const { eventsQuery, usersQuery } = useEventsData({
    eventType,
    archivedOnly,
  });
  const events = eventsQuery.data?.data ?? [];
  const sortedEvents = useMemo(
    () => [...events].sort((left, right) => left.start_at.localeCompare(right.start_at)),
    [events],
  );
  const {
    editorOpen,
    editorMode,
    editingEventId,
    editorType,
    editorTitle,
    editorDescription,
    editorStartAt,
    editorEndAt,
    editorCapacity,
    editorPinned,
    editorSignupLocked,
    editorRecurrenceEnabled,
    editorRecurrenceFreq,
    editorRecurrenceInterval,
    editorRecurrenceDays,
    editorAttachments,
    editorRecurrenceApplyTo,
    editorStartIso,
    editorEndIso,
    recurrencePayload,
    conflictingEvents,
    setEditorType,
    setEditorTitle,
    setEditorDescription,
    setEditorStartAt,
    setEditorEndAt,
    setEditorCapacity,
    setEditorPinned,
    setEditorSignupLocked,
    setEditorRecurrenceEnabled,
    setEditorRecurrenceFreq,
    setEditorRecurrenceInterval,
    setEditorRecurrenceDays,
    setEditorAttachments,
    setEditorRecurrenceApplyTo,
    openCreateEditor: openCreateEditorBase,
    openEditEditor: openEditEditorBase,
    closeEditor: closeEditorBase,
    closeEditorAfterSave,
  } = useEventsEditorController({ sortedEvents });

  const eventAttachmentUploader = useMediaUpload(
    async (files) => {
      if (!editingEventId) {
        throw new Error("Save event first before uploading images");
      }
      return uploadEventImages(editingEventId, files);
    },
    {
      maxFiles: 5,
      maxFileSizeBytes: 5 * 1024 * 1024,
      mediaType: "image",
      convertImagesToWebp: true,
      imageWebpQuality: 0.8,
    },
  );

  const joinMutation = useMutation({
    mutationFn: (eventId: string) => joinEvent(eventId),
    onMutate: async (eventId) => {
      if (!user) {
        return undefined;
      }
      await queryClient.cancelQueries({ queryKey: queryKeys.events.previewDetails() });
      await queryClient.cancelQueries({ queryKey: queryKeys.event.detail(eventId) });

      const previousPreview = queryClient.getQueriesData<EventDetailPayload[]>({
        queryKey: queryKeys.events.previewDetails(),
      });
      const previousDetail = queryClient.getQueryData<EventDetailPayload>(queryKeys.event.detail(eventId));
      const optimisticParticipant = {
        id: `optimistic-${eventId}-${user.id}`,
        event_id: eventId,
        user_id: user.id,
        joined_at: new Date().toISOString(),
      };

      for (const [key] of previousPreview) {
        queryClient.setQueryData<EventDetailPayload[]>(key, (current) =>
          current?.map((detail) => {
            if (detail.id !== eventId) {
              return detail;
            }
            if (detail.participants.some((participant) => participant.user_id === user.id)) {
              return detail;
            }
            return {
              ...detail,
              participants: [...detail.participants, optimisticParticipant],
            };
          }) ?? current,
        );
      }

      queryClient.setQueryData<EventDetailPayload>(["event", eventId], (current) => {
        if (!current) {
          return current;
        }
        if (current.participants.some((participant) => participant.user_id === user.id)) {
          return current;
        }
        return {
          ...current,
          participants: [...current.participants, optimisticParticipant],
        };
      });

      return { previousPreview, previousDetail };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      notifications.show({ color: "green", message: "Joined event" });
    },
    onError: (error, eventId, context) => {
      if (context) {
        for (const [key, previous] of context.previousPreview) {
          queryClient.setQueryData(key, previous);
        }
        queryClient.setQueryData(["event", eventId], context.previousDetail);
      }
      showError(error, "Join failed");
    },
    onSettled: async (_, __, eventId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.event.detail(eventId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.previewDetails() });
    },
  });

  const leaveMutation = useMutation({
    mutationFn: (eventId: string) => leaveEvent(eventId),
    onMutate: async (eventId) => {
      if (!user) {
        return undefined;
      }
      await queryClient.cancelQueries({ queryKey: queryKeys.events.previewDetails() });
      await queryClient.cancelQueries({ queryKey: queryKeys.event.detail(eventId) });

      const previousPreview = queryClient.getQueriesData<EventDetailPayload[]>({
        queryKey: queryKeys.events.previewDetails(),
      });
      const previousDetail = queryClient.getQueryData<EventDetailPayload>(queryKeys.event.detail(eventId));

      for (const [key] of previousPreview) {
        queryClient.setQueryData<EventDetailPayload[]>(key, (current) =>
          current?.map((detail) =>
            detail.id === eventId
              ? {
                  ...detail,
                  participants: detail.participants.filter((participant) => participant.user_id !== user.id),
                }
              : detail,
          ) ?? current,
        );
      }

      queryClient.setQueryData<EventDetailPayload>(["event", eventId], (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          participants: current.participants.filter((participant) => participant.user_id !== user.id),
        };
      });

      return { previousPreview, previousDetail };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      notifications.show({ color: "green", message: "Left event" });
    },
    onError: (error, eventId, context) => {
      if (context) {
        for (const [key, previous] of context.previousPreview) {
          queryClient.setQueryData(key, previous);
        }
        queryClient.setQueryData(["event", eventId], context.previousDetail);
      }
      showError(error, "Leave failed");
    },
    onSettled: async (_, __, eventId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.event.detail(eventId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.previewDetails() });
    },
  });

  const createEventMutation = useMutation({
    mutationFn: createEvent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      notifications.show({ color: "green", message: "Event created" });
      closeEditorAfterSave();
      eventAttachmentUploader.reset();
    },
    onError: (error) => {
      showError(error, "Failed to create event");
    },
  });

  const updateEventMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateEvent>[1] }) =>
      updateEvent(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      notifications.show({ color: "green", message: "Event updated" });
      closeEditorAfterSave();
      eventAttachmentUploader.reset();
    },
    onError: (error) => {
      showError(error, "Failed to update event");
    },
  });

  const archiveEventMutation = useMutation({
    mutationFn: (eventId: string) => archiveEvent(eventId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      notifications.show({ color: "green", message: "Event archived" });
    },
    onError: (error) => {
      showError(error, "Failed to archive event");
    },
  });

  const eventFlags = useMemo(() => {
    if (!lastSeenAt) {
      return new Map<string, "NEW" | "UPDATED">();
    }
    const lastSeenMs = Date.parse(lastSeenAt);
    if (!Number.isFinite(lastSeenMs)) {
      return new Map<string, "NEW" | "UPDATED">();
    }
    const map = new Map<string, "NEW" | "UPDATED">();
    for (const event of events) {
      const createdMs = Date.parse(event.created_at);
      const updatedMs = Date.parse(event.updated_at);
      if (!Number.isFinite(updatedMs) || updatedMs <= lastSeenMs) {
        continue;
      }
      if (Number.isFinite(createdMs) && createdMs > lastSeenMs) {
        map.set(event.id, "NEW");
      } else {
        map.set(event.id, "UPDATED");
      }
    }
    return map;
  }, [events, lastSeenAt]);
  const eventById = useMemo(() => new Map(sortedEvents.map((event) => [event.id, event])), [sortedEvents]);
  const previewEventIds = useMemo(() => sortedEvents.map((event) => event.id), [sortedEvents]);
  const eventPreviewDetailsQuery = useQuery({
    queryKey: queryKeys.events.previewDetailsByIds(previewEventIds.join(",")),
    enabled: previewEventIds.length > 0,
    queryFn: async () => Promise.all(previewEventIds.map((eventId) => fetchEventDetail(eventId))),
  });
  const eventMembersMap = useMemo(() => {
    const map = new Map<string, Array<{ user: User; profile: MemberProfile }>>();
    const users = usersQuery.data?.data ?? [];
    const usersById = new Map(users.map((entry) => [entry.user.id, entry]));
    const details = eventPreviewDetailsQuery.data ?? [];
    for (const detail of details) {
      const participants = detail.participants.flatMap((participant) => {
        const member = usersById.get(participant.user_id);
        return member ? [member] : [];
      });
      map.set(detail.id, participants);
    }
    return map;
  }, [eventPreviewDetailsQuery.data, usersQuery.data?.data]);
  const joinedEventRanges = useMemo(() => {
    if (!user) {
      return [] as Array<{ eventId: string; title: string; startMs: number; endMs: number }>;
    }
    const details = eventPreviewDetailsQuery.data ?? [];
    const ranges: Array<{ eventId: string; title: string; startMs: number; endMs: number }> = [];
    for (const detail of details) {
      if (!detail.participants.some((participant) => participant.user_id === user.id)) {
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
  }, [eventPreviewDetailsQuery.data, user]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const event of sortedEvents) {
      const key = event.start_at.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [sortedEvents]);

  const availabilityHeatData = useMemo(
    () => buildAvailabilityHeatData(usersQuery.data?.data ?? []),
    [usersQuery.data?.data],
  );

  const openCreateEditor = useCallback((initialDateKey?: string) => {
    eventAttachmentUploader.reset();
    openCreateEditorBase(initialDateKey);
  }, [eventAttachmentUploader, openCreateEditorBase]);

  const openEditEditor = useCallback((event: Event) => {
    eventAttachmentUploader.reset();
    openEditEditorBase(event);
  }, [eventAttachmentUploader, openEditEditorBase]);

  const handleCloseEditor = async () => {
    const didClose = await closeEditorBase();
    if (didClose) {
      eventAttachmentUploader.reset();
    }
  };

  const handleJoin = async (eventId: string) => {
    if (!canInteract) {
      if (!user) {
        void navigate({
          to: "/login",
          search: { returnTo: "/events", reason: "required" },
        });
      }
      return;
    }
    if (!user) {
      void navigate({
        to: "/login",
        search: { returnTo: "/events", reason: "required" },
      });
      return;
    }
    const target = eventById.get(eventId);
    if (!target) {
      joinMutation.mutate(eventId);
      return;
    }
    const targetStart = Date.parse(target.start_at);
    const targetEnd = Date.parse(target.end_at ?? target.start_at);
    if (!Number.isFinite(targetStart) || !Number.isFinite(targetEnd)) {
      joinMutation.mutate(eventId);
      return;
    }

    const conflicts = joinedEventRanges.filter(
      (item) => item.eventId !== eventId && targetStart < item.endMs && item.startMs < targetEnd,
    );
    if (conflicts.length > 0) {
      const shouldJoin = await portalConfirm({
        title: t("confirm.timeConflict.title"),
        description: t("confirm.timeConflict.description", {
          titles: conflicts.slice(0, 3).map((item) => item.title).join(", "),
        }),
        intent: "warning",
      });
      if (shouldJoin) {
        joinMutation.mutate(eventId);
      }
      return;
    }

    joinMutation.mutate(eventId);
  };

  const handleLeave = (eventId: string) => {
    if (!user || !canInteract) {
      return;
    }
    leaveMutation.mutate(eventId);
  };

  const handleUploadEventAttachments = async () => {
    if (!editingEventId) {
      showError(new Error("Save event first before uploading images"), "Save event first before uploading images");
      return;
    }
    const uploaded = await eventAttachmentUploader.upload();
    if (!uploaded) {
      return;
    }
    setEditorAttachments(uploaded.attachments ?? []);
    await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.event.detail(editingEventId) });
    eventAttachmentUploader.reset();
    notifications.show({ color: "green", message: "Attachments uploaded" });
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

  useEffect(() => {
    try {
      localStorage.setItem(EVENTS_VIEW_MODE_KEY, viewMode);
    } catch {
      // ignore storage write errors
    }
  }, [viewMode]);

  const handleSaveEvent = () => {
    if (!editorStartIso) {
      showError(new Error("Start time is required"), "Start time is required");
      return;
    }
    if (!editorTitle.trim()) {
      showError(new Error("Title is required"), "Title is required");
      return;
    }

    const basePayload = {
      type: editorType,
      title: editorTitle.trim(),
      description: editorDescription.trim() || undefined,
      start_at: editorStartIso,
      end_at: editorEndIso ?? undefined,
      capacity: editorCapacity.trim() ? Number.parseInt(editorCapacity, 10) : undefined,
      recurrence_rule: recurrencePayload,
      attachments: editorAttachments,
    };

    if (editorMode === "create") {
      createEventMutation.mutate(basePayload);
      return;
    }

    if (!editingEventId) {
      showError(new Error("Missing event id"), "Missing event id");
      return;
    }
    updateEventMutation.mutate({
      id: editingEventId,
      payload: {
        ...basePayload,
        pinned: editorPinned,
        signup_locked: editorSignupLocked,
        recurrence_scope: editorRecurrenceEnabled ? editorRecurrenceApplyTo : "this",
      },
    });
  };

  const cardsEmptyDescription = archivedOnly
    ? eventType
      ? "No archived events match your filters"
      : "No archived events yet"
    : eventType
      ? "No events match your filters"
      : "No events yet";

  const resetCardsFilters = () => {
    setEventType(undefined);
    setArchivedOnly(false);
  };

  const handleCopyMentionsForEvent = (event: Event) =>
    void copyMentionList(
      (eventMembersMap.get(event.id) ?? []).map((entry) => ({
        username: entry.user.username,
        wechatName: entry.profile.wechat_name,
      })),
      { teamName: event.title },
    );

  const handleDuplicateEvent = (event: Event) =>
    createEventMutation.mutate({
      type: event.type,
      title: `${event.title} (Copy)`,
      description: event.description ?? undefined,
      start_at: new Date(new Date(event.start_at).getTime() + 7 * 24 * 60 * 60_000).toISOString(),
      end_at: event.end_at
        ? new Date(new Date(event.end_at).getTime() + 7 * 24 * 60 * 60_000).toISOString()
        : undefined,
      capacity: event.capacity ?? undefined,
      recurrence_rule: event.recurrence_rule ?? undefined,
      attachments: event.attachments ?? [],
    });

  const handleTogglePinnedEvent = (event: Event) =>
    updateEventMutation.mutate({
      id: event.id,
      payload: { pinned: !event.pinned },
    });

  const handleToggleLockedEvent = (event: Event) =>
    updateEventMutation.mutate({
      id: event.id,
      payload: { signup_locked: !event.signup_locked },
    });

  const createActionLabel = t("button.create");
  const createAction = useMemo(
    () =>
      canManage ? (
        <MotionButton type="primary" onClick={() => openCreateEditor()}>
          {createActionLabel}
        </MotionButton>
      ) : null,
    [canManage, createActionLabel, openCreateEditor],
  );
  usePageHeaderActions(createAction);
  const hasLoadError = eventsQuery.isError || usersQuery.isError;
  useLoadWarningToast(hasLoadError, t("common:loadErrorRetry"));

  return (
    <PageLayout title={t("title")} subtitle="Schedule" className="events-page">
      <Suspense fallback={null}>
        <LazyEventsFiltersCard
          eventType={eventType}
          archivedOnly={archivedOnly}
          viewMode={viewMode}
          showAvailabilityOverlay={showAvailabilityOverlay}
          onEventTypeChange={setEventType}
          onArchivedOnlyChange={setArchivedOnly}
          onViewModeChange={setViewMode}
          onShowAvailabilityOverlayChange={setShowAvailabilityOverlay}
        />
      </Suspense>

      <Suspense fallback={null}>
        {viewMode === "cards" ? (
          <LazyEventCardsView
            events={sortedEvents}
            cardsEmptyDescription={cardsEmptyDescription}
            canManage={canManage}
            canInteract={canInteract}
            eventType={eventType}
            archivedOnly={archivedOnly}
            eventFlags={eventFlags}
            eventMembersMap={eventMembersMap}
            joinPending={joinMutation.isPending}
            leavePending={leaveMutation.isPending}
            createPending={createEventMutation.isPending}
            updatePending={updateEventMutation.isPending}
            archivePending={archiveEventMutation.isPending}
            onResetFilters={resetCardsFilters}
            onCreateEvent={() => openCreateEditor()}
            onJoinEvent={(eventId) => {
              void handleJoin(eventId);
            }}
            onLeaveEvent={handleLeave}
            onCopyMentions={handleCopyMentionsForEvent}
            onEditEvent={openEditEditor}
            onDuplicateEvent={handleDuplicateEvent}
            onTogglePinEvent={handleTogglePinnedEvent}
            onToggleLockEvent={handleToggleLockedEvent}
            onArchiveEvent={(eventId) => archiveEventMutation.mutate(eventId)}
          />
        ) : (
          <LazyEventCalendarView
            showAvailabilityOverlay={showAvailabilityOverlay}
            canManage={canManage}
            eventsByDay={eventsByDay}
            availabilityDayPeakByDay={availabilityHeatData.dayPeakByDay}
            availabilityMaxCount={availabilityHeatData.maxCount}
            onSelectDate={setSelectedDate}
            onCreateEvent={openCreateEditor}
            onEditEvent={openEditEditor}
          />
        )}
      </Suspense>

      {editorOpen ? (
        <Suspense fallback={null}>
          <LazyEventFormModal
            open={editorOpen}
            mode={editorMode}
            canManage={canManage}
            editingEventId={editingEventId}
            title={editorTitle}
            onTitleChange={setEditorTitle}
            eventType={editorType}
            onEventTypeChange={setEditorType}
            startAt={editorStartAt}
            onStartAtChange={setEditorStartAt}
            endAt={editorEndAt}
            onEndAtChange={setEditorEndAt}
            capacity={editorCapacity}
            onCapacityChange={setEditorCapacity}
            description={editorDescription}
            onDescriptionChange={setEditorDescription}
            pinned={editorPinned}
            onPinnedChange={setEditorPinned}
            signupLocked={editorSignupLocked}
            onSignupLockedChange={setEditorSignupLocked}
            recurrenceEnabled={editorRecurrenceEnabled}
            onRecurrenceEnabledChange={setEditorRecurrenceEnabled}
            recurrenceFreq={editorRecurrenceFreq}
            onRecurrenceFreqChange={setEditorRecurrenceFreq}
            recurrenceInterval={editorRecurrenceInterval}
            onRecurrenceIntervalChange={setEditorRecurrenceInterval}
            recurrenceDays={editorRecurrenceDays}
            onRecurrenceDaysChange={setEditorRecurrenceDays}
            recurrenceApplyTo={editorRecurrenceApplyTo}
            onRecurrenceApplyToChange={setEditorRecurrenceApplyTo}
            attachments={editorAttachments}
            onRemoveAttachment={(attachmentIndex) =>
              setEditorAttachments((current) => current.filter((_, currentIndex) => currentIndex !== attachmentIndex))
            }
            attachmentUploader={eventAttachmentUploader}
            onUploadAttachments={() => void handleUploadEventAttachments()}
            conflictingEvents={conflictingEvents}
            showAvailabilityOverlay={showAvailabilityOverlay}
            availabilityDaysWithAny={availabilityHeatData.daysWithAny}
            availabilityMaxCount={availabilityHeatData.maxCount}
            availabilityMemberCount={availabilityHeatData.memberCount}
            confirmLoading={createEventMutation.isPending || updateEventMutation.isPending}
            onCancel={() => {
              void handleCloseEditor();
            }}
            onSave={handleSaveEvent}
          />
        </Suspense>
      ) : null}
    </PageLayout>
  );
}

