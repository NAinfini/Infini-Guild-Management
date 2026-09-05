import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryKeys } from "../api/query-keys";
import { fetchUserDetail } from "../services/UserService";
import { viewerIdentity } from "../session-storage";
import {
  useAdminMemberMediaController,
  type AdminMemberMediaState,
} from "../components/feature/admin/useAdminMemberMediaController";
import type { AdminMemberEditRevisions, AdminUserRow, MemberDetailFormState } from "../types/admin";
import { useBeforeUnloadPrompt } from "./useBeforeUnloadPrompt";
import { useConfirmDialog } from "./useConfirmDialog";
import { useTranslation } from "react-i18next";

const DEFAULT_FORM: MemberDetailFormState = {
  displayName: "",
  power: 0,
  classes: [],
  titleHtml: "",
  bio: "",
  availability: null,
  notes: "",
  role: "",
  isActive: true,
};

const EMPTY_MEDIA_STATE: AdminMemberMediaState = {
  memberId: null,
  hasPendingChanges: false,
  isInFlight: false,
  discardPendingChanges: () => {},
};

type UseAdminMemberDetailParams = {
  memberSearchParam: string | undefined;
  currentUserId?: string;
  showError: (error: unknown, fallbackMessage: string) => void;
};

type MemberDetailBaseline = {
  form: MemberDetailFormState;
  revisions: AdminMemberEditRevisions;
  supersededProfileRevisionToken: string | null;
};

function formFromMember(target: AdminUserRow): MemberDetailFormState {
  return {
    displayName: target.user.display_name,
    power: target.profile.power,
    classes: [...target.profile.classes],
    titleHtml: target.profile.title_html ?? "",
    bio: target.profile.bio ?? "",
    availability: target.profile.availability === null ? null : structuredClone(target.profile.availability),
    notes: target.profile.notes ?? "",
    role: target.user.role,
    isActive: target.user.is_active,
  };
}

function cloneForm(form: MemberDetailFormState): MemberDetailFormState {
  return structuredClone(form);
}

