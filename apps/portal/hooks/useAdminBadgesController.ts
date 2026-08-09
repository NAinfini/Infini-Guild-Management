import type { MemberBadge } from "@guild/shared";
import { arrayMove } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { CreateBadgePayload } from "../services/AdminService";
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

function toCreateBadgePayload(form: BadgeForm): CreateBadgePayload {
  return {
    name: form.name,
    label_html: form.label_html,
    color: form.color,
    description: form.description || undefined,
  };
}

export function useAdminBadgesController(enabled: boolean) {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const { showError } = useAppError();
  const [explicitBadgeId, setExplicitBadgeId] = useState<string | null>(null);
  const [editingBadgeId, setEditingBadgeId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<BadgeForm>(EMPTY_BADGE_FORM);
  /*
   * 成员编辑从「只挑还没有徽章的人加进来」改成「一份全员名单，勾选即拥有」：
   * 面板里的勾选状态就是保存后的最终成员集合，加和删是同一个动作的两个方向。
   * draftMemberIds 因此是最终集合而不是待加名单，命名不能再叫 pendingAssign。
   */
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [draftMemberIds, setDraftMemberIds] = useState<ReadonlySet<string>>(new Set());
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
    setExplicitBadgeId(badges[0]?.id ?? null);
  }, [badges, explicitBadgeId, isCreating]);

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
      setForm(EMPTY_BADGE_FORM);
      await invalidateBadges();
      /* 先等目录刷新再一起落地：新徽章还没进列表就退出新建态的话，
         选中会先掉回第一枚，右栏闪一下别人的详情。 */
      setExplicitBadgeId(data.id);
      setIsCreating(false);
    },
    onError: (error) => showError(error, t("badges.message.failed")),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; payload: BadgeForm }) => updateBadge(vars.id, toCreateBadgePayload(vars.payload)),
    onSuccess: async () => {
      notifySuccess(t("badges.message.updated"));
      setEditingBadgeId(null);
      await invalidateBadges();
    },
    onError: (error) => showError(error, t("badges.message.failed")),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBadge,
    onSuccess: async () => {
      notifySuccess(t("badges.message.deleted"));
      setExplicitBadgeId(null);
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
    mutationFn: async (vars: { badgeId: string; add: string[]; remove: string[] }) => {
      const assigned = await runBatched(vars.add, async (chunk) => (await assignBadge(vars.badgeId, chunk)).assigned);
      const removed = await runBatched(vars.remove, async (chunk) => (await unassignBadge(vars.badgeId, chunk)).removed);
      return { assigned, removed };
    },
    onSuccess: (data) => {
      notifySuccess(t("badges.message.membershipSaved", { added: data.assigned, removed: data.removed }));
      setMembershipOpen(false);
      setDraftMemberIds(new Set());
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

  /*
   * 草稿只对「打开面板时选中的那一枚徽章」有意义：带着 A 的草稿切到 B，保存出去
   * 就是拿 A 的勾选去改 B 的成员。凡是会换掉详情内容的动作，一律先把面板收掉。
   */
  const resetMembership = () => {
    setMembershipOpen(false);
    setDraftMemberIds(new Set());
    setMemberSearch("");
  };

  const startCreate = () => {
    setIsCreating(true);
    setEditingBadgeId(null);
    setForm(EMPTY_BADGE_FORM);
    setExplicitBadgeId(null);
    resetMembership();
  };

  const startEdit = (badge: MemberBadge) => {
    setEditingBadgeId(badge.id);
    setIsCreating(false);
    resetMembership();
    setForm({
      name: badge.name,
      label_html: badge.label_html,
      color: badge.color,
      description: badge.description ?? "",
    });
  };

  const selectBadge = (badgeId: string) => {
    setExplicitBadgeId(badgeId);
    setIsCreating(false);
    setEditingBadgeId(null);
    resetMembership();
  };

  const cancelEdit = () => {
    setEditingBadgeId(null);
    setIsCreating(false);
    setForm(EMPTY_BADGE_FORM);
  };

  /*
   * 草稿以「当前已分配的人」为起点。分配还在加载时打开面板会拿到一份空集合，
   * 等数据到了就变成「移除所有人」的差异——所以调用方（按钮）在加载/出错时禁用，
   * 这里不兜底猜测。
   */
  const openMembership = () => {
    setDraftMemberIds(new Set(assignedUserIds));
    setMemberSearch("");
    setMembershipOpen(true);
  };

  const closeMembership = resetMembership;

  const toggleDraftMember = (userId: string) => {
    setDraftMemberIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(userId)) next.add(userId);
      return next;
    });
  };

  const draftAdded = useMemo(
    () => [...draftMemberIds].filter((id) => !assignedUserIds.has(id)),
    [draftMemberIds, assignedUserIds],
  );
  const draftRemoved = useMemo(
    () => [...assignedUserIds].filter((id) => !draftMemberIds.has(id)),
    [draftMemberIds, assignedUserIds],
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
    editingBadgeId,
    isCreating,
    form,
    setForm,
    membershipOpen,
    memberSearch,
    setMemberSearch,
    draftMemberIds,
    draftAdded,
    draftRemoved,
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
    startEdit,
    selectBadge,
    cancelEdit,
    openMembership,
    closeMembership,
    toggleDraftMember,
    formValid,
    createBadge: () => createMutation.mutate(toCreateBadgePayload(form)),
    updateBadge: (id: string) => updateMutation.mutate({ id, payload: form }),
    deleteBadge: deleteBadgeWithPending,
    saveMembership: (badgeId: string) =>
      membershipMutation.mutate({ badgeId, add: draftAdded, remove: draftRemoved }),
    unassignBadge: unassignBadgeWithPending,
  };
}

export type AdminBadgesController = ReturnType<typeof useAdminBadgesController>;
