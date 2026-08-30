import type { Event, MemberProfile, User } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import { Card, CardContent } from "@portal/components/ui/card";
import { CalendarTimeIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { type EventTypeFilter } from "../../../utils/event-navigation";
import { EmptyState } from "../../shared/EmptyState";
import { EventCard } from "./EventCard";
import "./EventCardsView.css";

type MemberEntry = { user: User; profile: MemberProfile };

type EventCardsViewProps = {
  events: Event[];
  cardsEmptyDescription: string;
  canCreate: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canInteract: boolean;
  currentUserId: string | null;
  eventType: EventTypeFilter | undefined;
  archivedOnly: boolean;
  pinnedOnly: boolean;
  lockedOnly: boolean;
  hasAnyFilter?: boolean;
  eventFlags: Map<string, "NEW" | "UPDATED">;
  eventMembersMap: Map<string, MemberEntry[]>;
  allUsers: MemberEntry[];
  participantPendingEventIds: ReadonlySet<string>;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  onResetFilters: () => void;
  onCreateEvent: () => void;
  onJoinEvent: (eventId: string) => void;
  onLeaveEvent: (eventId: string) => void;
  onCopyMentions: (event: Event) => void;
  onEditEvent: (event: Event) => void;
  onDuplicateEvent: (event: Event) => void;
  onTogglePinEvent: (event: Event) => void;
  onToggleLockEvent: (event: Event) => void;
  onArchiveEvent: (eventId: string) => void;
  onUnarchiveEvent: (event: Event) => void;
  onDeleteEvent: (event: Event) => void;
  onOpenEvent: (event: Event) => void;
};

export function EventCardsView({
  events,
  cardsEmptyDescription,
  canCreate,
  canEdit,
  canArchive,
  canDelete,
  canInteract,
  currentUserId,
  eventType,
  archivedOnly,
  pinnedOnly,
  lockedOnly,
  hasAnyFilter,
  eventFlags,
  eventMembersMap,
  allUsers,
  participantPendingEventIds,
  onResetFilters,
  onCreateEvent,
  onJoinEvent,
  onLeaveEvent,
  onCopyMentions,
  onEditEvent,
  onDuplicateEvent,
  onTogglePinEvent,
  onToggleLockEvent,
  onArchiveEvent,
  onUnarchiveEvent,
  onDeleteEvent,
  onOpenEvent,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: EventCardsViewProps) {
  const { t } = useTranslation("events");
  const now = new Date();
  const filtersApplied =
    hasAnyFilter ?? Boolean(eventType || archivedOnly || pinnedOnly || lockedOnly);

  if (events.length === 0) {
    return (
      <Card className="event-cards-view__empty-card"><CardContent>
        <EmptyState
          title={cardsEmptyDescription}
          description={filtersApplied ? t("empty.filteredDescription") : t("empty.description")}
          icon={<CalendarTimeIcon size={28} aria-hidden="true" />}
          actions={
            filtersApplied ? (
              <Button onClick={onResetFilters}>
                {t("card.resetFilters")}
              </Button>
            ) : canCreate ? (
              <Button onClick={onCreateEvent}>{t("button.create")}</Button>
            ) : null
          }
        />
      </CardContent></Card>
    );
  }

  return (
    <>
      <div className="event-cards-view">
        <section className="event-cards-view__grid" aria-label={t("title")}>
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              now={now}
              canCreate={canCreate}
              canEdit={canEdit}
              canArchive={canArchive}
              canDelete={canDelete}
              canInteract={canInteract}
              currentUserId={currentUserId}
              eventFlags={eventFlags}
              eventMembersMap={eventMembersMap}
              allUsers={allUsers}
              joinPending={participantPendingEventIds.has(event.id)}
              leavePending={participantPendingEventIds.has(event.id)}
              onOpenDetail={onOpenEvent}
              onJoinEvent={onJoinEvent}
              onLeaveEvent={onLeaveEvent}
              onCopyMentions={onCopyMentions}
              onEditEvent={onEditEvent}
              onDuplicateEvent={onDuplicateEvent}
              onTogglePinEvent={onTogglePinEvent}
              onToggleLockEvent={onToggleLockEvent}
              onArchiveEvent={onArchiveEvent}
              onUnarchiveEvent={onUnarchiveEvent}
              onDeleteEvent={onDeleteEvent}
            />
          ))}
        </section>
      </div>

      {hasMore && onLoadMore ? (
        <div className="event-cards-view__load-more">
          <Button
            variant="ghost"
            loading={isLoadingMore}
            onClick={onLoadMore}
          >
            {t("action.loadMore")}
          </Button>
        </div>
      ) : null}

    </>
  );
}
