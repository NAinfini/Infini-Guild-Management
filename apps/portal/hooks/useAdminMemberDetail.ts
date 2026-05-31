import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { queryKeys } from "../api/query-keys";
import type { MemberDetailFormState } from "../components/feature/admin/AdminMemberDetailModal";
import { useAdminMemberMediaController } from "../components/feature/admin/useAdminMemberMediaController";
import { useBeforeUnloadPrompt } from "./useBeforeUnloadPrompt";
import type { UsersListResponse } from "../services/UserService";

type AdminUserRow = UsersListResponse["data"][number];

const DEFAULT_FORM: MemberDetailFormState = {
  power: 0,
  classes: [],
  titleHtml: "",
  bio: "",
  notes: "",
  vacationStart: "",
  vacationEnd: "",
  role: "member",
  isActive: true,
};

type UseAdminMemberDetailParams = {
  usersData: AdminUserRow[] | undefined;
  memberSearchParam: string | undefined;
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useAdminMemberDetail({
  usersData,
  memberSearchParam,
  showError,
}: UseAdminMemberDetailParams) {
  const queryClient = useQueryClient();
  const [memberDetailId, setMemberDetailId] = useState<string | null>(null);
  const [createMemberModalOpen, createMemberModalHandlers] = useDisclosure(false);
  const memberSearchParamConsumedRef = useRef(false);
  const [memberDetailForm, setMemberDetailForm] = useState<MemberDetailFormState>(DEFAULT_FORM);
  const savedFormRef = useRef<MemberDetailFormState>(DEFAULT_FORM);

  // Sync form state when selected member changes
  useEffect(() => {
    if (!memberDetailId) {
      setMemberDetailForm(DEFAULT_FORM);
      savedFormRef.current = DEFAULT_FORM;
      return;
    }
    const target = usersData?.find((row) => row.user.id === memberDetailId);
    if (!target) {
      setMemberDetailForm(DEFAULT_FORM);
      savedFormRef.current = DEFAULT_FORM;
      return;
    }
    const synced: MemberDetailFormState = {
      power: target.profile.power,
      classes: [...target.profile.classes],
      titleHtml: target.profile.title_html ?? "",
      bio: target.profile.bio ?? "",
      notes: target.profile.notes ?? "",
      vacationStart: target.profile.vacation_start ? target.profile.vacation_start.slice(0, 10) : "",
      vacationEnd: target.profile.vacation_end ? target.profile.vacation_end.slice(0, 10) : "",
      role: target.user.role,
      isActive: target.user.is_active,
    };
    setMemberDetailForm(synced);
    savedFormRef.current = synced;
  }, [memberDetailId, usersData]);

  const isDirty = useMemo(
    () => JSON.stringify(memberDetailForm) !== JSON.stringify(savedFormRef.current),
    [memberDetailForm],
  );

  useBeforeUnloadPrompt(isDirty);

  // Auto-open member detail when navigated with ?member=username
  useEffect(() => {
    if (!memberSearchParam || memberSearchParamConsumedRef.current) return;
    if (!usersData) return;
    const target = usersData.find(
      (row) => row.user.username.toLowerCase() === memberSearchParam.toLowerCase(),
    );
    if (target) {
      memberSearchParamConsumedRef.current = true;
      setMemberDetailId(target.user.id);
    }
  }, [memberSearchParam, usersData]);

  const selectedMemberDetail = memberDetailId
    ? usersData?.find((row) => row.user.id === memberDetailId) ?? null
    : null;

  const refreshMemberData = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.all });
  }, [queryClient]);

  const memberMediaController = useAdminMemberMediaController({
    member: selectedMemberDetail,
    onRefresh: refreshMemberData,
    onError: showError,
  });

  return {
    memberDetailId,
    setMemberDetailId,
    memberDetailForm,
    setMemberDetailForm,
    selectedMemberDetail,
    createMemberModalOpen,
    createMemberModalHandlers,
    refreshMemberData,
    memberMediaController,
  };
}
