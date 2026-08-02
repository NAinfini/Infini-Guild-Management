import type {
  ClassCatalogItem,
  ClassVectorIconId,
  CreateClassCatalogItemInput,
} from "@guild/shared";
import { arrayMove } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createClassCatalogItem,
  deleteClassCatalogItem,
  removeClassCatalogIcon,
  reorderClassCatalog,
  updateClassCatalogItem,
  uploadClassCatalogIcon,
} from "../api/mutations/classes";
import { queryKeys } from "../api/query-keys";
import { fetchClassCatalog } from "../api/queries/classes";
import { useClassCatalogStore } from "../stores/class-catalog";
import { notifyError, notifySuccess } from "../utils/notifications";

export type ClassEditorDraft = {
  id: string | null;
  label: string;
  color: string;
  vectorIcon: ClassVectorIconId;
  iconMode: "vector" | "image";
  sortOrder: number;
  imageFile: File | null;
};

export const EMPTY_CLASS_EDITOR_DRAFT: ClassEditorDraft = {
  id: null,
  label: "",
  color: "#61B8AA",
  vectorIcon: "sword",
  iconMode: "vector",
  sortOrder: 0,
  imageFile: null,
};

function itemToDraft(item: ClassCatalogItem): ClassEditorDraft {
  return {
    id: item.id,
    label: item.label,
    color: item.color,
    vectorIcon: item.vector_icon,
    iconMode: item.icon_type,
    sortOrder: item.sort_order,
    imageFile: null,
  };
}

export function useAdminClassesController() {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const setCatalogItems = useClassCatalogStore((state) => state.setItems);
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState<ClassEditorDraft>(EMPTY_CLASS_EDITOR_DRAFT);
  const [uploadProgress, setUploadProgress] = useState(0);

  const query = useQuery({
    queryKey: queryKeys.classes.list(),
    queryFn: fetchClassCatalog,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (query.data) setCatalogItems(query.data);
  }, [query.data, setCatalogItems]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.classes.all });
    const next = await queryClient.fetchQuery({
      queryKey: queryKeys.classes.list(),
      queryFn: fetchClassCatalog,
    });
    setCatalogItems(next);
  };

  const saveMutation = useMutation({
    mutationFn: async (nextDraft: ClassEditorDraft) => {
      const payload: CreateClassCatalogItemInput = {
        label: nextDraft.label.trim(),
        color: nextDraft.color.toUpperCase(),
        vector_icon: nextDraft.vectorIcon,
        sort_order: nextDraft.sortOrder,
      };

      const createdNow = !nextDraft.id;
      let item = nextDraft.id
        ? await updateClassCatalogItem(nextDraft.id, payload)
        : await createClassCatalogItem(payload);

      // Creating the row and uploading its artwork are intentionally separate
      // operations. Persist the generated id in the open draft immediately so
      // an upload failure can be retried as an edit instead of attempting a
      // duplicate create with the same label.
      if (createdNow) {
        setDraft((current) => current.id ? current : { ...current, id: item.id });
      }

      if (nextDraft.iconMode === "image" && nextDraft.imageFile) {
        setUploadProgress(1);
        item = await uploadClassCatalogIcon(
          item.id,
          nextDraft.imageFile,
          setUploadProgress,
        );
      } else if (nextDraft.iconMode === "vector" && item.icon_type === "image") {
        item = await removeClassCatalogIcon(item.id);
      }

      return item;
    },
    onSuccess: async () => {
      await refresh();
      setOpened(false);
      setDraft(EMPTY_CLASS_EDITOR_DRAFT);
      setUploadProgress(0);
      notifySuccess(t("classes.message.saved"));
    },
    onError: (error) => {
      setUploadProgress(0);
      void queryClient.invalidateQueries({ queryKey: queryKeys.classes.all });
      notifyError(error instanceof Error ? error.message : t("classes.message.failed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteClassCatalogItem,
    onSuccess: async () => {
      await refresh();
      /* 删职业会把它从所有标签里一起摘掉（class_tag_members 级联），标签那份缓存里
         还留着它，不作废的话标签编辑器会继续显示一个已经不存在的职业。 */
      await queryClient.invalidateQueries({ queryKey: queryKeys.classTags.all });
      /* 删除只能从右栏的编辑器里发起，删完必须把编辑器收掉：否则草稿还指着一个
         已经不存在的 id，右栏会停在一张改了也存不回去的表上。 */
      setOpened(false);
      setDraft(EMPTY_CLASS_EDITOR_DRAFT);
      setUploadProgress(0);
      notifySuccess(t("classes.message.deleted"));
    },
    onError: () => notifyError(t("classes.message.failed")),
  });

  /*
   * 拖拽排序。乐观地把新顺序写进缓存，请求失败再回滚——不这么做的话，松手到
   * 响应回来之间列表会停在旧顺序上，看着像「没拖动」。
   *
   * 失败路径是两步，两步都要留着：先回滚到松手前那份，让界面立刻不再撒谎；
   * 再拉一次服务端。服务端回 409 的典型原因就是本地目录已经过期（别人加/删了
   * 职业），这种时候「松手前那份」本身也是错的，只有重新拉才是真相。
   */
  const reorderMutation = useMutation({
    mutationFn: (order: string[]) => reorderClassCatalog(order),
    onMutate: async (order: string[]) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.classes.list() });
      const previous = queryClient.getQueryData<ClassCatalogItem[]>(queryKeys.classes.list());
      if (previous) {
        const byId = new Map(previous.map((item) => [item.id, item]));
        queryClient.setQueryData(
          queryKeys.classes.list(),
          order.map((id) => byId.get(id)).filter((item): item is ClassCatalogItem => Boolean(item)),
        );
      }
      return { previous };
    },
    onError: (error, _order, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.classes.list(), context.previous);
      }
      notifyError(error instanceof Error ? error.message : t("classes.message.reorderFailed"));
      void refresh();
    },
    onSuccess: (items) => {
      queryClient.setQueryData(queryKeys.classes.list(), items);
      setCatalogItems(items);
    },
  });

  const reorder = (activeId: string, overId: string) => {
    const current = query.data;
    if (!current) return;
    const from = current.findIndex((item) => item.id === activeId);
    const to = current.findIndex((item) => item.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    reorderMutation.mutate(arrayMove(current, from, to).map((item) => item.id));
  };

  const openCreate = () => {
    const nextOrder = (query.data?.at(-1)?.sort_order ?? -10) + 10;
    setDraft({ ...EMPTY_CLASS_EDITOR_DRAFT, sortOrder: nextOrder });
    setUploadProgress(0);
    setOpened(true);
  };

  const openEdit = (item: ClassCatalogItem) => {
    setDraft(itemToDraft(item));
    setUploadProgress(0);
    setOpened(true);
  };

  return {
    query,
    opened,
    close: () => {
      if (saveMutation.isPending) return;
      setOpened(false);
      setUploadProgress(0);
    },
    draft,
    setDraft,
    openCreate,
    openEdit,
    save: () => saveMutation.mutate(draft),
    remove: (id: string) => deleteMutation.mutateAsync(id),
    reorder,
    savePending: saveMutation.isPending,
    deletePending: deleteMutation.isPending,
    reorderPending: reorderMutation.isPending,
    uploadProgress,
  };
}
