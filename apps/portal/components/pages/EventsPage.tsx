import type { Event, MemberProfile, User } from "@guild/shared";
import type { ImageGridEditorItem } from "@portal/types/media";
import { useClipboard } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Suspense,
  useCallback,
  lazy,
  useMemo,
  useState,
} from "react";
import { Card, Skeleton, Stack } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { notifySuccess, notifyWarning } from "../../utils/notifications";
import {
  EventService,
} from "../../services/EventService";
import { useAppError } from "../../hooks/useAppError";
import { useEventsFiltering } from "../../hooks/useEventsFiltering";
import { useEventsMutations } from "../../hooks/useEventsMutations";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useAttachmentService } from "../../services/AttachmentService";
import { useAuthStore } from "../../stores/auth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { buildMentionList } from "../../utils/copy";
import { sanitizeEventsRouteSearch, type EventWorkbenchViewMode, type EventsRouteSearch } from "../../utils/event-navigation";
import { useEventsEditorController } from "../feature/events/useEventsEditorController";
import { useRecurringTemplatesController } from "../feature/events/useRecurringTemplatesController";
import { PageLayout } from "../layout/PageLayout";
import { EventDetailModal } from "../feature/events/EventDetailModal";
import "./EventsPage.css";
import { resolveMediaUrl } from "../../utils/media";

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
const LazyRecurringTemplatesTab = lazy(() =>
  import("../feature/events/RecurringTemplatesTab").then((mod) => ({ default: mod.RecurringTemplatesTab })),
);
function buildAttachmentSnapshot(items: ImageGridEditorItem[]) {
  return JSON.stringify(
    items.map((item) => ({
      id: item.id,
      src: item.src ?? null,
      hasFile: Boolean(item.file),
    })),
  );
}

function asMemberEntries(value: Array<{ user: User; profile: MemberProfile }>) {
  return value;
}

