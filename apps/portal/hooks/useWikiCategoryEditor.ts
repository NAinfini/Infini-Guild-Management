import type { BatchUpdateWikiCategoryItem, WikiCategory } from "@guild/shared";
import { arrayMove } from "@dnd-kit/sortable";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WikiCategoryDraft } from "../types/wiki";
import { useAppError } from "./useAppError";
import { notifySuccess } from "../utils/notifications";
import {
  batchUpdateWikiCategories,
  createWikiCategory,
  deleteWikiCategory,
} from "../services/WikiService";
import { queryKeys } from "../api/query-keys";

function toCategoryDrafts(categories: WikiCategory[]): WikiCategoryDraft[] {
  return [...categories]
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name))
    .map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      parent_id: category.parent_id ?? "",
      sort_order: category.sort_order,
    }));
}

type UseWikiCategoryEditorParams = {
  categories: WikiCategory[];
};

export function useWikiCategoryEditor({ categories }: UseWikiCategoryEditorParams) {
  const { t } = useTranslation("wiki");
  const queryClient = useQueryClient();
  const { showError } = useAppError();

  const [categoryName, setCategoryName] = useState("");
  const [categoryDrafts, setCategoryDrafts] = useState<WikiCategoryDraft[]>(() => toCategoryDrafts(categories));
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);

  useEffect(() => {
    setCategoryDrafts(toCategoryDrafts(categories));
  }, [categories]);

  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const hasDraftChanges = useMemo(() => {
    if (categoryDrafts.length !== categories.length) {
      return true;
    }

    for (const draft of categoryDrafts) {
      const current = categoriesById.get(draft.id);
      if (!current) {
        return true;
      }
      if (draft.name.trim() !== current.name) {
        return true;
      }
      if ((draft.parent_id || null) !== current.parent_id) {
        return true;
      }
      if (draft.sort_order !== current.sort_order) {
        return true;
      }
    }

    return false;
  }, [categories.length, categoriesById, categoryDrafts]);

  const createCategoryMutation = useMutation({
    mutationFn: createWikiCategory,
    onSuccess: async () => {
      notifySuccess(t("message.categoryCreated"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
      setCategoryName("");
    },
    onError: (error) => {
      showError(error, t("message.categoryCreateFailed"));
    },
  });

  const saveCategoryDraftsMutation = useMutation({
    mutationFn: async (drafts: WikiCategoryDraft[]) => {
      const updates = drafts
        .map((draft) => {
          const current = categoriesById.get(draft.id);
          if (!current) {
            return null;
          }

          const update: BatchUpdateWikiCategoryItem = { id: draft.id };
          const nextName = draft.name.trim();
          if (nextName && nextName !== current.name) {
            update.name = nextName;
          }
          const nextParent = draft.parent_id || null;
          if (nextParent !== current.parent_id) {
            update.parent_id = nextParent;
          }
          if (draft.sort_order !== current.sort_order) {
            update.sort_order = draft.sort_order;
          }

          return Object.keys(update).length > 1 ? update : null;
        })
        .filter((item): item is BatchUpdateWikiCategoryItem => item !== null);

      /* 一行都没改就不发请求：批量接口的 updates 至少要有一项，空数组会被判 400。 */
      if (updates.length === 0) {
        return null;
      }

      return batchUpdateWikiCategories(updates);
    },
    onSuccess: (categories) => {
      if (!categories) {
        return;
      }
      notifySuccess(t("message.categorySaved"));
      /* 服务端回的就是落库之后的完整目录，直接写进缓存；不再多发一次 GET。 */
      queryClient.setQueryData(queryKeys.wiki.categories(), categories);
    },
    onError: async (error) => {
      showError(error, t("message.categorySaveFailed"));
      /* 整批都没落库，但本地草稿还停在用户改过的样子。重新拉一次，让界面回到库里的真实顺序。 */
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: deleteWikiCategory,
    onMutate: (categoryId) => {
      setDeletingCategoryId(categoryId);
    },
    onSuccess: async () => {
      notifySuccess(t("message.categoryDeleted"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
    },
    onError: (error) => {
      showError(error, t("message.categoryDeleteFailed"));
    },
    onSettled: () => {
      setDeletingCategoryId(null);
    },
  });

  const createCategory = () => {
    createCategoryMutation.mutate({
      name: categoryName.trim() || t("categoryEditor.defaultName"),
    });
  };

  const setCategoryDraftName = (categoryId: string, value: string) => {
    setCategoryDrafts((current) =>
      current.map((category) => (category.id === categoryId ? { ...category, name: value } : category)),
    );
  };

  const setCategoryDraftParentId = (categoryId: string, value: string) => {
    setCategoryDrafts((current) =>
      current.map((category) => (category.id === categoryId ? { ...category, parent_id: value } : category)),
    );
  };

  const reorderCategories = (activeId: string, overId: string) => {
    setCategoryDrafts((current) => {
      const oldIndex = current.findIndex((category) => category.id === activeId);
      const newIndex = current.findIndex((category) => category.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        return current;
      }

      return arrayMove(current, oldIndex, newIndex).map((category, index) => ({
        ...category,
        sort_order: index,
      }));
    });
  };

  const saveCategoryDrafts = () => {
    /* 用 mutate 而不是 mutateAsync：调用方不消费这个 promise，mutateAsync 失败时
       会变成一个没人接的 rejection，错误只能靠 onError 弹出来，堆栈却被吞了。 */
    saveCategoryDraftsMutation.mutate(categoryDrafts);
  };

  const resetCategoryDrafts = () => {
    setCategoryDrafts(toCategoryDrafts(categories));
  };

  const deleteCategory = (categoryId: string) => {
    deleteCategoryMutation.mutate(categoryId);
  };

  return {
    categoryName,
    setCategoryName,
    categoryDrafts,
    deletingCategoryId,
    isCreating: createCategoryMutation.isPending,
    isSavingDrafts: saveCategoryDraftsMutation.isPending,
    hasDraftChanges,
    isDirty: categoryName.trim().length > 0 || hasDraftChanges,
    canSaveDrafts: hasDraftChanges && !saveCategoryDraftsMutation.isPending,
    createCategory,
    setCategoryDraftName,
    setCategoryDraftParentId,
    reorderCategories,
    saveCategoryDrafts,
    resetCategoryDrafts,
    deleteCategory,
  };
}
