import type {
  ClassCatalogItem,
  ClassVectorIconId,
  CreateClassCatalogItemInput,
} from "@guild/shared";
import { arrayMove } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
import { classCatalogQueryOptions } from "./data/useClassData";
import { notifyError, notifySuccess } from "../utils/notifications";

/* sort_order 不在草稿里：顺序由左栏拖拽决定，走整表重排接口。留在草稿里的话
   同一份顺序有两个写入口——保存表单会把编辑器打开那一刻的旧数字写回去，把中间
   发生过的拖拽抹掉。 */
export type ClassEditorDraft = {
  id: string | null;
  label: string;
  color: string;
  vectorIcon: ClassVectorIconId;
  iconMode: "vector" | "image";
  imageFile: File | null;
};

export const EMPTY_CLASS_EDITOR_DRAFT: ClassEditorDraft = {
  id: null,
  label: "",
  color: "#61B8AA",
  vectorIcon: "sword",
  iconMode: "vector",
  imageFile: null,
};

function itemToDraft(item: ClassCatalogItem): ClassEditorDraft {
  return {
    id: item.id,
    label: item.label,
    color: item.color,
    vectorIcon: item.icon_type === "vector" ? item.vector_icon : "sword",
    iconMode: item.icon_type,
    imageFile: null,
  };
}

export function useAdminClassesController() {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState<ClassEditorDraft>(EMPTY_CLASS_EDITOR_DRAFT);
  const [uploadProgress, setUploadProgress] = useState(0);

  /* 管理列表直接用服务端顺序（sort_order,id），不套 useClassCatalog 的排序
     select：拖拽重排读写的就是这份顺序本身。 */
  const query = useQuery(classCatalogQueryOptions);

  /* 全站展示读的是同一个 queryKey 的缓存（useClassCatalog），refetch 写回缓存
     即全站生效，不需要再往任何 store 镜像一份。 */
  const refresh = async () => {
    await query.refetch();
  };

  const saveMutation = useMutation({
    mutationFn: async (nextDraft: ClassEditorDraft) => {
      const payload: CreateClassCatalogItemInput = {
        label: nextDraft.label.trim(),
        color: nextDraft.color.toUpperCase(),
        vector_icon: nextDraft.vectorIcon,
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
    /* sort_order 不传：服务端按当前最大值 + 10 排到末尾，正好是拖拽序里「新的在最后」。 */
    setDraft(EMPTY_CLASS_EDITOR_DRAFT);
    setUploadProgress(0);
    setOpened(true);
  };

  const openEdit = (item: ClassCatalogItem) => {
    setDraft(itemToDraft(item));
    setUploadProgress(0);
    setOpened(true);
  };

  /*
   * 进页面直接把第一个职业摊开，右栏不再停在一句「选择一个职业进行编辑」上。
   *
   * 只认一次（autoSelected）：不认的话，删完当前这条把右栏收掉，这个 effect 立刻又把
   * 列表里的头一条开回来，看着像是删错了人。
   */
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current) return;
    const first = query.data?.[0];
    if (!first) return;
    autoSelected.current = true;
    openEdit(first);
  }, [query.data]);

  return {
    query,
    opened,
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
