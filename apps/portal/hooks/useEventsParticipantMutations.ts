import type { User } from "@guild/shared";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "../utils/notifications";
import {
  addEventParticipants,
  joinEvent,
  leaveEvent,
  removeEventParticipants,
  type EventDetailResponse,
} from "../services/EventService";
import { queryKeys } from "../api/query-keys";
import { useKeyedPending } from "./useKeyedPending";

type EventDetailPayload = EventDetailResponse;

type UseEventsParticipantMutationsParams = {
  canInteract: boolean;
  user: User | null | undefined;
  eventById: Map<string, { id: string; start_at: string; end_at?: string | null; title?: string }>;
  joinedEventRanges: Array<{ eventId: string; title: string; startMs: number; endMs: number }>;
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useEventsParticipantMutations({
  canInteract,
  user,
  eventById,
  joinedEventRanges,
  showError,
}: UseEventsParticipantMutationsParams) {
  const { t } = useTranslation("events");
  const confirm = useConfirmDialog();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pendingKeys: participantPendingEventIds, runPending } = useKeyedPending();

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

  const joinMutation = useMutation({
    mutationFn: (eventId: string) => joinEvent(eventId),
    onMutate: async (eventId) => {
      if (!user) {
        return undefined;
      }
      await queryClient.cancelQueries({ queryKey: queryKeys.events.previewDetails() });
      await queryClient.cancelQueries({ queryKey: queryKeys.events.detail(eventId) });

      const previousPreview = queryClient.getQueriesData<EventDetailPayload[]>({
        queryKey: queryKeys.events.previewDetails(),
      });
      const previousDetail = queryClient.getQueryData<EventDetailPayload>(queryKeys.events.detail(eventId));
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

      queryClient.setQueryData<EventDetailPayload>(queryKeys.events.detail(eventId), (current) => {
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      notifySuccess(t("message.joined"));
    },
    onError: (error, eventId, context) => {
      if (context) {
        for (const [key, previous] of context.previousPreview) {
          queryClient.setQueryData(key, previous);
        }
        queryClient.setQueryData(queryKeys.events.detail(eventId), context.previousDetail);
      }
      showError(error, t("message.joinFailed"));
    },
    onSettled: async (_, __, eventId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) });
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
      await queryClient.cancelQueries({ queryKey: queryKeys.events.detail(eventId) });

      const previousPreview = queryClient.getQueriesData<EventDetailPayload[]>({
        queryKey: queryKeys.events.previewDetails(),
      });
      const previousDetail = queryClient.getQueryData<EventDetailPayload>(queryKeys.events.detail(eventId));

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

      queryClient.setQueryData<EventDetailPayload>(queryKeys.events.detail(eventId), (current) => {
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      notifySuccess(t("message.left"));
    },
    onError: (error, eventId, context) => {
      if (context) {
        for (const [key, previous] of context.previousPreview) {
          queryClient.setQueryData(key, previous);
        }
        queryClient.setQueryData(queryKeys.events.detail(eventId), context.previousDetail);
      }
      showError(error, t("message.leaveFailed"));
    },
    onSettled: async (_, __, eventId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.previewDetails() });
    },
  });

  const addParticipantMutation = useMutation({
    mutationFn: ({ eventId, userId }: { eventId: string; userId: string }) =>
      addEventParticipants(eventId, [userId]),
    onSuccess: async (_, { eventId }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.previewDetails() });
      notifySuccess(t("message.memberAdded"));
    },
    onError: (error) => {
      showError(error, t("message.memberAddFailed"));
    },
  });

  const removeParticipantMutation = useMutation({
    mutationFn: ({ eventId, userId }: { eventId: string; userId: string }) =>
      removeEventParticipants(eventId, [userId]),
    onSuccess: async (_, { eventId }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.previewDetails() });
      notifySuccess(t("message.memberRemoved"));
    },
    onError: (error) => {
      showError(error, t("message.memberRemoveFailed"));
    },
  });

  const handleJoin = (eventId: string) => runPending(eventId, async () => {
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
      await joinMutation.mutateAsync(eventId);
      return;
    }
    const targetStart = Date.parse(target.start_at);
    const targetEnd = Date.parse(target.end_at ?? target.start_at);
    if (!Number.isFinite(targetStart) || !Number.isFinite(targetEnd)) {
      await joinMutation.mutateAsync(eventId);
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
        await joinMutation.mutateAsync(eventId);
      }
      return;
    }

    await joinMutation.mutateAsync(eventId);
  });

  const handleLeave = (eventId: string) => runPending(eventId, async () => {
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
      await leaveMutation.mutateAsync(eventId);
    }
  });

  const addParticipant = (eventId: string, userId: string) => {
    void runPending(eventId, () => addParticipantMutation.mutateAsync({ eventId, userId }));
  };

  const removeParticipant = (eventId: string, userId: string) => {
    void runPending(eventId, () => removeParticipantMutation.mutateAsync({ eventId, userId }));
  };

  return {
    participantPendingEventIds,
    handleJoin,
    handleLeave,
    addParticipant,
    removeParticipant,
  };
}