function formsMatch(left: MemberDetailFormState, right: MemberDetailFormState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function useAdminMemberDetail({
  memberSearchParam,
  currentUserId,
  showError,
}: UseAdminMemberDetailParams) {
  const { t } = useTranslation("common");
  const confirm = useConfirmDialog();
  const queryClient = useQueryClient();
  const [memberDetailId, setMemberDetailIdState] = useState<string | null>(null);
  const [createMemberModalOpen, setCreateMemberModalOpen] = useState(false);
  const createMemberModalHandlers = useMemo(() => ({
    open: () => setCreateMemberModalOpen(true),
    close: () => setCreateMemberModalOpen(false),
  }), []);
  const [memberDetailForm, setMemberDetailForm] = useState<MemberDetailFormState>(DEFAULT_FORM);
  const [savedForm, setSavedForm] = useState<MemberDetailFormState>(DEFAULT_FORM);
  const [, setMemberDetailRevisionVersion] = useState(0);
  const baselineByMemberRef = useRef(new Map<string, MemberDetailBaseline>());
  const formMemberIdRef = useRef<string | null>(null);
  const memberDetailIdRef = useRef<string | null>(null);
  const memberDetailFormRef = useRef(memberDetailForm);
  const memberMediaStateRef = useRef<AdminMemberMediaState>(EMPTY_MEDIA_STATE);
  const appliedMemberSearchParamRef = useRef<string | null | undefined>(undefined);
  memberDetailIdRef.current = memberDetailId;
  memberDetailFormRef.current = memberDetailForm;

  const memberDetailQuery = useQuery({
    queryKey: queryKeys.users.detail(viewerIdentity(currentUserId), "internal", memberDetailId),
    queryFn: ({ signal }) => fetchUserDetail(memberDetailId!, { signal }),
    enabled: memberDetailId !== null && Boolean(currentUserId),
  });
  const selectedMemberDetail = memberDetailQuery.data ?? null;

  // Sync form state when selected member changes
  useEffect(() => {
    if (!memberDetailId) {
      formMemberIdRef.current = null;
      setMemberDetailForm(DEFAULT_FORM);
      setSavedForm(DEFAULT_FORM);
      return;
    }
    const target = selectedMemberDetail;
    if (!target) {
      formMemberIdRef.current = memberDetailId;
      setMemberDetailForm(DEFAULT_FORM);
      setSavedForm(DEFAULT_FORM);
      return;
    }
    const synced = formFromMember(target);
    const previousBaseline = baselineByMemberRef.current.get(memberDetailId);
    const sameMember = formMemberIdRef.current === memberDetailId;
    if (sameMember && previousBaseline && !formsMatch(memberDetailFormRef.current, previousBaseline.form)) {
      return;
    }
    if (
      sameMember
      && previousBaseline?.supersededProfileRevisionToken === target.edit_revisions?.profile_revision_token
    ) {
      return;
    }
    if (!target.edit_revisions) {
      formMemberIdRef.current = memberDetailId;
      setMemberDetailForm(DEFAULT_FORM);
      setSavedForm(DEFAULT_FORM);
      return;
    }
    formMemberIdRef.current = memberDetailId;
    baselineByMemberRef.current.set(memberDetailId, {
      form: synced,
      revisions: target.edit_revisions,
      supersededProfileRevisionToken: null,
    });
    setMemberDetailForm(synced);
    setSavedForm(synced);
  }, [memberDetailId, selectedMemberDetail]);

  const isDirty = useMemo(
    () => !formsMatch(memberDetailForm, savedForm),
    [memberDetailForm, savedForm],
  );

  useBeforeUnloadPrompt(isDirty);

  const setMemberDetailId = useCallback(async (nextId: string | null) => {
    if (nextId === memberDetailId) return true;
    const mediaState = memberMediaStateRef.current;
    const hasPendingMediaChanges = mediaState.memberId === memberDetailId && mediaState.hasPendingChanges;
    if (hasPendingMediaChanges && mediaState.isInFlight) return false;
    if (isDirty || hasPendingMediaChanges) {
      const confirmed = await confirm({
        title: t("unsavedChanges.title"),
        description: t("unsavedChanges.message"),
        confirmLabel: t("unsavedChanges.leave"),
        cancelLabel: t("unsavedChanges.stay"),
        intent: "warning",
      });
      if (!confirmed) return false;
    }
    if (hasPendingMediaChanges) mediaState.discardPendingChanges();
    setMemberDetailIdState(nextId);
    return true;
  }, [confirm, isDirty, memberDetailId, t]);

  // Keep route-driven selections repeatable; the router blocker owns dirty navigation confirmation.
  useEffect(() => {
    const targetId = memberSearchParam?.trim() || null;
    if (targetId === appliedMemberSearchParamRef.current) return;
    const mediaState = memberMediaStateRef.current;
    if (memberDetailIdRef.current === mediaState.memberId && mediaState.hasPendingChanges) {
      appliedMemberSearchParamRef.current = targetId;
      return;
    }
    appliedMemberSearchParamRef.current = targetId;
    setMemberDetailIdState(targetId);
  }, [memberSearchParam]);
  /* 放弃草稿：回到最后一次保存过的那份，而不是重新从 member 推一份——保存成功到
     列表刷新之间有一小段时间，member 还是旧值，从它推会把刚存进去的改动又抹掉。 */
  const resetMemberDetailForm = useCallback(() => {
    setMemberDetailForm(cloneForm(savedForm));
  }, [savedForm]);

  const markMemberDetailSaved = useCallback((
    memberId: string,
    form: MemberDetailFormState,
    revisions: AdminMemberEditRevisions,
  ) => {
    const saved = cloneForm(form);
    const previous = baselineByMemberRef.current.get(memberId);
    baselineByMemberRef.current.set(memberId, {
      form: saved,
      revisions,
      supersededProfileRevisionToken: previous?.revisions.profile_revision_token ?? null,
    });
    if (memberDetailIdRef.current === memberId) {
      setSavedForm(saved);
    }
  }, []);

  const acceptMemberProfileRevision = useCallback((memberId: string, profileRevisionToken: string) => {
    const baseline = baselineByMemberRef.current.get(memberId);
    if (!baseline || baseline.revisions.profile_revision_token === profileRevisionToken) return;
    baselineByMemberRef.current.set(memberId, {
      ...baseline,
      revisions: {
        ...baseline.revisions,
        profile_revision_token: profileRevisionToken,
      },
      supersededProfileRevisionToken: baseline.revisions.profile_revision_token,
    });
    if (memberDetailIdRef.current === memberId) {
      setMemberDetailRevisionVersion((current) => current + 1);
    }
  }, []);

  const acceptMemberMediaState = useCallback((state: AdminMemberMediaState) => {
    memberMediaStateRef.current = state;
  }, []);

  const memberDetailRevisions = memberDetailId
    ? baselineByMemberRef.current.get(memberDetailId)?.revisions ?? null
    : null;

  const refreshMemberData = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.all });
  }, [queryClient]);

  const memberMediaController = useAdminMemberMediaController({
    member: selectedMemberDetail,
    currentUserId,
    profileRevisionToken: memberDetailRevisions?.profile_revision_token ?? null,
    onProfileRevision: acceptMemberProfileRevision,
    onMediaStateChange: acceptMemberMediaState,
    onRefresh: refreshMemberData,
    onError: showError,
  });

  return {
    memberDetailId,
    setMemberDetailId,
    memberDetailForm,
    setMemberDetailForm,
    resetMemberDetailForm,
    isDirty,
    markMemberDetailSaved,
    selectedMemberDetail,
    memberDetailQuery,
    memberDetailRevisions,
    createMemberModalOpen,
    createMemberModalHandlers,
    refreshMemberData,
    memberMediaController,
  };
}
