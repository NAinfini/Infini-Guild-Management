import { catalogRevisionToken, type ClassTag, type UpdateClassTagInput } from "@guild/shared";
import { arrayMove } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createClassTag,
  deleteClassTag,
  reorderClassTags,
  updateClassTag,
} from "../api/mutations/class-tags";
import { queryKeys } from "../api/query-keys";
import { classTagsQueryOptions } from "./data/useClassData";
import { notifySuccess } from "../utils/notifications";
import { presentAppError } from "./useAppError";

/* sort_order 不在草稿里：顺序由左栏拖拽决定，走的是整表重排接口。保存标签时不再
   捎带一个顺序数字，否则同一份顺序有两个写入口，谁最后写的谁说了算。 */
export type ClassTagDraft = {
  id: string | null;
  updatedAt: string | null;
  label: string;
  classIds: string[];
};

export const EMPTY_CLASS_TAG_DRAFT: ClassTagDraft = {
  id: null,
  updatedAt: null,
  label: "",
  classIds: [],
};

function tagToDraft(tag: ClassTag): ClassTagDraft {
  return {
    id: tag.id,
    updatedAt: tag.updated_at,
    label: tag.label,
    classIds: [...tag.class_ids],
  };
}

function sameTagDraft(left: ClassTagDraft, right: ClassTagDraft) {
  if (left.id !== right.id || left.updatedAt !== right.updatedAt
    || left.label !== right.label || left.classIds.length !== right.classIds.length) {
    return false;
  }

  const leftIds = [...left.classIds].sort();
  const rightIds = [...right.classIds].sort();
  return leftIds.every((id, index) => id === rightIds[index]);
}

