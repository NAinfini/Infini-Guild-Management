import type { MemberBadge } from "@guild/shared";
import { arrayMove } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
  assignBadge,
  createBadge,
  deleteBadge,
  fetchBadgeAssignments,
  fetchBadges,
  reorderBadges,
  unassignBadge,
  updateBadge,
} from "../services/AdminService";
import type { CreateBadgePayload, UpdateBadgePayload } from "../services/AdminService";
import { queryKeys } from "../api/query-keys";
import { notifyError, notifySuccess } from "../utils/notifications";
import { useAppError } from "./useAppError";
import { useAdminPendingActions } from "./useAdminPendingActions";

/* sort_order 不在表单里：顺序由左栏拖拽决定，走整表重排接口。留在表单里的话
   同一份顺序有两个写入口——保存表单会把编辑器打开那一刻的旧数字写回去，把中间
   发生过的拖拽抹掉。新建时也不传，服务端排到末尾。 */
export type BadgeForm = {
  name: string;
  label_html: string;
  color: string;
  description: string;
};

export const EMPTY_BADGE_FORM: BadgeForm = {
  name: "",
  label_html: "",
  color: "#D4A843",
  description: "",
};

type BadgeDraft = {
  id: string | null;
  form: BadgeForm;
  memberIds: string[];
};

const EMPTY_BADGE_DRAFT: BadgeDraft = {
  id: null,
  form: EMPTY_BADGE_FORM,
  memberIds: [],
};

function toBadgeForm(badge: MemberBadge): BadgeForm {
  return {
    name: badge.name,
    label_html: badge.label_html,
    color: badge.color,
    description: badge.description ?? "",
  };
}

function normalizeMemberIds(memberIds: Iterable<string>) {
  return [...new Set(memberIds)].sort();
}

function toBadgeDraft(badge: MemberBadge, memberIds: Iterable<string> = []): BadgeDraft {
  return {
    id: badge.id,
    form: toBadgeForm(badge),
    memberIds: normalizeMemberIds(memberIds),
  };
}

function sameBadgeForm(left: BadgeForm, right: BadgeForm) {
  return left.name === right.name
    && left.label_html === right.label_html
    && left.color === right.color
    && left.description === right.description;
}

function sameBadgeDraft(left: BadgeDraft, right: BadgeDraft) {
  return left.id === right.id
    && sameBadgeForm(left.form, right.form)
    && left.memberIds.length === right.memberIds.length
    && left.memberIds.every((id, index) => id === right.memberIds[index]);
}

function toCreateBadgePayload(form: BadgeForm): CreateBadgePayload {
  return {
    name: form.name,
    label_html: form.label_html,
    color: form.color,
    description: form.description || undefined,
  };
}

function toUpdateBadgePayload(form: BadgeForm): UpdateBadgePayload {
  return {
    name: form.name,
    label_html: form.label_html,
    color: form.color,
    description: form.description || null,
  };
}

