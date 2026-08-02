import type { Event, MemberProfile, User } from "@guild/shared";
import { Button, Group, Paper, SimpleGrid } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type EventTypeFilter } from "../../../utils/event-navigation";
import { EmptyState } from "../../shared/EmptyState";
import { EventCard } from "./EventCard";
import { EventDetailModal } from "./EventDetailModal";
import "./EventCardsView.css";

type MemberEntry = { user: User; profile: MemberProfile };

type EventCardsViewProps = {
  events: Event[];
  cardsEmptyDescription: string;
  canManage: boolean;
  canInteract: boolean;
  currentUserId: string | null;
  eventType: EventTypeFilter | undefined;
  archivedOnly: boolean;
  pinnedOnly: boolean;
  lockedOnly: boolean;
  hasAnyFilter?: boolean;
  focusedEventId: string | null;
  eventFlags: Map<string, "NEW" | "UPDATED">;
  eventMembersMap: Map<string, MemberEntry[]>;
  allUsers: MemberEntry[];
  joinPending: boolean;
  votePending?: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  leavePending: boolean;
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
  onUnarchiveEvent: (eventId: string) => void;
  onDeleteEvent: (event: Event) => void;
  onAddParticipant: (eventId: string, userId: string) => void;
  onRemoveParticipant: (eventId: string, userId: string) => void;
  onVotePoll?: (eventId: string, optionIds: string[]) => void;
  onDrawRaffle?: (eventId: string) => void;
  drawRafflePending?: boolean;
};

export function EventCardsView({
  events,
  cardsEmptyDescription,
  canManage,
  canInteract,
  currentUserId,
  eventType,
  archivedOnly,
  pinnedOnly,
  lockedOnly,
  hasAnyFilter,
  focusedEventId,
  eventFlags,
  eventMembersMap,
  allUsers,
  joinPending,
  votePending,
  leavePending,
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
  onAddParticipant,
  onRemoveParticipant,
  onVotePoll,
  onDrawRaffle,
  drawRafflePending,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: EventCardsViewProps) {
  const { t } = useTranslation("events");
  const [detailModalEvent, setDetailModalEvent] = useState<Event | null>(null);
  const detailModalMembers = detailModalEvent ? (eventMembersMap.get(detailModalEvent.id) ?? []) : [];
  const now = new Date();
  const filtersApplied =
    hasAnyFilter ?? Boolean(eventType || archivedOnly || pinnedOnly || lockedOnly);

  if (events.length === 0) {
    return (
      <Paper withBorder radius="md" p="md">
        <EmptyState
          title={cardsEmptyDescription}
          actions={
            filtersApplied ? (
              <Button onClick={onResetFilters}>
                {t("card.resetFilters")}
              </Button>
            ) : canManage ? (
              <Button onClick={onCreateEvent}>{t("button.create")}</Button>
            ) : null
          }
        />
      </Paper>
    );
  }

  return (
    <>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing={12}>
        {events.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            now={now}
            canManage={canManage}
            canInteract={canInteract}
            currentUserId={currentUserId}
            focusedEventId={focusedEventId}
            eventFlags={eventFlags}
            eventMembersMap={eventMembersMap}
            allUsers={allUsers}
            joinPending={joinPending}
            leavePending={leavePending}
            onOpenDetail={setDetailModalEvent}
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
      </SimpleGrid>

      {hasMore && onLoadMore ? (
        <Group justify="center" mt={8}>
          <Button
            variant="subtle"
            loading={isLoadingMore}
            onClick={onLoadMore}
          >
            {t("action.loadMore")}
          </Button>
        </Group>
      ) : null}

      {/* ── Event Detail Modal ── */}
      <EventDetailModal
        event={detailModalEvent}
        members={detailModalMembers}
        allUsers={allUsers}
        canManage={canManage}
        currentUserId={currentUserId ?? undefined}
        joinPending={joinPending}
        leavePending={leavePending}
        onClose={() => setDetailModalEvent(null)}
        onJoin={onJoinEvent}
        onLeave={onLeaveEvent}
        onAddParticipant={onAddParticipant}
        onRemoveParticipant={onRemoveParticipant}
        onVotePoll={onVotePoll}
        votePending={votePending}
        onDrawRaffle={onDrawRaffle}
        drawRafflePending={drawRafflePending}
      />
    </>
  );
}
