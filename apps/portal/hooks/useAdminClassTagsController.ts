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
import { fetchClassTags } from "../api/queries/class-tags";
import { useClassTagStore } from "../stores/class-tag";
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
  const setTags = useClassTagStore((state) => state.setTags);
  const [opened, setOpened] = useState(false);
  /* 右栏分两态：选中一个标签先只是「看」，动它得再点一下编辑。原先点一下左栏就直接
     进表单，于是想确认「坦克里都有谁」也要先进入一个可写的界面，手一滑就改了。 */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ClassTagDraft>(EMPTY_CLASS_TAG_DRAFT);

  const query = useQuery({
    queryKey: queryKeys.classTags.list(),
    queryFn: fetchClassTags,
    staleTime: 5 * 60_000,
  });

  /* 全站的筹码和配额编辑器读的是 store，不是这份查询。管理页改完标签必须把 store 也
     推一次，否则同一个会话里刚改的名字要等下一次刷新页面才生效。 */
  useEffect(() => {
    if (query.data) setTags(query.data);
  }, [query.data, setTags]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.classTags.all });
    setTags(await queryClient.fetchQuery({
      queryKey: queryKeys.classTags.list(),
      queryFn: fetchClassTags,
    }));
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
      setTags(tags);
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

  /*
   * 进页面直接把第一个标签摊开（只是看，不进编辑态）。右栏原先停在一句「选择一个标签
   * 进行编辑」上，而九成情况下人就是冲着某个标签来的，等于每次都先付一次点击。
   *
   * 只在本次挂载里认一次（autoSelected）：不认的话，删完当前这个标签把右栏收掉，这个
   * effect 立刻又把列表里的头一个开回来，看着像是删错了。
   */
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
