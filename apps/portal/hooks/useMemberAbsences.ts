import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CreateMemberAbsencePayload } from "@guild/shared";
import { queryKeys } from "../api/query-keys";
import {
  createMemberAbsence,
  deleteMemberAbsence,
  fetchUserAbsences,
} from "../services/UserService";
import { useAppError } from "./useAppError";
import { notifySuccess } from "../utils/notifications";

export function useMemberAbsences(userId: string | undefined) {
  const { t } = useTranslation("profile");
  const queryClient = useQueryClient();
  const { showError } = useAppError();

  const absencesQuery = useQuery({
    queryKey: queryKeys.absences.user(userId),
    queryFn: () => fetchUserAbsences(userId!),
    enabled: Boolean(userId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.absences.all });
    // Roster/profile payloads derive vacation_start/vacation_end from absences.
    await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.all });
  };

  const createMutation = useMutation({
    mutationFn: (payload: CreateMemberAbsencePayload) => {
      if (!userId) throw new Error("Missing target user");
      return createMemberAbsence(userId, payload);
    },
    onSuccess: async () => {
      await invalidate();
      notifySuccess(t("absence.message.created"));
    },
    onError: (error) => {
      showError(error, t("absence.message.createFailed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (absenceId: string) => {
      if (!userId) throw new Error("Missing target user");
      return deleteMemberAbsence(userId, absenceId);
    },
    onSuccess: async () => {
      await invalidate();
      notifySuccess(t("absence.message.deleted"));
    },
    onError: (error) => {
      showError(error, t("absence.message.deleteFailed"));
    },
  });

  return {
    absencesQuery,
    createMutation,
    deleteMutation,
  };
}
