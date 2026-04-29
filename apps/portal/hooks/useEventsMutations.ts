import type { Event, User } from "@guild/shared";
import type { ImageGridEditorItem } from "@guild/shared/types/media";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AttachmentService } from "../services/AttachmentService";
import {
  addEventParticipant,
  archiveEvent,
  createEvent,
  deleteEvent,
  EventService,
  EventValidationError,
  type EventDetailResponse,
  type EventSaveInput,
  joinEvent,
  leaveEvent,
  removeEventParticipant,
  updateEvent,
} from "../services/EventService";
import { queryKeys } from "../api/query-keys";

type EventDetailPayload = EventDetailResponse;

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
          closeOnConfirm: true,
          closeOnCancel: true,
          centered: true,
        });
      }),
    [],
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

      queryClient.setQueryData<EventDetailPayload>(queryKeys.event.detail(eventId), (current) => {
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      notifications.show({ color: "green", message: t("message.joined") });
    },
    onError: (error, eventId, context) => {
      if (context) {
        for (const [key, previous] of context.previousPreview) {
          queryClient.setQueryData(key, previous);
        }
        queryClient.setQueryData(queryKeys.event.detail(eventId), context.previousDetail);
      }
      showError(error, t("message.joinFailed"));
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

      queryClient.setQueryData<EventDetailPayload>(queryKeys.event.detail(eventId), (current) => {
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      notifications.show({ color: "green", message: t("message.left") });
    },
    onError: (error, eventId, context) => {
      if (context) {
        for (const [key, previous] of context.previousPreview) {
          queryClient.setQueryData(key, previous);
        }
        queryClient.setQueryData(queryKeys.event.detail(eventId), context.previousDetail);
      }
      showError(error, t("message.leaveFailed"));
    },
    onSettled: async (_, __, eventId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.event.detail(eventId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.previewDetails() });
    },
  });

  const saveEventMutation = useMutation({
    mutationFn: (input: EventSaveInput) => eventService.saveEvent(input),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      notifications.show({
        color: "green",
        message: variables.mode === "create" ? t("message.created") : t("message.updated"),
      });
      resetAttachmentItems();
      closeEditorAfterSave();
    },
    onError: (error, variables) => {
      if (error instanceof EventValidationError) {
        if (error.reason === "invalid_capacity") {
          notifications.show({ color: "red", message: t("message.capacityInvalid") });
          return;
        }
        const messageText = error.reason === "missing_start"
          ? t("message.startTimeRequired")
          : error.reason === "missing_title"
            ? t("message.titleRequired")
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      notifications.show({ color: "green", message: t("message.created") });
    },
    onError: (error) => {
      showError(error, t("message.createFailed"));
    },
  });

  const patchEventMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateEvent>[1] }) =>
      updateEvent(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      notifications.show({ color: "green", message: t("message.updated") });
    },
    onError: (error) => {
      showError(error, t("message.updateFailed"));
    },
  });

  const archiveEventMutation = useMutation({
    mutationFn: (eventId: string) => archiveEvent(eventId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      notifications.show({ color: "green", message: t("message.archived") });
    },
    onError: (error) => {
      showError(error, t("message.archiveFailed"));
    },
  });

  const unarchiveEventMutation = useMutation({
    mutationFn: (eventId: string) => updateEvent(eventId, { archived_at: null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      notifications.show({ color: "green", message: t("message.unarchived") });
    },
    onError: (error) => {
      showError(error, t("message.unarchiveFailed"));
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: (eventId: string) => deleteEvent(eventId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      notifications.show({ color: "green", message: t("message.deleted") });
    },
    onError: (error) => {
      showError(error, t("message.deleteFailed"));
    },
  });

  const addParticipantMutation = useMutation({
    mutationFn: ({ eventId, userId }: { eventId: string; userId: string }) =>
      addEventParticipant(eventId, userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      notifications.show({ color: "green", message: t("message.memberAdded") });
    },
    onError: (error) => {
      showError(error, t("message.memberAddFailed"));
    },
  });

  const removeParticipantMutation = useMutation({
    mutationFn: ({ eventId, userId }: { eventId: string; userId: string }) =>
      removeEventParticipant(eventId, userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      notifications.show({ color: "green", message: t("message.memberRemoved") });
    },
    onError: (error) => {
      showError(error, t("message.memberRemoveFailed"));
    },
  });

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
      const shouldJoin = await openConfirm({
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

  const handleLeave = async (eventId: string) => {
    if (!user || !canInteract) {
      return;
    }
    const event = eventById.get(eventId);
    const confirmed = await openConfirm({
      title: t("confirm.leave.title"),
      description: t("confirm.leave.description", { title: event?.title ?? "" }),
      intent: "warning",
    });
    if (confirmed) {
      leaveMutation.mutate(eventId);
    }
  };

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

  const addParticipant = (eventId: string, userId: string) => {
    addParticipantMutation.mutate({ eventId, userId });
  };

  const removeParticipant = (eventId: string, userId: string) => {
    removeParticipantMutation.mutate({ eventId, userId });
  };

  return {
    createPending: saveEventMutation.isPending || duplicateEventMutation.isPending,
    updatePending: saveEventMutation.isPending || patchEventMutation.isPending,
    archivePending: archiveEventMutation.isPending,
    savePending: saveEventMutation.isPending,
    joinPending: joinMutation.isPending,
    leavePending: leaveMutation.isPending,
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
    addParticipant,
    removeParticipant,
  };
}
