import type { ClassTag } from "@guild/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { createClassTag, deleteClassTag, updateClassTag } from "../api/mutations/class-tags";
import { queryKeys } from "../api/query-keys";
import { fetchClassTags } from "../api/queries/class-tags";
import { compareClassTags, useClassTagStore } from "../stores/class-tag";
import { notifyError, notifySuccess } from "../utils/notifications";

export type ClassTagDraft = {
  id: string | null;
  label: string;
  classIds: string[];
  sortOrder: number;
};

export const EMPTY_CLASS_TAG_DRAFT: ClassTagDraft = {
  id: null,
  label: "",
  classIds: [],
  sortOrder: 0,
};

function tagToDraft(tag: ClassTag): ClassTagDraft {
  return {
    id: tag.id,
    label: tag.label,
    classIds: [...tag.class_ids],
    sortOrder: tag.sort_order,
  };
}

export function useAdminClassTagsController() {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const setTags = useClassTagStore((state) => state.setTags);
  const [opened, setOpened] = useState(false);
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
        sort_order: next.sortOrder,
      };
      return next.id ? updateClassTag(next.id, payload) : createClassTag(payload);
    },
    onSuccess: async (tag) => {
      await refresh();
      /* 保存后停在刚存的那个标签上，而不是把右栏收掉：加成员是一次改几个的活，
         每存一次就退回空白页的话，得重新找一遍自己刚才在改哪个。 */
      setDraft(tagToDraft(tag));
      setOpened(true);
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
      setDraft(EMPTY_CLASS_TAG_DRAFT);
      notifySuccess(t("classTags.message.deleted"));
    },
    onError: (error) => notifyError(
      error instanceof Error ? error.message : t("classTags.message.failed"),
    ),
  });

  const openCreate = () => {
    const last = [...(query.data ?? [])].sort(compareClassTags).at(-1);
    setDraft({ ...EMPTY_CLASS_TAG_DRAFT, sortOrder: (last?.sort_order ?? -10) + 10 });
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
    toggleClass,
    openCreate,
    openEdit: (tag: ClassTag) => {
      setDraft(tagToDraft(tag));
      setOpened(true);
    },
    close: () => {
      if (saveMutation.isPending) return;
      setOpened(false);
    },
    save: () => saveMutation.mutate(draft),
    remove: (id: string) => deleteMutation.mutateAsync(id),
    savePending: saveMutation.isPending,
    deletePending: deleteMutation.isPending,
  };
}
