import type { Event, MemberProfile, User } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import { Card, CardContent } from "@portal/components/ui/card";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { lazy, Suspense, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppError } from "../../hooks/useAppError";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { useEventsFiltering } from "../../hooks/useEventsFiltering";
import { useEventActions } from "../../hooks/useEventMutations";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useAuthStore } from "../../stores/auth";
import { buildMentionList } from "../../utils/copy";
import { notifySuccess, notifyWarning } from "../../utils/notifications";
import {
  sanitizeEventsRouteSearch,
  type EventListViewMode,
  type EventsRouteSearch,
} from "../../utils/event-navigation";
import { EventsWorkspaceSubnav } from "../feature/events/EventsWorkspaceSubnav";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
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

function asMemberEntries(value: Array<{ user: User; profile: MemberProfile }>) {
  return value;
}

export function EventsPage() {
  const { t } = useTranslation("events");
  const navigate = useNavigate();
  const routeSearch = useSearch({ strict: false }) as EventsRouteSearch;
  const { showError } = useAppError();
  const user = useAuthStore((state) => state.user);
  const isExternalView = useExternalView();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const canCreate = canManagePermission(["events.create"]) && !isExternalView;
  const canEdit = canManagePermission(["events.edit"]) && !isExternalView;
  const canArchive = canManagePermission(["events.archive"]) && !isExternalView;
  const canDelete = canManagePermission(["events.delete"]) && !isExternalView;
  const canManageTemplates = canManagePermission(["events.templates"]) && !isExternalView;
  const canInteract = Boolean(user) && !isExternalView;
  const viewMode: EventListViewMode = routeSearch.view ?? "cards";
  const filtering = useEventsFiltering({ currentUserId: user?.id });
  const mutations = useEventActions({
    canInteract,
    user,
    eventById: filtering.eventById,
    joinedEventRanges: filtering.joinedEventRanges,
    showError,
  });

  const setViewMode = useCallback((value: EventListViewMode) => {
    void navigate({
      to: "/events",
      search: (previous) => sanitizeEventsRouteSearch({
        ...(previous as EventsRouteSearch),
        view: value,
      }),
      replace: true,
      resetScroll: false,
      viewTransition: false,
    });
  }, [navigate]);

  const openEvent = useCallback((event: Event) => {
    void navigate({
      to: "/events/$id",
      params: { id: event.id },
      viewTransition: false,
    });
  }, [navigate]);

  const editEvent = useCallback((event: Event) => {
    void navigate({
      to: "/events/$id/edit",
      params: { id: event.id },
      viewTransition: false,
    });
  }, [navigate]);

  const createEvent = useCallback((dateKey?: string) => {
    void navigate({
      to: "/events/new",
      search: dateKey ? { date: dateKey } : {},
      viewTransition: false,
    });
  }, [navigate]);

  const handleCopyMentionsForEvent = useCallback((event: Event) => {
    const value = buildMentionList(
      (filtering.eventMembersMap.get(event.id) ?? []).map((entry) => ({ display_name: entry.user.display_name })),
      event.title,
    );
    if (!value.trim()) {
      notifyWarning(t("message.nothingToCopy"));
      return;
    }
    void navigator.clipboard.writeText(value);
    notifySuccess(t("message.mentionsCopied"));
  }, [filtering.eventMembersMap, t]);

  const hasLoadError = filtering.eventsQuery.isError || filtering.usersQuery.isError || filtering.previewDetailsQuery.isError;
  useLoadWarningToast(hasLoadError, t("common:loadErrorRetry"));
  const eventsUnavailable = filtering.eventsQuery.isError && filtering.sortedEvents.length === 0;
  const members = asMemberEntries(filtering.usersQuery.data?.data ?? []);

  return (
    <PageLayout
      className="events-page"
      toolbar={(
        <div className="events-page__toolbar-stack">
          <EventsWorkspaceSubnav value="events" canManageTemplates={canManageTemplates} />
          <Suspense fallback={<Skeleton className="h-10" />}>
            <LazyEventsFiltersCard
              searchQuery={filtering.searchQuery}
              eventType={filtering.eventType}
              eventStatus={filtering.eventStatus}
              pinnedOnly={filtering.pinnedOnly}
              lockedOnly={filtering.lockedOnly}
              viewMode={viewMode}
              canCreate={canCreate}
              onSearchChange={filtering.setSearchQuery}
              onEventTypeChange={filtering.setEventType}
              onEventStatusChange={filtering.setEventStatus}
              onPinnedOnlyChange={filtering.setPinnedOnly}
              onLockedOnlyChange={filtering.setLockedOnly}
              onViewModeChange={setViewMode}
              onCreateEvent={createEvent}
            />
          </Suspense>
        </div>
      )}
    >
      <Suspense fallback={<Skeleton className="h-55" />}>
        {eventsUnavailable ? (
          <Card className="events-page__error-card">
            <CardContent>
            <EmptyState
              status="error"
              title={t("common:loadError")}
              description={t("error.loadDescription")}
              actions={<Button onClick={() => { void filtering.eventsQuery.refetch(); }}>{t("common:action.retry")}</Button>}
            />
            </CardContent>
          </Card>
        ) : viewMode === "cards" ? (
          <LazyEventCardsView
            events={filtering.sortedEvents}
            cardsEmptyDescription={filtering.cardsEmptyDescription}
            canCreate={canCreate}
            canEdit={canEdit}
            canArchive={canArchive}
            canDelete={canDelete}
            canInteract={canInteract}
            currentUserId={user?.id ?? null}
            eventType={filtering.eventType}
            archivedOnly={filtering.archivedOnly}
            pinnedOnly={filtering.pinnedOnly}
            lockedOnly={filtering.lockedOnly}
            hasAnyFilter={filtering.hasAnyFilter}
            eventFlags={filtering.eventFlags}
            eventMembersMap={filtering.eventMembersMap}
            allUsers={members}
            participantPendingEventIds={mutations.participantPendingEventIds}
            onResetFilters={filtering.resetFilters}
            onCreateEvent={createEvent}
            onOpenEvent={openEvent}
            onJoinEvent={(eventId) => { void mutations.handleJoin(eventId); }}
            onLeaveEvent={mutations.handleLeave}
            onCopyMentions={handleCopyMentionsForEvent}
            onEditEvent={editEvent}
            onDuplicateEvent={mutations.duplicateEvent}
            onTogglePinEvent={mutations.togglePinnedEvent}
            onToggleLockEvent={mutations.toggleLockedEvent}
            onArchiveEvent={mutations.archiveEventById}
            onUnarchiveEvent={mutations.unarchiveEventById}
            onDeleteEvent={(event) => { void mutations.deleteEventWithConfirm(event); }}
            hasMore={filtering.eventsHasMore}
            isLoadingMore={filtering.eventsLoadingMore}
            onLoadMore={filtering.onLoadMoreEvents}
          />
        ) : (
          <LazyEventCalendarView
            canCreate={canCreate}
            eventsByDay={filtering.eventsByDay}
            availabilityDayPeakByDay={filtering.availabilityHeatData.dayPeakByDay}
            availabilityMaxCount={filtering.availabilityHeatData.maxCount}
            selectedDateKey={filtering.selectedDateKey}
            onSelectDate={filtering.setSelectedDate}
            onCreateEvent={createEvent}
            onViewEvent={openEvent}
          />
        )}
      </Suspense>
    </PageLayout>
  );
}