export function useAdminClassTagsController() {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState<ClassTagDraft>(EMPTY_CLASS_TAG_DRAFT);
  const [baseline, setBaseline] = useState<ClassTagDraft>(EMPTY_CLASS_TAG_DRAFT);
  const isDirty = useMemo(() => !sameTagDraft(draft, baseline), [baseline, draft]);

  /* 管理列表直接用服务端顺序（sort_order,id），不套 useClassTags 的排序 select：
     拖拽重排读写的就是这份顺序本身。全站的筹码和配额编辑器读的是同一个
     queryKey 的缓存，refetch 写回缓存即全站生效。 */
  const query = useQuery(classTagsQueryOptions);

  const refresh = async () => {
    await query.refetch();
  };

  const saveMutation = useMutation({
    mutationFn: async (next: ClassTagDraft) => {
      const payload = {
        label: next.label.trim(),
        class_ids: next.classIds,
      };
      if (!next.id) return createClassTag(payload);
      if (!next.updatedAt) throw new Error("Class tag editor revision is missing");
      return updateClassTag(next.id, {
        ...payload,
        expected_updated_at: next.updatedAt,
      } satisfies UpdateClassTagInput);
    },
    onSuccess: async (tag) => {
      await refresh();
      /* 保存后停在刚存的那个标签上，而不是把右栏收掉：加成员是一次改几个的活，
         每存一次就退回空白页的话，得重新找一遍自己刚才在改哪个。 */
      setDraft(tagToDraft(tag));
      setBaseline(tagToDraft(tag));
      setOpened(true);
      notifySuccess(t("classTags.message.saved"));
    },
    onError: (error) => presentAppError(error, t("classTags.message.failed")),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, expectedUpdatedAt, expectedUsageCount }: {
      id: string;
      expectedUpdatedAt: string;
      expectedUsageCount: number;
    }) => deleteClassTag(id, expectedUpdatedAt, expectedUsageCount),
    onSuccess: async () => {
      await refresh();
      setOpened(false);
      setDraft(EMPTY_CLASS_TAG_DRAFT);
      setBaseline(EMPTY_CLASS_TAG_DRAFT);
      notifySuccess(t("classTags.message.deleted"));
    },
    onError: (error) => {
      void refresh();
      presentAppError(error, t("classTags.message.failed"));
    },
  });

  /*
   * 拖拽排序，跟职业目录那份（useAdminClassesController）是同一套：乐观写缓存，
   * 失败先回滚再重拉。回滚之后还要重拉的理由写在那边，两处不重复一遍。
   */
  const reorderMutation = useMutation({
    mutationFn: ({ order, expectedRevisionToken }: { order: string[]; expectedRevisionToken: string }) =>
      reorderClassTags(order, expectedRevisionToken),
    onMutate: async ({ order }: { order: string[]; expectedRevisionToken: string }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.classTags.list() });
      const previous = queryClient.getQueryData<ClassTag[]>(queryKeys.classTags.list());
      if (previous) {
        const byId = new Map(previous.map((tag) => [tag.id, tag]));
        queryClient.setQueryData(
          queryKeys.classTags.list(),
          order.map((id) => byId.get(id)).filter((tag): tag is ClassTag => Boolean(tag)),
        );
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.classTags.list(), context.previous);
      }
      presentAppError(error, t("classTags.message.reorderFailed"));
      void refresh();
    },
    onSuccess: (tags) => {
      queryClient.setQueryData(queryKeys.classTags.list(), tags);
    },
  });

  const reorder = (activeId: string, overId: string) => {
    const current = query.data;
    if (!current) return;
    const from = current.findIndex((tag) => tag.id === activeId);
    const to = current.findIndex((tag) => tag.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    reorderMutation.mutate({
      order: arrayMove(current, from, to).map((tag) => tag.id),
      expectedRevisionToken: catalogRevisionToken(current),
    });
  };

  const selectTag = (tag: ClassTag) => {
    const nextDraft = tagToDraft(tag);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setOpened(true);
  };

  const discardChanges = () => {
    if (!baseline.id) {
      setOpened(false);
      setDraft(EMPTY_CLASS_TAG_DRAFT);
      setBaseline(EMPTY_CLASS_TAG_DRAFT);
      return;
    }
    setDraft(baseline);
  };

  // Auto-select only once per mount so deleting the active tag can leave the
  // detail closed instead of immediately reopening the next row.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current) return;
    const first = query.data?.[0];
    if (!first) return;
    autoSelected.current = true;
    selectTag(first);
  }, [query.data]);

  useEffect(() => {
    if (!opened || !draft.id || !baseline.id || isDirty || saveMutation.isPending) return;
    const latest = query.data?.find((tag) => tag.id === draft.id);
    if (!latest) return;
    const nextDraft = tagToDraft(latest);
    if (sameTagDraft(baseline, nextDraft)) return;
    setDraft(nextDraft);
    setBaseline(nextDraft);
  }, [baseline, draft.id, isDirty, opened, query.data, saveMutation.isPending]);

  const openCreate = () => {
    /* sort_order 不传：服务端按当前最大值 + 10 排到末尾，正好是拖拽序里「新的在最后」。 */
    setDraft(EMPTY_CLASS_TAG_DRAFT);
    setBaseline(EMPTY_CLASS_TAG_DRAFT);
    setOpened(true);
  };

  const toggleClass = (classId: string) => setDraft((current) => ({
    ...current,
    classIds: current.classIds.includes(classId)
      ? current.classIds.filter((id) => id !== classId)
      : [...current.classIds, classId],
  }));

  return {
    query,
    opened,
    draft,
    setDraft,
    isDirty,
    toggleClass,
    openCreate,
    selectTag,
    discardChanges,
    reorder,
    save: () => saveMutation.mutate(draft),
    remove: (id: string, expectedUpdatedAt: string, expectedUsageCount: number) =>
      deleteMutation.mutateAsync({ id, expectedUpdatedAt, expectedUsageCount }),
    savePending: saveMutation.isPending,
    deletePending: deleteMutation.isPending,
    reorderPending: reorderMutation.isPending,
  };
}
