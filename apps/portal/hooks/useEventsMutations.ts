import type { Event, User } from "@guild/shared";
import type { ImageGridEditorItem } from "@portal/types/media";
import { modals } from "@mantine/modals";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess, notifyError } from "../utils/notifications";
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
import { queryKeys } from "../api/query-keys";
import { useEventsParticipantMutations } from "./useEventsParticipantMutations";

type UseEventsMutationsParams = {
  canInteract: boolean;
  user: User | null | undefined;
  eventService: EventService;
  attachmentService: AttachmentService;
  attachmentItems: ImageGridEditorItem[];
  setAttachmentItems: Dispatch<SetStateAction<ImageGridEditorItem[]>>;
  eventById: Map<string, Event>;
  joinedEventRanges: Array<{ eventId: string; title: string; startMs: number; endMs: number }>;
  closeEditorAfterSave: () => void;
  showError: (error: unknown, fallbackMessage: string) => void;
};

type EventEditorSnapshot = Omit<EventSaveInput, "attachmentItems">;

export function useEventsMutations({
  canInteract,
  user,
  eventService,
  attachmentService,
  attachmentItems,
  setAttachmentItems,
  eventById,
  joinedEventRanges,
  closeEditorAfterSave,
  showError,
}: UseEventsMutationsParams) {
  const { t } = useTranslation("events");
  const queryClient = useQueryClient();

  const invalidateEventsAndDashboard = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.guildWar.events() });
  };

  const resetAttachmentItems = useCallback(() => {
    setAttachmentItems((current) => {
      attachmentService.releaseItems(current);
      return [];
    });
  }, [attachmentService, setAttachmentItems]);

  const openConfirm = useCallback(
    (options: { title: string; description?: string; intent: "neutral" | "warning" | "danger" }) =>
      new Promise<boolean>((resolve) => {
        modals.openConfirmModal({
          title: options.title,
          children: options.description,
          confirmProps: {
            color:
              options.intent === "danger"
                ? "red"
                : options.intent === "warning"
                  ? "yellow"
                  : "blue",
          },
          labels: { confirm: t("common:action.confirm"), cancel: t("common:action.cancel") },
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
          closeOnConfirm: true,
          closeOnCancel: true,
          centered: true,
        });
      }),
    [t],
  );

  const participantMutations = useEventsParticipantMutations({
    canInteract,
    user,
    eventById,
    joinedEventRanges,
    showError,
  });

  const saveEventMutation = useMutation({
    mutationFn: (input: EventSaveInput) => eventService.saveEvent(input),
    onSuccess: async (_, variables) => {
      await invalidateEventsAndDashboard();
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

  const duplicateEventMutation = useMutation({
    mutationFn: ({ payload, files }: { payload: Parameters<typeof createEvent>[0]; files?: File[] }) =>
      createEvent(payload, files),
    onSuccess: async () => {
      await invalidateEventsAndDashboard();
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
      await invalidateEventsAndDashboard();
      notifySuccess(t("message.updated"));
    },
    onError: (error) => {
      showError(error, t("message.updateFailed"));
    },
  });

  const archiveEventMutation = useMutation({
    mutationFn: (eventId: string) => archiveEvent(eventId),
    onSuccess: async () => {
      await invalidateEventsAndDashboard();
      notifySuccess(t("message.archived"));
    },
    onError: (error) => {
      showError(error, t("message.archiveFailed"));
    },
  });

  const unarchiveEventMutation = useMutation({
    mutationFn: (eventId: string) => updateEvent(eventId, { archived_at: null }),
    onSuccess: async () => {
      await invalidateEventsAndDashboard();
      notifySuccess(t("message.unarchived"));
    },
    onError: (error) => {
      showError(error, t("message.unarchiveFailed"));
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: (eventId: string) => deleteEvent(eventId),
    onSuccess: async () => {
      await invalidateEventsAndDashboard();
      notifySuccess(t("message.deleted"));
    },
    onError: (error) => {
      showError(error, t("message.deleteFailed"));
    },
  });

  const votePollMutation = useMutation({
    mutationFn: ({ eventId, optionIds }: { eventId: string; optionIds: string[] }) => votePoll(eventId, optionIds),
    onSuccess: async (_, { eventId }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.previewDetails() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      notifySuccess(t("poll.message.voted"));
    },
    onError: (error) => {
      showError(error, t("poll.message.voteFailed"));
    },
  });

  const drawRaffleMutation = useMutation({
    mutationFn: (eventId: string) => drawRaffle(eventId),
    onSuccess: async (_, eventId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.previewDetails() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      notifySuccess(t("raffle.message.drawSuccess"));
    },
    onError: (error) => {
      showError(error, t("raffle.message.drawFailed"));
    },
  });

  const handleJoin = participantMutations.handleJoin;
  const handleLeave = participantMutations.handleLeave;

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      try {
        const prepared = await attachmentService.prepareFiles(files);
        setAttachmentItems((current) => [...current, ...prepared]);
      } catch (error) {
        showError(error, t("message.createFailed"));
      }
    },
    [attachmentService, setAttachmentItems, showError, t],
  );

  const handleAttachmentDelete = useCallback(
    (item: ImageGridEditorItem) => {
      attachmentService.releaseItem(item);
      setAttachmentItems((current) => current.filter((candidate) => candidate.id !== item.id));
    },
    [attachmentService, setAttachmentItems],
  );

  const saveEvent = (editor: EventEditorSnapshot) => {
    saveEventMutation.mutate({
      ...editor,
      attachmentItems,
    });
  };

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
      payload: { pinned: !event.pinned },
    });
  };

  const toggleLockedEvent = (event: Event) => {
    patchEventMutation.mutate({
      id: event.id,
      payload: { signup_locked: !event.signup_locked },
    });
  };

  const archiveEventById = (eventId: string) => {
    archiveEventMutation.mutate(eventId);
  };

  const unarchiveEventById = (eventId: string) => {
    unarchiveEventMutation.mutate(eventId);
  };

  const deleteEventWithConfirm = async (event: Event) => {
    const confirmed = await openConfirm({
      title: t("confirm.delete.title"),
      description: t("confirm.delete.description", { title: event.title }),
      intent: "danger",
    });
    if (confirmed) {
      deleteEventMutation.mutate(event.id);
    }
  };

  return {
    createPending: saveEventMutation.isPending || duplicateEventMutation.isPending,
    updatePending: saveEventMutation.isPending || patchEventMutation.isPending,
    archivePending: archiveEventMutation.isPending,
    savePending: saveEventMutation.isPending,
    joinPending: participantMutations.joinPending,
    leavePending: participantMutations.leavePending,
    votePending: votePollMutation.isPending,
    drawRafflePending: drawRaffleMutation.isPending,
    resetAttachmentItems,
    handleJoin,
    handleLeave,
    handleFilesSelected,
    handleAttachmentDelete,
    saveEvent,
    duplicateEvent,
    togglePinnedEvent,
    toggleLockedEvent,
    archiveEventById,
    unarchiveEventById,
    deleteEventWithConfirm,
    votePoll: (eventId: string, optionIds: string[]) => votePollMutation.mutate({ eventId, optionIds }),
    drawRaffle: (eventId: string) => drawRaffleMutation.mutate(eventId),
    addParticipant: participantMutations.addParticipant,
    removeParticipant: participantMutations.removeParticipant,
  };
}
