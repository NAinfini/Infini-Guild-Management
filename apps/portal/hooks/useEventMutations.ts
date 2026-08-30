import type { Event, User } from "@guild/shared";
import type { ImageGridEditorItem } from "@portal/types/media";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../api/query-keys";
import type { AttachmentService } from "../services/AttachmentService";
import {
  archiveEvent,
  createEvent,
  deleteEvent,
  drawRaffle,
  EventService,
  EventValidationError,
  type EventSaveInput,
  updateEvent,
  votePoll,
} from "../services/EventService";
import { notifyError, notifySuccess } from "../utils/notifications";
import { useEventsParticipantMutations } from "./useEventsParticipantMutations";

async function invalidateEventsAndDashboard(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.events.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.guildWar.events() }),
  ]);
}

type UseEventActionsParams = {
  canInteract: boolean;
  user: User | null | undefined;
  eventById: Map<string, Event>;
  joinedEventRanges: Array<{ eventId: string; title: string; startMs: number; endMs: number }>;
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useEventActions({
  canInteract,
  user,
  eventById,
  joinedEventRanges,
  showError,
}: UseEventActionsParams) {
  const { t } = useTranslation("events");
  const confirm = useConfirmDialog();
  const queryClient = useQueryClient();

  const openConfirm = useCallback(
    (options: { title: string; description?: string; intent: "neutral" | "warning" | "danger" }) =>
      confirm({
        title: options.title,
        description: options.description,
        confirmLabel: t("common:action.confirm"),
        cancelLabel: t("common:action.cancel"),
        intent: options.intent,
      }),
    [confirm, t],
  );

  const participantMutations = useEventsParticipantMutations({
    canInteract,
    user,
    eventById,
    joinedEventRanges,
    showError,
  });

  const duplicateEventMutation = useMutation({
    mutationFn: ({ payload, files }: { payload: Parameters<typeof createEvent>[0]; files?: File[] }) =>
      createEvent(payload, files),
    onSuccess: async () => {
      await invalidateEventsAndDashboard(queryClient);
      notifySuccess(t("message.created"));
    },
    onError: (error) => {
      showError(error, t("message.createFailed"));
    },
  });

  const patchEventMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateEvent>[1] }) =>
      updateEvent(id, payload),
    onSuccess: async () => {
      await invalidateEventsAndDashboard(queryClient);
      notifySuccess(t("message.updated"));
    },
    onError: (error) => {
      showError(error, t("message.updateFailed"));
    },
  });

  const archiveEventMutation = useMutation({
    mutationFn: (eventId: string) => archiveEvent(eventId),
    onSuccess: async () => {
      await invalidateEventsAndDashboard(queryClient);
      notifySuccess(t("message.archived"));
    },
    onError: (error) => {
      showError(error, t("message.archiveFailed"));
    },
  });

  const unarchiveEventMutation = useMutation({
    mutationFn: (event: Event) => updateEvent(event.id, {
      archived_at: null,
      expected_updated_at: event.updated_at,
    }),
    onSuccess: async () => {
      await invalidateEventsAndDashboard(queryClient);
      notifySuccess(t("message.unarchived"));
    },
    onError: (error) => {
      showError(error, t("message.unarchiveFailed"));
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: (eventId: string) => deleteEvent(eventId),
    onSuccess: async (_, eventId) => {
      await invalidateEventsAndDashboard(queryClient);
      queryClient.removeQueries({ queryKey: queryKeys.events.detail(eventId) });
      notifySuccess(t("message.deleted"));
    },
    onError: (error) => {
      showError(error, t("message.deleteFailed"));
    },
  });

  const votePollMutation = useMutation({
    mutationFn: ({ eventId, optionIds }: { eventId: string; optionIds: string[] }) => votePoll(eventId, optionIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      notifySuccess(t("poll.message.voted"));
    },
    onError: (error) => {
      showError(error, t("poll.message.voteFailed"));
    },
  });

  const drawRaffleMutation = useMutation({
    mutationFn: (eventId: string) => drawRaffle(eventId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.events.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
      ]);
      notifySuccess(t("raffle.message.drawSuccess"));
    },
    onError: (error) => {
      showError(error, t("raffle.message.drawFailed"));
    },
  });

  const duplicateEvent = (event: Event) => {
    duplicateEventMutation.mutate({
      payload: {
        type: event.type,
        title: `${event.title}${t("label.copySuffix")}`,
        description: event.description ?? undefined,
        start_at: new Date(new Date(event.start_at).getTime() + 7 * 24 * 60 * 60_000).toISOString(),
        end_at: event.end_at
          ? new Date(new Date(event.end_at).getTime() + 7 * 24 * 60 * 60_000).toISOString()
          : undefined,
        capacity: event.capacity ?? undefined,
        attachments: event.attachments ?? [],
        auto_archive: event.auto_archive,
      },
    });
  };

  const togglePinnedEvent = (event: Event) => {
    patchEventMutation.mutate({
      id: event.id,
      payload: { pinned: !event.pinned, expected_updated_at: event.updated_at },
    });
  };

  const toggleLockedEvent = (event: Event) => {
    patchEventMutation.mutate({
      id: event.id,
      payload: { signup_locked: !event.signup_locked, expected_updated_at: event.updated_at },
    });
  };

  const deleteEventWithConfirm = async (event: Event): Promise<boolean> => {
    const confirmed = await openConfirm({
      title: t("confirm.delete.title"),
      description: t("confirm.delete.description", { title: event.title }),
      intent: "danger",
    });
    if (!confirmed) return false;
    try {
      await deleteEventMutation.mutateAsync(event.id);
      return true;
    } catch {
      return false;
    }
  };

  return {
    participantPendingEventIds: participantMutations.participantPendingEventIds,
    votePending: votePollMutation.isPending,
    drawRafflePending: drawRaffleMutation.isPending,
    handleJoin: participantMutations.handleJoin,
    handleLeave: participantMutations.handleLeave,
    duplicateEvent,
    togglePinnedEvent,
    toggleLockedEvent,
    archiveEventById: (eventId: string) => archiveEventMutation.mutate(eventId),
    unarchiveEvent: (event: Event) => unarchiveEventMutation.mutate(event),
    deleteEventWithConfirm,
    votePoll: (eventId: string, optionIds: string[]) => votePollMutation.mutate({ eventId, optionIds }),
    drawRaffle: (eventId: string) => drawRaffleMutation.mutate(eventId),
    addParticipant: participantMutations.addParticipant,
    removeParticipant: participantMutations.removeParticipant,
  };
}