export function useAdminBadgesController(enabled: boolean) {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const { showError } = useAppError();
  const [explicitBadgeId, setExplicitBadgeId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<BadgeDraft>(EMPTY_BADGE_DRAFT);
  const [baseline, setBaseline] = useState<BadgeDraft>(EMPTY_BADGE_DRAFT);
  const [memberSearch, setMemberSearch] = useState("");
  const { isActionPending, runPendingAction, runPendingActions } = useAdminPendingActions();

  const badgesQuery = useQuery({
    queryKey: queryKeys.badges.list(),
    queryFn: fetchBadges,
    enabled,
    staleTime: 5 * 60_000,
  });

  const badges = badgesQuery.data ?? [];
  const selectedBadgeId = explicitBadgeId;

  const assignmentsQuery = useQuery({
    queryKey: queryKeys.badges.assignments(selectedBadgeId ?? ""),
    queryFn: () => fetchBadgeAssignments(selectedBadgeId as string),
    enabled: enabled && Boolean(selectedBadgeId),
    staleTime: 2 * 60_000,
  });

  const assignments = assignmentsQuery.data ?? [];
  const selectedBadge = badges.find((badge) => badge.id === selectedBadgeId) ?? null;
  const assignedUserIds = useMemo(() => new Set(assignments.map((assignment) => assignment.user_id)), [assignments]);
  const form = draft.form;
  const draftMemberIds = useMemo(() => new Set(draft.memberIds), [draft.memberIds]);
  const baselineMemberIds = useMemo(() => new Set(baseline.memberIds), [baseline.memberIds]);
  const formDirty = useMemo(() => !sameBadgeForm(draft.form, baseline.form), [baseline.form, draft.form]);
  const membershipDirty = useMemo(
    () => draft.memberIds.length !== baseline.memberIds.length
      || draft.memberIds.some((id, index) => id !== baseline.memberIds[index]),
    [baseline.memberIds, draft.memberIds],
  );
  const isDirty = useMemo(() => !sameBadgeDraft(draft, baseline), [baseline, draft]);

  /*
   * 不变量：选中的永远是列表里真实存在的一枚。进页面、删掉一枚、别人删掉了我选的
   * 那一枚，都落到第一枚——右栏不该停在空白详情上。列表空了才回到没有选中。
   *
   * 落一次就钉住，不是每次渲染都取第一枚：后者会让拖拽排序把选中项一起挪走，
   * 明明只是换了顺序，右栏却换了内容。
   *
   * 新建期间不落：右栏此刻是新建表单，选中一枚只会让它在保存前先闪一下别的徽章。
   */
  useEffect(() => {
    if (isCreating) return;
    if (explicitBadgeId && badges.some((badge) => badge.id === explicitBadgeId)) return;
    const nextBadge = badges[0] ?? null;
    setExplicitBadgeId(nextBadge?.id ?? null);
    if (nextBadge) {
      const nextDraft = toBadgeDraft(nextBadge);
      setDraft(nextDraft);
      setBaseline(nextDraft);
    }
  }, [badges, explicitBadgeId, isCreating]);

  /* A selected badge is editable immediately. Its membership baseline arrives from a
     separate request, so only that part of the draft is synchronized when it resolves;
     an admin's in-progress field edits stay intact. */
  useEffect(() => {
    if (isCreating || !selectedBadge || !assignmentsQuery.isSuccess) return;
    const memberIds = normalizeMemberIds(assignments.map((assignment) => assignment.user_id));

    setBaseline((current) => current.id === selectedBadge.id && membershipDirty
      ? current
      : current.id === selectedBadge.id
        ? { ...current, memberIds }
        : toBadgeDraft(selectedBadge, memberIds));
    setDraft((current) => current.id === selectedBadge.id && membershipDirty
      ? current
      : current.id === selectedBadge.id
        ? { ...current, memberIds }
        : toBadgeDraft(selectedBadge, memberIds));
  }, [assignments, assignmentsQuery.isSuccess, isCreating, membershipDirty, selectedBadge]);

  const setForm: Dispatch<SetStateAction<BadgeForm>> = (next) => {
    setDraft((current) => ({
      ...current,
      form: typeof next === "function" ? next(current.form) : next,
    }));
  };

  /* 徽章的样子和顺序都随成员一起发出去（名片上挂前两枚），改完徽章这两份缓存
     也就过期了。 */
  const invalidateBadgeConsumers = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.all });
  }, [queryClient]);

  const invalidateBadges = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.badges.all });
    await invalidateBadgeConsumers();
  }, [queryClient, invalidateBadgeConsumers]);

  const createMutation = useMutation({
    mutationFn: createBadge,
    onSuccess: async (data) => {
      notifySuccess(t("badges.message.created"));
      const nextDraft = toBadgeDraft(data);
      setDraft(nextDraft);
      setBaseline(nextDraft);
      setExplicitBadgeId(data.id);
      setIsCreating(false);
      await invalidateBadges();
    },
    onError: (error) => showError(error, t("badges.message.failed")),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; payload: BadgeForm }) => updateBadge(vars.id, toUpdateBadgePayload(vars.payload)),
    onSuccess: async (updated) => {
      notifySuccess(t("badges.message.updated"));
      setBaseline((current) => current.id === updated.id
        ? { ...current, form: toBadgeForm(updated) }
        : current);
      setDraft((current) => current.id === updated.id
        ? { ...current, form: toBadgeForm(updated) }
        : current);
      await invalidateBadges();
    },
    onError: (error) => showError(error, t("badges.message.failed")),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBadge,
    onSuccess: async () => {
      notifySuccess(t("badges.message.deleted"));
      setExplicitBadgeId(null);
      setDraft(EMPTY_BADGE_DRAFT);
      setBaseline(EMPTY_BADGE_DRAFT);
      await invalidateBadges();
    },
    onError: (error) => showError(error, t("badges.message.failed")),
  });

  /*
   * assignBadgeSchema / unassignBadgeSchema 都是一次最多 100 个 user_id。面板里有
   * 「全选当前结果」，公会一旦超过 100 人就能一键越过这个上限，所以按 100 切片顺序发。
   * 不做静默截断：切片是把整件事做完，截断是假装做完了。
   */
  const BATCH = 100;
  const runBatched = async (userIds: string[], call: (chunk: string[]) => Promise<number>) => {
    let total = 0;
    for (let i = 0; i < userIds.length; i += BATCH) {
      total += await call(userIds.slice(i, i + BATCH));
    }
    return total;
  };

  const membershipMutation = useMutation({
    mutationFn: async (vars: { badgeId: string; add: string[]; remove: string[]; memberIds: string[] }) => {
      const assigned = await runBatched(vars.add, async (chunk) => (await assignBadge(vars.badgeId, chunk)).assigned);
      const removed = await runBatched(vars.remove, async (chunk) => (await unassignBadge(vars.badgeId, chunk)).removed);
      return { assigned, removed };
    },
    onSuccess: (data, variables) => {
      notifySuccess(t("badges.message.membershipSaved", { added: data.assigned, removed: data.removed }));
      setBaseline((current) => current.id === variables.badgeId
        ? { ...current, memberIds: variables.memberIds }
        : current);
    },
    onError: (error) => showError(error, t("badges.message.failed")),
    /* 加成功、减失败也要刷新：否则右边名单还停在改动之前，看起来像什么都没发生。 */
    onSettled: () => invalidateBadges(),
  });

  const unassignMutation = useMutation({
    mutationFn: (vars: { badgeId: string; userIds: string[] }) => unassignBadge(vars.badgeId, vars.userIds),
    onSuccess: async (data) => {
      notifySuccess(t("badges.message.unassigned", { count: data.removed }));
      await invalidateBadges();
    },
    onError: (error) => showError(error, t("badges.message.failed")),
  });

  /*
   * 拖拽排序。乐观地把新顺序写进缓存，请求失败再回滚——不这么做的话，松手到
   * 响应回来之间列表会停在旧顺序上，看着像「没拖动」。
   *
   * 失败路径两步都要留着：先回滚到松手前那份，让界面立刻不再撒谎；再作废缓存重拉。
   * 服务端回 409 的典型原因就是本地这份目录已经过期（别人加/删了徽章），那时
   * 「松手前那份」本身也是错的，只有重新拉才是真相。
   */
  const reorderMutation = useMutation({
    mutationFn: (order: string[]) => reorderBadges(order),
    onMutate: async (order: string[]) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.badges.list() });
      const previous = queryClient.getQueryData<MemberBadge[]>(queryKeys.badges.list());
      if (previous) {
        const byId = new Map(previous.map((badge) => [badge.id, badge]));
        queryClient.setQueryData(
          queryKeys.badges.list(),
          order.map((id) => byId.get(id)).filter((badge): badge is MemberBadge => Boolean(badge)),
        );
      }
      return { previous };
    },
    onError: (error, _order, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.badges.list(), context.previous);
      }
      notifyError(error instanceof Error ? error.message : t("badges.message.reorderFailed"));
      void invalidateBadges();
    },
    /* 响应体就是重排后的整张表，直接当新缓存用；再作废一次列表只是把同一份数据
       又拉一遍。名片上挂哪两枚跟着顺序变，所以那两份缓存还是要作废。 */
    onSuccess: async (list) => {
      queryClient.setQueryData(queryKeys.badges.list(), list);
      await invalidateBadgeConsumers();
    },
  });

  const reorder = (activeId: string, overId: string) => {
    const from = badges.findIndex((badge) => badge.id === activeId);
    const to = badges.findIndex((badge) => badge.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    reorderMutation.mutate(arrayMove([...badges], from, to).map((badge) => badge.id));
  };

  const startCreate = () => {
    setIsCreating(true);
    setDraft(EMPTY_BADGE_DRAFT);
    setBaseline(EMPTY_BADGE_DRAFT);
    setExplicitBadgeId(null);
    setMemberSearch("");
  };

  const selectBadge = (badgeId: string) => {
    const nextBadge = badges.find((badge) => badge.id === badgeId);
    setExplicitBadgeId(badgeId);
    setIsCreating(false);
    setMemberSearch("");
    if (nextBadge) {
      const nextDraft = toBadgeDraft(nextBadge);
      setDraft(nextDraft);
      setBaseline(nextDraft);
    }
  };

  const discardChanges = () => {
    if (isCreating) {
      setIsCreating(false);
      setDraft(EMPTY_BADGE_DRAFT);
      setBaseline(EMPTY_BADGE_DRAFT);
      return;
    }
    setDraft(baseline);
  };

  const toggleDraftMember = (userId: string) => {
    setDraft((current) => {
      const next = new Set(current.memberIds);
      if (!next.delete(userId)) next.add(userId);
      return { ...current, memberIds: normalizeMemberIds(next) };
    });
  };

  const draftAdded = useMemo(
    () => draft.memberIds.filter((id) => !baselineMemberIds.has(id)),
    [baselineMemberIds, draft.memberIds],
  );
  const draftRemoved = useMemo(
    () => baseline.memberIds.filter((id) => !draftMemberIds.has(id)),
    [baseline.memberIds, draftMemberIds],
  );

  const formValid = form.name.trim().length > 0 && form.label_html.trim().length > 0;

  const isBadgeDeletePending = (badgeId: string) =>
    isActionPending({ resource: "badge", resourceId: badgeId, action: "delete" });

  const isBadgeUnassignPending = (badgeId: string, userId: string) =>
    isActionPending({
      resource: "badge-assignment",
      resourceId: `${badgeId}:${userId}`,
      action: "unassign",
    });

  const deleteBadgeWithPending = (badgeId: string) => {
    const pending = runPendingAction(
      { resource: "badge", resourceId: badgeId, action: "delete" },
      () => deleteMutation.mutateAsync(badgeId),
    );
    if (pending) void pending.catch(() => undefined);
  };

  const unassignBadgeWithPending = (badgeId: string, userIds: string[]) => {
    const pending = runPendingActions(
      userIds.map((userId) => ({
        resource: "badge-assignment" as const,
        resourceId: `${badgeId}:${userId}`,
        action: "unassign",
      })),
      () => unassignMutation.mutateAsync({ badgeId, userIds }),
    );
    if (pending) void pending.catch(() => undefined);
  };

  return {
    selectedBadgeId,
    isCreating,
    form,
    setForm,
    memberSearch,
    setMemberSearch,
    draftMemberIds,
    draftAdded,
    draftRemoved,
    formDirty,
    membershipDirty,
    isDirty,
    badges,
    assignments,
    selectedBadge,
    assignedUserIds,
    badgesLoading: badgesQuery.isLoading,
    assignmentsLoading: assignmentsQuery.isLoading,
    badgesError: badgesQuery.isError,
    assignmentsError: assignmentsQuery.isError,
    retryBadges: () => {
      void badgesQuery.refetch();
    },
    retryAssignments: () => {
      void assignmentsQuery.refetch();
    },
    reorderBadges: reorder,
    reorderPending: reorderMutation.isPending,
    createPending: createMutation.isPending,
    updatePending: updateMutation.isPending,
    deletePending: deleteMutation.isPending,
    membershipPending: membershipMutation.isPending,
    unassignPending: unassignMutation.isPending,
    isBadgeDeletePending,
    isBadgeUnassignPending,
    startCreate,
    selectBadge,
    discardChanges,
    toggleDraftMember,
    formValid,
    createBadge: () => createMutation.mutate(toCreateBadgePayload(form)),
    updateBadge: (id: string) => updateMutation.mutate({ id, payload: form }),
    deleteBadge: deleteBadgeWithPending,
    saveMembership: (badgeId: string) =>
      membershipMutation.mutate({ badgeId, add: draftAdded, remove: draftRemoved, memberIds: draft.memberIds }),
    unassignBadge: unassignBadgeWithPending,
  };
}

export type AdminBadgesController = ReturnType<typeof useAdminBadgesController>;
