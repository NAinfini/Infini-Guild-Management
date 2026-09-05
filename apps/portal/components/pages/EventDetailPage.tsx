import type { Event, MemberDirectoryEntry } from "@guild/shared";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../api/query-keys";
import { useAppError } from "../../hooks/useAppError";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { useMemberDirectory } from "../../hooks/data/useMemberDirectory";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useEventActions } from "../../hooks/useEventMutations";
import { useExternalView } from "../../hooks/useExternalView";
import { fetchEventDetail, isApiRequestError } from "../../services/EventService";
import { useAuthStore } from "../../stores/auth";
import { ArchiveIcon, ArchiveOffIcon, ArrowLeftIcon, PencilIcon, TrashIcon } from "../icons";
import { EventDetailContent } from "../feature/events/EventDetailContent";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import { RetryableLoadError } from "../shared/RetryableLoadError";
import "./EventsPage.css";

type MemberEntry = MemberDirectoryEntry;

export function EventDetailPage() {
  const { t } = useTranslation("events");
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id: string };
  const { showError } = useAppError();
  const confirm = useConfirmDialog();
  const user = useAuthStore((state) => state.user);
  const isExternalView = useExternalView();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const canEdit = canManagePermission(["events.edit"]) && !isExternalView;
  const canArchive = canManagePermission(["events.archive"]) && !isExternalView;
  const canDelete = canManagePermission(["events.delete"]) && !isExternalView;
  const canInteract = Boolean(user) && !isExternalView;
  const detailQuery = useQuery({
    queryKey: queryKeys.events.detail(id),
    queryFn: () => fetchEventDetail(id),
    staleTime: 30_000,
  });
  const event = detailQuery.data;
  const [memberSearch, setMemberSearch] = useState("");
  const debouncedMemberSearch = useDebouncedValue(memberSearch.trim(), 250);
  const knownMemberIds = useMemo(() => event ? [...new Set([
    ...event.participants.map((participant) => participant.user_id),
    ...(event.poll?.options.flatMap((option) => option.voter_ids) ?? []),
    ...(event.raffle_winners?.map((winner) => winner.user_id) ?? []),
  ])] : [], [event]);
  const memberDirectory = useMemberDirectory({
    currentUserId: user?.id,
    publicMemberProjection: isExternalView || !user,
    enabled: Boolean(event && canEdit && !event.poll),
    search: debouncedMemberSearch,
    selectedIds: knownMemberIds,
  });
  const eventById = useMemo(() => {
    const next = new Map<string, Event>();
    if (event) next.set(event.id, event);
    return next;
  }, [event]);
  const joinedEventRanges = useMemo(() => {
    if (!event || !user || !event.participants.some((participant) => participant.user_id === user.id)) {
      return [];
    }
    const startMs = Date.parse(event.start_at);
    const endMs = Date.parse(event.end_at ?? event.start_at);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
    return [{ eventId: event.id, title: event.title, startMs, endMs }];
  }, [event, user]);
  const mutations = useEventActions({
    canInteract,
    user,
    eventById,
    joinedEventRanges,
    showError,
  });

  const detailBlockingError = detailQuery.isError && !event;
  const detailRefreshError = detailQuery.isError && Boolean(event);
  const returnToEvents = useCallback(() => {
    void navigate({ to: "/events", replace: true, viewTransition: false });
  }, [navigate]);
  const canChangeArchiveState = event?.archived_at ? canEdit : canArchive;
  const requestArchive = useCallback(async () => {
    if (event?.archived_at) {
      mutations.unarchiveEvent(event);
      return;
    }
    if (!event) return;
    const confirmed = await confirm({
      title: t("archive.confirmTitle"),
      description: <p>{t("archive.confirmDescription", { title: event.title })}</p>,
      confirmLabel: t("archive.confirm"),
      cancelLabel: t("archive.cancel"),
      intent: "warning",
    });
    if (confirmed) mutations.archiveEventById(event.id);
  }, [confirm, event, mutations, t]);

  const allUsers = memberDirectory.entries;
  const members = useMemo<MemberEntry[]>(() => {
    if (!event) return [];
    const usersById = new Map(allUsers.map((entry) => [entry.user.id, entry]));
    return event.participants.flatMap((participant) => {
      const member = usersById.get(participant.user_id);
      return member ? [member] : [];
    });
  }, [allUsers, event]);

  if (detailQuery.isLoading) {
    return (
      <PageLayout className="events-page event-detail-page">
        <LoadingIndicator />
      </PageLayout>
    );
  }

  if (detailBlockingError) {
    const missing = isApiRequestError(detailQuery.error) && detailQuery.error.status === 404;
    return (
      <PageLayout className="events-page event-detail-page">
        <EmptyState
          status="error"
          title={missing ? t("eventDetail.missing") : t("eventDetail.loadFailed")}
          description={missing ? t("common:notFound.description") : t("error.loadDescription")}
          actions={missing ? (
            <Button onClick={returnToEvents}><ArrowLeftIcon size={16} />{t("view.events")}</Button>
          ) : (
            <Button onClick={() => { void detailQuery.refetch(); }}>{t("common:action.retry")}</Button>
          )}
        />
      </PageLayout>
    );
  }

  if (!event) {
    return (
      <PageLayout className="events-page event-detail-page">
        <LoadingIndicator />
      </PageLayout>
    );
  }

  return (
    <PageLayout className="events-page event-detail-page">
      <div className="event-route-stack">
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
        {memberDirectory.loadError ? (
          <RetryableLoadError
            className={`member-directory-error member-directory-error--${memberDirectory.loadError.kind}`}
            pending={memberDirectory.loadError.retrying}
            onRetry={() => { void memberDirectory.loadError?.retry(); }}
          />
        ) : null}
        <header className="event-route-header event-route-header--sticky">
          <div className="event-route-header__title">
            <Button
              variant="outline"
              size="sm"
              className="event-route-header__back"
              onClick={returnToEvents}
            >
              <ArrowLeftIcon size={15} />
              {t("view.events")}
            </Button>
            <h2>{event.title}</h2>
          </div>
          {canEdit || canChangeArchiveState || canDelete ? (
            <div className="event-route-header__actions">
              {canEdit ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigate({ to: "/events/$id/edit", params: { id: event.id }, viewTransition: false });
                  }}
                >
                  <PencilIcon size={16} />
                  {t("menu.edit")}
                </Button>
              ) : null}
              {canChangeArchiveState ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void requestArchive();
                  }}
                >
                  {event.archived_at ? <ArchiveOffIcon size={16} /> : <ArchiveIcon size={16} />}
                  {event.archived_at ? t("menu.unarchive") : t("menu.archive")}
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  variant="destructive"
                  onClick={() => {
                    void mutations.deleteEventWithConfirm(event).then((deleted) => {
                      if (deleted) returnToEvents();
                    });
                  }}
                >
                  <TrashIcon size={16} />
                  {t("menu.delete")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </header>

        <EventDetailContent
          event={event}
          members={members}
          allUsers={allUsers}
          canManage={canEdit}
          currentUserId={user?.id}
          joinPending={mutations.participantPendingEventIds.has(event.id)}
          leavePending={mutations.participantPendingEventIds.has(event.id)}
          onJoin={(eventId) => { void mutations.handleJoin(eventId); }}
          onLeave={mutations.handleLeave}
          onAddParticipant={mutations.addParticipant}
          onRemoveParticipant={mutations.removeParticipant}
          onVotePoll={canInteract ? mutations.votePoll : undefined}
          votePending={mutations.votePending}
          onDrawRaffle={canEdit ? mutations.drawRaffle : undefined}
          drawRafflePending={mutations.drawRafflePending}
          memberDirectoryHasMore={memberDirectory.hasMore}
          memberDirectoryLoadingMore={memberDirectory.isLoadingMore}
          onMemberSearchChange={setMemberSearch}
          onLoadMoreMembers={() => { void memberDirectory.loadMore(); }}
          memberIdentitiesUnavailable={memberDirectory.selectedQuery.isError && members.length === 0 && event.participants.length > 0}
        />
      </div>
    </PageLayout>
  );
}
