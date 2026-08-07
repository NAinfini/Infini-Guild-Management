import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { queryKeys } from "../api/query-keys";
import { useAdminMemberMediaController } from "../components/feature/admin/useAdminMemberMediaController";
import type { AdminUserRow, MemberDetailFormState } from "../types/admin";
import { useBeforeUnloadPrompt } from "./useBeforeUnloadPrompt";
import { useConfirmDialog } from "./useConfirmDialog";
import { useTranslation } from "react-i18next";

const DEFAULT_FORM: MemberDetailFormState = {
  power: 0,
  classes: [],
  titleHtml: "",
  bio: "",
  notes: "",
  role: "",
  isActive: true,
};

type UseAdminMemberDetailParams = {
  usersData: AdminUserRow[] | undefined;
  memberSearchParam: string | undefined;
  showError: (error: unknown, fallbackMessage: string) => void;
};

function formFromMember(target: AdminUserRow): MemberDetailFormState {
  return {
    power: target.profile.power,
    classes: [...target.profile.classes],
    titleHtml: target.profile.title_html ?? "",
    bio: target.profile.bio ?? "",
    notes: target.profile.notes ?? "",
    role: target.user.role,
    isActive: target.user.is_active,
  };
}

function formsMatch(left: MemberDetailFormState, right: MemberDetailFormState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function useAdminMemberDetail({
  usersData,
  memberSearchParam,
  showError,
}: UseAdminMemberDetailParams) {
  const { t } = useTranslation("common");
  const confirm = useConfirmDialog();
  const queryClient = useQueryClient();
  const [memberDetailId, setMemberDetailIdState] = useState<string | null>(null);
  const [createMemberModalOpen, createMemberModalHandlers] = useDisclosure(false);
  const [memberDetailForm, setMemberDetailForm] = useState<MemberDetailFormState>(DEFAULT_FORM);
  const [savedForm, setSavedForm] = useState<MemberDetailFormState>(DEFAULT_FORM);
  const baselineByMemberRef = useRef(new Map<string, MemberDetailFormState>());
  const formMemberIdRef = useRef<string | null>(null);
  const memberDetailIdRef = useRef<string | null>(null);
  const memberDetailFormRef = useRef(memberDetailForm);
  const appliedMemberSearchParamRef = useRef<string | null | undefined>(undefined);
  memberDetailIdRef.current = memberDetailId;
  memberDetailFormRef.current = memberDetailForm;

  // Sync form state when selected member changes
  useEffect(() => {
    if (!memberDetailId) {
      formMemberIdRef.current = null;
      setMemberDetailForm(DEFAULT_FORM);
      setSavedForm(DEFAULT_FORM);
      return;
    }
    const target = usersData?.find((row) => row.user.id === memberDetailId);
    if (!target) {
      formMemberIdRef.current = memberDetailId;
      setMemberDetailForm(DEFAULT_FORM);
      setSavedForm(DEFAULT_FORM);
      return;
    }
    const synced = formFromMember(target);
    const previousBaseline = baselineByMemberRef.current.get(memberDetailId);
    const sameMember = formMemberIdRef.current === memberDetailId;
    if (sameMember && previousBaseline && !formsMatch(memberDetailFormRef.current, previousBaseline)) {
      return;
    }
    formMemberIdRef.current = memberDetailId;
    baselineByMemberRef.current.set(memberDetailId, synced);
    setMemberDetailForm(synced);
    setSavedForm(synced);
  }, [memberDetailId, usersData]);

  const isDirty = useMemo(
    () => !formsMatch(memberDetailForm, savedForm),
    [memberDetailForm, savedForm],
  );

  useBeforeUnloadPrompt(isDirty);

  const setMemberDetailId = useCallback(async (nextId: string | null) => {
    if (nextId === memberDetailId) return true;
    if (isDirty) {
      const confirmed = await confirm({
        title: t("unsavedChanges.title"),
        description: t("unsavedChanges.message"),
        confirmLabel: t("unsavedChanges.leave"),
        cancelLabel: t("unsavedChanges.stay"),
        intent: "warning",
      });
      if (!confirmed) return false;
    }
    setMemberDetailIdState(nextId);
    return true;
  }, [confirm, isDirty, memberDetailId, t]);

  // Keep route-driven selections repeatable; the router blocker owns dirty navigation confirmation.
  useEffect(() => {
    const normalizedParam = memberSearchParam?.trim().toLowerCase() || null;
    if (normalizedParam === appliedMemberSearchParamRef.current) return;
    if (normalizedParam === null) {
      appliedMemberSearchParamRef.current = null;
      setMemberDetailIdState(null);
      return;
    }
    if (!usersData) return;
    const target = usersData.find(
      (row) => row.user.username.toLowerCase() === normalizedParam,
    );
    if (target) {
      appliedMemberSearchParamRef.current = normalizedParam;
      setMemberDetailIdState(target.user.id);
    }
  }, [memberSearchParam, usersData]);

  const markMemberDetailSaved = useCallback((
    memberId: string,
    form: MemberDetailFormState,
  ) => {
    const saved = { ...form, classes: [...form.classes] };
    baselineByMemberRef.current.set(memberId, saved);
    if (memberDetailIdRef.current === memberId) {
      setSavedForm(saved);
    }
  }, []);

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
    isDirty,
    markMemberDetailSaved,
    selectedMemberDetail,
    createMemberModalOpen,
    createMemberModalHandlers,
    refreshMemberData,
    memberMediaController,
  };
}
