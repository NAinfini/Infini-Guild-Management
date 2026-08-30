import type { ImageGridEditorItem } from "@portal/types/media";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../api/query-keys";
import { useAppError } from "../../hooks/useAppError";
import { useEventMemberDirectory } from "../../hooks/data/useEventsData";
import { useEventEditorMutations } from "../../hooks/useEventMutations";
import { useAttachmentService } from "../../services/AttachmentService";
import { EventService, fetchEventDetail, isApiRequestError } from "../../services/EventService";
import { useAuthStore } from "../../stores/auth";
import { buildAvailabilityHeatData } from "../../utils/availability";
import { resolveMediaUrl } from "../../utils/media";
import { EventFormContent } from "../feature/events/EventFormContent";
import { useEventsEditorController } from "../feature/events/useEventsEditorController";
import { ArrowLeftIcon } from "../icons";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import "./EventsPage.css";

function buildAttachmentSnapshot(items: ImageGridEditorItem[]) {
  return JSON.stringify(items.map((item) => ({ id: item.id, src: item.src ?? null, hasFile: Boolean(item.file) })));
}

type EventEditorPageProps = {
  mode: "create" | "edit";
};

export function EventEditorPage({ mode }: EventEditorPageProps) {
  const { t } = useTranslation("events");
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { id?: string };
  const routeSearch = useSearch({ strict: false }) as { date?: string };
  const eventId = params.id;
  const initialDateKey = mode === "create" && /^\d{4}-\d{2}-\d{2}$/.test(routeSearch.date ?? "")
    ? routeSearch.date
    : undefined;
  const queryClient = useQueryClient();
  const { showError } = useAppError();
  const user = useAuthStore((state) => state.user);
  const [attachmentItems, setAttachmentItems] = useState<ImageGridEditorItem[]>([]);
  const attachmentItemsRef = useRef(attachmentItems);
  const initializedRef = useRef<string | null>(null);
  const [returnAfterSave, setReturnAfterSave] = useState(false);
  const attachmentService = useAttachmentService();
  const attachmentSnapshot = useMemo(() => buildAttachmentSnapshot(attachmentItems), [attachmentItems]);
  const eventService = useMemo(
    () => new EventService({ attachmentService, queryClient }),
    [attachmentService, queryClient],
  );
  const usersQuery = useEventMemberDirectory({
    currentUserId: user?.id,
    publicMemberProjection: !user,
    enabled: Boolean(user),
  });
  const availabilityHeatData = useMemo(
    () => buildAvailabilityHeatData(usersQuery.data?.data ?? []),
    [usersQuery.data],
  );
  const detailQuery = useQuery({
    queryKey: queryKeys.events.detail(eventId ?? ""),
    queryFn: () => fetchEventDetail(eventId as string),
    enabled: mode === "edit" && Boolean(eventId),
    staleTime: 30_000,
  });
  const editor = useEventsEditorController({ attachmentSnapshot });
  const mutations = useEventEditorMutations({
    eventService,
    attachmentService,
    attachmentItems,
    setAttachmentItems,
    closeEditorAfterSave: () => {
      editor.closeEditorAfterSave();
      setReturnAfterSave(true);
    },
    showError,
  });

  useEffect(() => {
    attachmentItemsRef.current = attachmentItems;
  }, [attachmentItems]);

  useEffect(() => () => {
    attachmentService.releaseItems(attachmentItemsRef.current);
  }, [attachmentService]);

  useEffect(() => {
    if (mode === "create") {
      if (initializedRef.current !== "create") {
        mutations.resetAttachmentItems();
        editor.openCreateEditor(initialDateKey);
        initializedRef.current = "create";
      }
      return;
    }
    const event = detailQuery.data;
    if (!event || initializedRef.current === event.id) return;
    const nextItems = (event.attachments ?? []).map((mediaId, index) => ({
      id: mediaId,
      src: resolveMediaUrl(mediaId),
      alt: `Attachment ${index + 1}`,
    }));
    setAttachmentItems((current) => {
      attachmentService.releaseItems(current);
      return nextItems;
    });
    editor.openEditEditor(event, buildAttachmentSnapshot(nextItems));
    initializedRef.current = event.id;
  }, [attachmentService, detailQuery.data, editor, initialDateKey, mode, mutations]);

  const returnFromEditor = useCallback(() => {
    if (mode === "edit" && eventId) {
      void navigate({ to: "/events/$id", params: { id: eventId }, replace: true, viewTransition: false });
      return;
    }
    void navigate({ to: "/events", replace: true, viewTransition: false });
  }, [eventId, mode, navigate]);
  const returnToEvents = useCallback(() => {
    void navigate({ to: "/events", replace: true, viewTransition: false });
  }, [navigate]);

  useEffect(() => {
    if (!returnAfterSave || editor.editorOpen) return;
    returnFromEditor();
  }, [editor.editorOpen, returnAfterSave, returnFromEditor]);
  const handleAttachmentItemsChange = useCallback((items: ImageGridEditorItem[]) => {
    editor.markEditorTouched();
    setAttachmentItems(items);
  }, [editor]);
  const handleFilesSelected = useCallback((files: File[]) => {
    editor.markEditorTouched();
    return mutations.handleFilesSelected(files);
  }, [editor, mutations]);
  const handleAttachmentDelete = useCallback((item: ImageGridEditorItem) => {
    editor.markEditorTouched();
    return mutations.handleAttachmentDelete(item);
  }, [editor, mutations]);
  const handleSave = useCallback(() => {
    if (!editor.editorType) return;
    mutations.saveEvent({
      mode: editor.editorMode,
      editingEventId: editor.editingEventId,
      expectedUpdatedAt: editor.editingExpectedUpdatedAt,
      eventType: editor.editorType,
      title: editor.editorTitle,
      description: editor.editorDescription,
      startAt: editor.editorStartAt,
      startIso: editor.editorStartIso ?? null,
      endAt: editor.editorEndAt,
      endIso: editor.editorEndIso ?? null,
      capacity: editor.editorCapacity,
      pinned: editor.editorPinned,
      signupLocked: editor.editorSignupLocked,
      autoArchive: editor.editorAutoArchive,
      pollOptions: editor.editorPollOptions,
      pollResultsVisibility: editor.editorPollResultsVisibility,
      pollShowVoterNames: editor.editorPollShowVoterNames,
      winnerCount: editor.editorWinnerCount,
      classQuotas: editor.editorClassQuotas,
    });
  }, [editor, mutations]);

  const detailBlockingError = mode === "edit" && detailQuery.isError && !detailQuery.data;
  const detailRefreshError = mode === "edit" && detailQuery.isError && Boolean(detailQuery.data);

  if (mode === "edit" && detailQuery.isLoading) {
    return <PageLayout className="events-page event-editor-page"><div className="event-route-loading"><Skeleton className="h-9" /><Skeleton className="h-105" /></div></PageLayout>;
  }
  if (detailBlockingError) {
    const missing = isApiRequestError(detailQuery.error) && detailQuery.error.status === 404;
    return (
      <PageLayout className="events-page event-editor-page">
        <EmptyState
          status="error"
          title={missing ? t("eventDetail.missing") : t("eventDetail.loadFailed")}
          description={missing ? t("common:notFound.description") : t("error.loadDescription")}
          actions={missing ? (
            <Button onClick={returnToEvents}>
              <ArrowLeftIcon size={16} />
              {t("view.events")}
            </Button>
          ) : (
            <Button onClick={() => { void detailQuery.refetch(); }}>{t("common:action.retry")}</Button>
          )}
        />
      </PageLayout>
    );
  }
  if (mode === "edit" && !detailQuery.data) {
    return <PageLayout className="events-page event-editor-page"><div className="event-route-loading"><Skeleton className="h-9" /><Skeleton className="h-105" /></div></PageLayout>;
  }
  if (!editor.editorOpen) {
    return <PageLayout className="events-page event-editor-page"><Skeleton className="h-105" /></PageLayout>;
  }

  return (
    <PageLayout className="events-page event-editor-page">
      <div className="event-route-stack event-editor-page__stack">
        {detailRefreshError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("common:loadError")}</AlertTitle>
            <AlertDescription>
              <span>{t("common:loadErrorRetry")}</span>
              <Button size="sm" variant="outline" loading={detailQuery.isFetching} onClick={() => { void detailQuery.refetch(); }}>
                {t("common:action.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <header className="event-route-header event-route-header--sticky event-editor-page__header">
          <div className="event-route-header__title">
            <Button
              variant="outline"
              size="sm"
              className="event-route-header__back"
              onClick={returnFromEditor}
            >
              <ArrowLeftIcon size={15} />
              {mode === "edit" ? t("editor.backToEvent") : t("view.events")}
            </Button>
            <h2>{mode === "create" ? t("editor.createTitle") : t("editor.editTitle")}</h2>
          </div>
        </header>
        <EventFormContent
            mode={editor.editorMode}
            canManage
            title={editor.editorTitle}
            onTitleChange={editor.setEditorTitle}
            eventType={editor.editorType}
            onEventTypeChange={editor.setEditorType}
            startAt={editor.editorStartAt}
            onStartAtChange={editor.setEditorStartAt}
            endAt={editor.editorEndAt}
            onEndAtChange={editor.setEditorEndAt}
            capacity={editor.editorCapacity}
            onCapacityChange={editor.setEditorCapacity}
            description={editor.editorDescription}
            onDescriptionChange={editor.setEditorDescription}
            autoArchive={editor.editorAutoArchive}
            onAutoArchiveChange={editor.setEditorAutoArchive}
            pollOptions={editor.editorPollOptions}
            onPollOptionsChange={editor.setEditorPollOptions}
            pollResultsVisibility={editor.editorPollResultsVisibility}
            onPollResultsVisibilityChange={editor.setEditorPollResultsVisibility}
            pollShowVoterNames={editor.editorPollShowVoterNames}
            onPollShowVoterNamesChange={editor.setEditorPollShowVoterNames}
            winnerCount={editor.editorWinnerCount}
            onWinnerCountChange={editor.setEditorWinnerCount}
            classQuotas={editor.editorClassQuotas}
            onClassQuotasChange={editor.setEditorClassQuotas}
            attachmentItems={attachmentItems}
            onAttachmentsChange={handleAttachmentItemsChange}
            onFilesSelected={handleFilesSelected}
            onAttachmentDelete={handleAttachmentDelete}
            availabilityDaysWithAny={availabilityHeatData.daysWithAny}
            availabilityMaxCount={availabilityHeatData.maxCount}
            availabilityMemberCount={availabilityHeatData.memberCount}
            confirmLoading={mutations.savePending}
            onCancel={returnFromEditor}
            onSave={handleSave}
            stickyActions
          />
      </div>
    </PageLayout>
  );
}
