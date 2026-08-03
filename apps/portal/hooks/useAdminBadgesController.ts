import type { MemberBadge } from "@guild/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  assignBadge,
  createBadge,
  deleteBadge,
  fetchBadgeAssignments,
  fetchBadges,
  unassignBadge,
  updateBadge,
} from "../services/AdminService";
import type { CreateBadgePayload } from "../services/AdminService";
import { queryKeys } from "../api/query-keys";
import { notifySuccess } from "../utils/notifications";
import { useAppError } from "./useAppError";
import { useAdminPendingActions } from "./useAdminPendingActions";

export type BadgeForm = {
  name: string;
  label_html: string;
  color: string;
  description: string;
  sort_order: number;
};

export const EMPTY_BADGE_FORM: BadgeForm = {
  name: "",
  label_html: "",
  color: "#D4A843",
  description: "",
  sort_order: 0,
};

function toCreateBadgePayload(form: BadgeForm): CreateBadgePayload {
  return {
    name: form.name,
    label_html: form.label_html,
    color: form.color,
    description: form.description || undefined,
    sort_order: form.sort_order,
  };
}

export function useAdminBadgesController(enabled: boolean) {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const { showError } = useAppError();
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null);
  const [editingBadgeId, setEditingBadgeId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<BadgeForm>(EMPTY_BADGE_FORM);
  /* 加人从弹窗改成详情里就地展开的面板，命名跟着改，免得读代码时以为还有个 Modal。 */
  const [assignPanelOpen, setAssignPanelOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const [pendingAssignIds, setPendingAssignIds] = useState<string[]>([]);
  const { isActionPending, runPendingAction, runPendingActions } = useAdminPendingActions();

  const badgesQuery = useQuery({
    queryKey: queryKeys.badges.list(),
    queryFn: fetchBadges,
    enabled,
    staleTime: 5 * 60_000,
  });

  const assignmentsQuery = useQuery({
    queryKey: queryKeys.badges.assignments(selectedBadgeId ?? ""),
    queryFn: () => fetchBadgeAssignments(selectedBadgeId as string),
    enabled: enabled && Boolean(selectedBadgeId),
    staleTime: 2 * 60_000,
  });

  const badges = badgesQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const selectedBadge = badges.find((badge) => badge.id === selectedBadgeId) ?? null;
  const assignedUserIds = useMemo(() => new Set(assignments.map((assignment) => assignment.user_id)), [assignments]);

  useEffect(() => {
    if (selectedBadgeId && !badges.find((badge) => badge.id === selectedBadgeId)) {
      setSelectedBadgeId(null);
    }
  }, [badges, selectedBadgeId]);

  const invalidateBadges = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.badges.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: createBadge,
    onSuccess: async (data) => {
      notifySuccess(t("badges.message.created"));
      setIsCreating(false);
      setForm(EMPTY_BADGE_FORM);
      await invalidateBadges();
      setSelectedBadgeId(data.id);
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
      setSelectedBadgeId(null);
      await invalidateBadges();
    },
    onError: (error) => showError(error, t("badges.message.failed")),
  });

  const assignMutation = useMutation({
    mutationFn: (vars: { badgeId: string; userIds: string[] }) => assignBadge(vars.badgeId, vars.userIds),
    onSuccess: async (data) => {
      notifySuccess(t("badges.message.assigned", { count: data.assigned }));
      setAssignPanelOpen(false);
      setPendingAssignIds([]);
      await invalidateBadges();
    },
    onError: (error) => showError(error, t("badges.message.failed")),
  });

  const unassignMutation = useMutation({
    mutationFn: (vars: { badgeId: string; userIds: string[] }) => unassignBadge(vars.badgeId, vars.userIds),
    onSuccess: async (data) => {
      notifySuccess(t("badges.message.unassigned", { count: data.removed }));
      await invalidateBadges();
    },
    onError: (error) => showError(error, t("badges.message.failed")),
  });

  const startCreate = () => {
    setIsCreating(true);
    setEditingBadgeId(null);
    setForm(EMPTY_BADGE_FORM);
    setSelectedBadgeId(null);
  };

  const startEdit = (badge: MemberBadge) => {
    setEditingBadgeId(badge.id);
    setIsCreating(false);
    setForm({
      name: badge.name,
      label_html: badge.label_html,
      color: badge.color,
      description: badge.description ?? "",
      sort_order: badge.sort_order,
    });
  };

  const selectBadge = (badgeId: string) => {
    setSelectedBadgeId(badgeId);
    setIsCreating(false);
    setEditingBadgeId(null);
  };

  const cancelEdit = () => {
    setEditingBadgeId(null);
    setIsCreating(false);
    setForm(EMPTY_BADGE_FORM);
  };

  const openAssignPanel = () => {
    setPendingAssignIds([]);
    setAssignSearch("");
    setAssignPanelOpen(true);
  };

  const togglePendingAssign = (userId: string) => {
    setPendingAssignIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

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
    setSelectedBadgeId,
    editingBadgeId,
    isCreating,
    form,
    setForm,
    assignPanelOpen,
    setAssignPanelOpen,
    assignSearch,
    setAssignSearch,
    pendingAssignIds,
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
    createPending: createMutation.isPending,
    updatePending: updateMutation.isPending,
    deletePending: deleteMutation.isPending,
    assignPending: assignMutation.isPending,
    unassignPending: unassignMutation.isPending,
    isBadgeDeletePending,
    isBadgeUnassignPending,
    startCreate,
    startEdit,
    selectBadge,
    cancelEdit,
    openAssignPanel,
    togglePendingAssign,
    formValid,
    createBadge: () => createMutation.mutate(toCreateBadgePayload(form)),
    updateBadge: (id: string) => updateMutation.mutate({ id, payload: form }),
    deleteBadge: deleteBadgeWithPending,
    assignBadge: (badgeId: string, userIds: string[]) => assignMutation.mutate({ badgeId, userIds }),
    unassignBadge: unassignBadgeWithPending,
  };
}

export type AdminBadgesController = ReturnType<typeof useAdminBadgesController>;