type UseEventEditorMutationsParams = {
  eventService: EventService;
  attachmentService: AttachmentService;
  attachmentItems: ImageGridEditorItem[];
  setAttachmentItems: Dispatch<SetStateAction<ImageGridEditorItem[]>>;
  closeEditorAfterSave: () => void;
  showError: (error: unknown, fallbackMessage: string) => void;
};

type EventEditorSnapshot = Omit<EventSaveInput, "attachmentItems">;

export function useEventEditorMutations({
  eventService,
  attachmentService,
  attachmentItems,
  setAttachmentItems,
  closeEditorAfterSave,
  showError,
}: UseEventEditorMutationsParams) {
  const { t } = useTranslation("events");
  const queryClient = useQueryClient();

  const resetAttachmentItems = useCallback(() => {
    setAttachmentItems((current) => {
      attachmentService.releaseItems(current);
      return [];
    });
  }, [attachmentService, setAttachmentItems]);

  const saveEventMutation = useMutation({
    mutationFn: (input: EventSaveInput) => eventService.saveEvent(input),
    onSuccess: async (_, variables) => {
      await invalidateEventsAndDashboard(queryClient);
      notifySuccess(variables.mode === "create" ? t("message.created") : t("message.updated"));
      resetAttachmentItems();
      closeEditorAfterSave();
    },
    onError: (error, variables) => {
      if (error instanceof EventValidationError) {
        if (error.reason === "invalid_capacity") {
          notifyError(t("message.capacityInvalid"));
          return;
        }
        const messageText = error.reason === "missing_start"
          ? t("message.startTimeRequired")
          : error.reason === "missing_title"
            ? t("message.titleRequired")
            : error.reason === "missing_poll_end"
              ? t("poll.message.endRequired")
              : error.reason === "invalid_poll"
                ? t("poll.message.optionsInvalid")
                : error.reason === "missing_raffle_end"
                  ? t("raffle.message.endRequired")
                  : error.reason === "missing_winner_count"
                    ? t("raffle.message.winnerCountRequired")
                    : t("message.missingEventId");
        showError(error, messageText);
        return;
      }
      showError(error, variables.mode === "create" ? t("message.createFailed") : t("message.updateFailed"));
    },
  });

  const handleFilesSelected = useCallback(async (files: File[]) => {
    try {
      const prepared = await attachmentService.prepareFiles(files);
      setAttachmentItems((current) => [...current, ...prepared]);
    } catch (error) {
      showError(error, t("message.createFailed"));
    }
  }, [attachmentService, setAttachmentItems, showError, t]);

  const handleAttachmentDelete = useCallback((item: ImageGridEditorItem) => {
    attachmentService.releaseItem(item);
    setAttachmentItems((current) => current.filter((candidate) => candidate.id !== item.id));
  }, [attachmentService, setAttachmentItems]);

  const saveEvent = (editor: EventEditorSnapshot) => {
    saveEventMutation.mutate({ ...editor, attachmentItems });
  };

  return {
    savePending: saveEventMutation.isPending,
    resetAttachmentItems,
    handleFilesSelected,
    handleAttachmentDelete,
    saveEvent,
  };
}