export function EventsPage() {
  const { t } = useTranslation("events");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const eventsRouteSearch = useSearch({ strict: false }) as EventsRouteSearch;
  const clipboard = useClipboard();
  const { showError } = useAppError();
  const user = useAuthStore((state) => state.user);
  const isExternalView = useExternalView();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const isModerator = canManagePermission(["events.create", "events.edit", "events.archive", "events.delete", "events.templates"]);
  const canManage = isModerator && !isExternalView;
  const canInteract = Boolean(user) && !isExternalView;

  // Recurring templates are an administrative view; normalize unauthorized
  // deep links to cards instead of rendering an empty workbench.
  const requestedView = eventsRouteSearch.view ?? "cards";
  const viewMode: EventWorkbenchViewMode =
    requestedView === "recurring" && !canManage ? "cards" : requestedView;
  const [, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [monthDetailEvent, setMonthDetailEvent] = useState<Event | null>(null);
  const [attachmentItems, setAttachmentItems] = useState<ImageGridEditorItem[]>([]);

  const setViewMode = useCallback((value: EventWorkbenchViewMode) => {
    void navigate({
      to: "/events",
      search: (prev) =>
        sanitizeEventsRouteSearch({
          ...(prev as EventsRouteSearch),
          view: value,
        }),
      replace: true,
      resetScroll: false,
      viewTransition: false,
    });
  }, [navigate]);

  const attachmentService = useAttachmentService();
  const attachmentSnapshot = useMemo(() => buildAttachmentSnapshot(attachmentItems), [attachmentItems]);
  const eventService = useMemo(
    () =>
      new EventService({
        attachmentService,
        queryClient,
      }),
    [attachmentService, queryClient],
  );
  const recurringTemplatesController = useRecurringTemplatesController({
    enabled: canManage && viewMode === "recurring",
    showError,
  });
  const filtering = useEventsFiltering({
    currentUserId: user?.id,
  });
  const routeDetailEvent = filtering.focusedEvent;
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
    editorAutoArchive,
    editorPollOptions,
    editorPollResultsVisibility,
    editorPollShowVoterNames,
    editorWinnerCount,
    editorClassQuotas,
    editorStartIso,
    editorEndIso,
    setEditorType,
    setEditorTitle,
    setEditorDescription,
    setEditorStartAt,
    setEditorEndAt,
    setEditorCapacity,
    setEditorAutoArchive,
    setEditorPollOptions,
    setEditorPollResultsVisibility,
    setEditorPollShowVoterNames,
    setEditorWinnerCount,
    setEditorClassQuotas,
    markEditorTouched,
    openCreateEditor: openCreateEditorBase,
    openEditEditor: openEditEditorBase,
    closeEditor: closeEditorBase,
    closeEditorAfterSave,
  } = useEventsEditorController({ attachmentSnapshot });
  const mutations = useEventsMutations({
    canInteract,
    user,
    eventService,
    attachmentService,
    attachmentItems,
    setAttachmentItems,
    eventById: filtering.eventById,
    joinedEventRanges: filtering.joinedEventRanges,
    closeEditorAfterSave,
    showError,
  });

  const openCreateEditor = useCallback((initialDateKey?: string) => {
    mutations.resetAttachmentItems();
    openCreateEditorBase(initialDateKey);
  }, [mutations, openCreateEditorBase]);

  const openEditEditor = useCallback((event: Event) => {
    const nextItems = (event.attachments ?? []).map((mediaId, idx) => ({
      id: mediaId,
      src: resolveMediaUrl(mediaId),
      alt: `Attachment ${idx + 1}`,
    }));
    setAttachmentItems((current) => {
      attachmentService.releaseItems(current);
      return nextItems;
    });
    openEditEditorBase(event, buildAttachmentSnapshot(nextItems));
  }, [attachmentService, openEditEditorBase]);

  const handleCloseEditor = async () => {
    const didClose = await closeEditorBase();
    if (didClose) {
      mutations.resetAttachmentItems();
    }
  };

  const handleAttachmentItemsChange = useCallback((items: ImageGridEditorItem[]) => {
    markEditorTouched();
    setAttachmentItems(items);
  }, [markEditorTouched]);

  const handleFilesSelected = useCallback((...args: Parameters<typeof mutations.handleFilesSelected>) => {
    markEditorTouched();
    return mutations.handleFilesSelected(...args);
  }, [markEditorTouched, mutations]);

  const handleAttachmentDelete = useCallback((...args: Parameters<typeof mutations.handleAttachmentDelete>) => {
    markEditorTouched();
    return mutations.handleAttachmentDelete(...args);
  }, [markEditorTouched, mutations]);

  const handleSaveEvent = () => {
    if (!editorType) return;
    mutations.saveEvent({
      mode: editorMode,
      editingEventId,
      eventType: editorType,
      title: editorTitle,
      description: editorDescription,
      startAt: editorStartAt,
      startIso: editorStartIso ?? null,
      endAt: editorEndAt,
      endIso: editorEndIso ?? null,
      capacity: editorCapacity,
      pinned: editorPinned,
      signupLocked: editorSignupLocked,
      autoArchive: editorAutoArchive,
      pollOptions: editorPollOptions,
      pollResultsVisibility: editorPollResultsVisibility,
      pollShowVoterNames: editorPollShowVoterNames,
      winnerCount: editorWinnerCount,
      classQuotas: editorClassQuotas,
    });
  };

  const handleCopyMentionsForEvent = (event: Event) => {
    const value = buildMentionList(
      (filtering.eventMembersMap.get(event.id) ?? []).map((entry) => ({
        username: entry.user.username,
      })),
      event.title,
    );
    if (!value.trim()) {
      notifyWarning(t("message.nothingToCopy"));
      return;
    }
    clipboard.copy(value);
    notifySuccess(t("message.mentionsCopied"));
  };

  const hasLoadError =
    filtering.eventsQuery.isError
    || filtering.usersQuery.isError
    || filtering.focusedEventQuery.isError;
  useLoadWarningToast(hasLoadError, t("common:loadErrorRetry"));

  return (
    <PageLayout className="events-page">
      <Stack gap={12}>
            {/*
              * 模板档不渲染这张卡：那一档的视图切换器挂在 RecurringTemplatesTab
              * 自己那条筛选栏上，两边都渲染就是上下并排的两条工具栏。
              */}
            {viewMode === "recurring" ? null : (
            <Suspense fallback={<Card><Stack gap={8} p="md"><Skeleton height={36} radius={8} /></Stack></Card>}>
              <LazyEventsFiltersCard
                searchQuery={filtering.searchQuery}
                eventType={filtering.eventType}
                eventStatus={filtering.eventStatus}
                pinnedOnly={filtering.pinnedOnly}
                lockedOnly={filtering.lockedOnly}
                viewMode={viewMode}
                canManage={canManage}
                onSearchChange={filtering.setSearchQuery}
                onEventTypeChange={filtering.setEventType}
                onEventStatusChange={filtering.setEventStatus}
                onPinnedOnlyChange={filtering.setPinnedOnly}
                onLockedOnlyChange={filtering.setLockedOnly}
                onViewModeChange={setViewMode}
                onCreateEvent={() => openCreateEditor()}
              />
            </Suspense>
            )}

            <Suspense fallback={<Card><Stack gap={8} p="md"><Skeleton height={200} radius={8} /></Stack></Card>}>
              {viewMode === "recurring" ? (
                <LazyRecurringTemplatesTab
                  canManage={canManage}
                  onViewModeChange={setViewMode}
                  templates={recurringTemplatesController.templates}
                  loading={recurringTemplatesController.loading}
                  formSaving={recurringTemplatesController.formSaving}
                  onCreateTemplate={recurringTemplatesController.createRecurringTemplate}
                  onUpdateTemplate={recurringTemplatesController.updateRecurringTemplate}
                  onPauseTemplate={recurringTemplatesController.pauseRecurringTemplate}
                  onResumeTemplate={recurringTemplatesController.resumeRecurringTemplate}
                  onDeleteTemplate={recurringTemplatesController.deleteRecurringTemplate}
                />
              ) : viewMode === "cards" ? (
                <LazyEventCardsView
                  events={filtering.sortedEvents}
                  cardsEmptyDescription={filtering.cardsEmptyDescription}
                  canManage={canManage}
                  canInteract={canInteract}
                  currentUserId={user?.id ?? null}
                  eventType={filtering.eventType}
                  archivedOnly={filtering.archivedOnly}
                  pinnedOnly={filtering.pinnedOnly}
                  lockedOnly={filtering.lockedOnly}
                  hasAnyFilter={filtering.hasAnyFilter}
                  focusedEventId={filtering.focusEventId}
                  eventFlags={filtering.eventFlags}
                  eventMembersMap={filtering.eventMembersMap}
                  allUsers={asMemberEntries(filtering.usersQuery.data?.data ?? [])}
                  participantPendingEventIds={mutations.participantPendingEventIds}
                  votePending={mutations.votePending}
                  onResetFilters={filtering.resetFilters}
                  onCreateEvent={() => openCreateEditor()}
                  onJoinEvent={(eventId) => {
                    void mutations.handleJoin(eventId);
                  }}
                  onLeaveEvent={mutations.handleLeave}
                  onCopyMentions={handleCopyMentionsForEvent}
                  onEditEvent={openEditEditor}
                  onDuplicateEvent={mutations.duplicateEvent}
                  onTogglePinEvent={mutations.togglePinnedEvent}
                  onToggleLockEvent={mutations.toggleLockedEvent}
                  onArchiveEvent={mutations.archiveEventById}
                  onUnarchiveEvent={mutations.unarchiveEventById}
                  onDeleteEvent={(event) => { void mutations.deleteEventWithConfirm(event); }}
                  onAddParticipant={mutations.addParticipant}
                  onRemoveParticipant={mutations.removeParticipant}
                  onVotePoll={canInteract ? mutations.votePoll : undefined}
                  onDrawRaffle={canManage ? mutations.drawRaffle : undefined}
                  drawRafflePending={mutations.drawRafflePending}
                  hasMore={filtering.eventsHasMore}
                  isLoadingMore={filtering.eventsLoadingMore}
                  onLoadMore={filtering.onLoadMoreEvents}
                />
              ) : (
                <LazyEventCalendarView
                  canManage={canManage}
                  eventsByDay={filtering.eventsByDay}
                  availabilityDayPeakByDay={filtering.availabilityHeatData.dayPeakByDay}
                  availabilityMaxCount={filtering.availabilityHeatData.maxCount}
                  onSelectDate={setSelectedDate}
                  onCreateEvent={openCreateEditor}
                  onEditEvent={openEditEditor}
                  onViewEvent={setMonthDetailEvent}
                />
              )}
            </Suspense>
      </Stack>

      {editorOpen ? (
        <Suspense fallback={<Card><Stack gap={8} p="md"><Skeleton height={120} radius={8} /></Stack></Card>}>
          <LazyEventFormModal
            open={editorOpen}
            mode={editorMode}
            canManage={canManage}
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
            autoArchive={editorAutoArchive}
            onAutoArchiveChange={setEditorAutoArchive}
            pollOptions={editorPollOptions}
            onPollOptionsChange={setEditorPollOptions}
            pollResultsVisibility={editorPollResultsVisibility}
            onPollResultsVisibilityChange={setEditorPollResultsVisibility}
            pollShowVoterNames={editorPollShowVoterNames}
            onPollShowVoterNamesChange={setEditorPollShowVoterNames}
            winnerCount={editorWinnerCount}
            onWinnerCountChange={setEditorWinnerCount}
            classQuotas={editorClassQuotas}
            onClassQuotasChange={setEditorClassQuotas}
            attachmentItems={attachmentItems}
            onAttachmentsChange={handleAttachmentItemsChange}
            onFilesSelected={handleFilesSelected}
            onAttachmentDelete={handleAttachmentDelete}
            availabilityDaysWithAny={filtering.availabilityHeatData.daysWithAny}
            availabilityMaxCount={filtering.availabilityHeatData.maxCount}
            availabilityMemberCount={filtering.availabilityHeatData.memberCount}
            confirmLoading={mutations.savePending}
            onCancel={() => {
              void handleCloseEditor();
            }}
            onSave={handleSaveEvent}
          />
        </Suspense>
      ) : null}

      {/* Month view detail modal */}
      <EventDetailModal
        event={routeDetailEvent ?? monthDetailEvent}
        members={
          routeDetailEvent ?? monthDetailEvent
            ? (filtering.eventMembersMap.get((routeDetailEvent ?? monthDetailEvent)!.id) ?? [])
            : []
        }
        allUsers={asMemberEntries(filtering.usersQuery.data?.data ?? [])}
        canManage={canManage}
        currentUserId={user?.id ?? undefined}
        joinPending={mutations.participantPendingEventIds.has((routeDetailEvent ?? monthDetailEvent)?.id ?? "")}
        leavePending={mutations.participantPendingEventIds.has((routeDetailEvent ?? monthDetailEvent)?.id ?? "")}
        onClose={() => {
          if (filtering.focusEventId) {
            filtering.clearFocusedEvent();
          }
          setMonthDetailEvent(null);
        }}
        onJoin={(eventId) => { void mutations.handleJoin(eventId); }}
        onLeave={mutations.handleLeave}
        onAddParticipant={mutations.addParticipant}
        onRemoveParticipant={mutations.removeParticipant}
        onVotePoll={canInteract ? mutations.votePoll : undefined}
        votePending={mutations.votePending}
        onDrawRaffle={canManage ? mutations.drawRaffle : undefined}
        drawRafflePending={mutations.drawRafflePending}
      />
    </PageLayout>
  );
}

