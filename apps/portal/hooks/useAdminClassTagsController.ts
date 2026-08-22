import type { ClassTag } from "@guild/shared";
import { arrayMove } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createClassTag,
  deleteClassTag,
  reorderClassTags,
  updateClassTag,
} from "../api/mutations/class-tags";
import { queryKeys } from "../api/query-keys";
import { classTagsQueryOptions } from "./data/useClassData";
import { notifyError, notifySuccess } from "../utils/notifications";

/* sort_order 不在草稿里：顺序由左栏拖拽决定，走的是整表重排接口。保存标签时不再
   捎带一个顺序数字，否则同一份顺序有两个写入口，谁最后写的谁说了算。 */
export type ClassTagDraft = {
  id: string | null;
  label: string;
  classIds: string[];
};

export const EMPTY_CLASS_TAG_DRAFT: ClassTagDraft = {
  id: null,
  label: "",
  classIds: [],
};

function tagToDraft(tag: ClassTag): ClassTagDraft {
  return {
    id: tag.id,
    label: tag.label,
    classIds: [...tag.class_ids],
  };
}

export function useAdminClassTagsController() {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState(false);
  // Selection opens a read-only detail; editing requires a separate action.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ClassTagDraft>(EMPTY_CLASS_TAG_DRAFT);

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
      return next.id ? updateClassTag(next.id, payload) : createClassTag(payload);
    },
    onSuccess: async (tag) => {
      await refresh();
      /* 保存后停在刚存的那个标签上，而不是把右栏收掉：加成员是一次改几个的活，
         每存一次就退回空白页的话，得重新找一遍自己刚才在改哪个。 */
      setDraft(tagToDraft(tag));
      setOpened(true);
      setEditing(false);
      notifySuccess(t("classTags.message.saved"));
    },
    onError: (error) => notifyError(
      error instanceof Error ? error.message : t("classTags.message.failed"),
    ),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteClassTag,
    onSuccess: async () => {
      await refresh();
      setOpened(false);
      setEditing(false);
      setDraft(EMPTY_CLASS_TAG_DRAFT);
      notifySuccess(t("classTags.message.deleted"));
    },
    onError: (error) => notifyError(
      error instanceof Error ? error.message : t("classTags.message.failed"),
    ),
  });

  /*
   * 拖拽排序，跟职业目录那份（useAdminClassesController）是同一套：乐观写缓存，
   * 失败先回滚再重拉。回滚之后还要重拉的理由写在那边，两处不重复一遍。
   */
  const reorderMutation = useMutation({
    mutationFn: (order: string[]) => reorderClassTags(order),
    onMutate: async (order: string[]) => {
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
    onError: (error, _order, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.classTags.list(), context.previous);
      }
      notifyError(error instanceof Error ? error.message : t("classTags.message.reorderFailed"));
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
    reorderMutation.mutate(arrayMove(current, from, to).map((tag) => tag.id));
  };

  const selectTag = (tag: ClassTag) => {
    setDraft(tagToDraft(tag));
    setOpened(true);
    setEditing(false);
  };

  const startEdit = () => setEditing(true);

  /* 取消：改了一半的草稿丢掉，回到服务端那份。新建时没有「服务端那份」可回，
     直接把右栏收起来。 */
  const cancelEdit = () => {
    const current = draft.id ? query.data?.find((tag) => tag.id === draft.id) : undefined;
    setEditing(false);
    if (current) {
      setDraft(tagToDraft(current));
      return;
    }
    setOpened(false);
    setDraft(EMPTY_CLASS_TAG_DRAFT);
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

  const openCreate = () => {
    /* sort_order 不传：服务端按当前最大值 + 10 排到末尾，正好是拖拽序里「新的在最后」。 */
    setDraft(EMPTY_CLASS_TAG_DRAFT);
    setOpened(true);
    setEditing(true);
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
    editing,
    draft,
    setDraft,
    toggleClass,
    openCreate,
    selectTag,
    startEdit,
    cancelEdit,
    reorder,
    save: () => saveMutation.mutate(draft),
    remove: (id: string) => deleteMutation.mutateAsync(id),
    savePending: saveMutation.isPending,
    deletePending: deleteMutation.isPending,
    reorderPending: reorderMutation.isPending,
  };
}
