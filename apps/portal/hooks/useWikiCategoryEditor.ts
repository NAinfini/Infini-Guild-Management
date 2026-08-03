import type { BatchUpdateWikiCategoryItem, WikiCategory } from "@guild/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WikiCategoryDraft } from "../types/wiki";
import { applyCategoryMove, orderCategoryDrafts, type CategoryMove } from "../utils/wiki-category-tree";
import { useAppError } from "./useAppError";
import { notifySuccess } from "../utils/notifications";
import {
  batchUpdateWikiCategories,
  createWikiCategory,
  deleteWikiCategory,
} from "../services/WikiService";
import { queryKeys } from "../api/query-keys";

/*
 * 草稿数组的顺序就是编辑器里从上到下的那一列，也是「这一层里排第几」的依据。
 * 库里的 sort_order 是一串全局序号，未必让父子挨在一起（子级的序号可能比父级小），
 * 所以读进来先按树理一遍顺序。序号本身一个都不改——此时顺手重排，
 * 编辑器一打开保存按钮就亮，用户什么都没动却被告知有改动。
 */
function toCategoryDrafts(categories: WikiCategory[]): WikiCategoryDraft[] {
  const drafts = [...categories]
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name))
    .map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      parent_id: category.parent_id ?? "",
      sort_order: category.sort_order,
    }));
  return orderCategoryDrafts(drafts);
}

function draftsDifferFromCategories(
  drafts: WikiCategoryDraft[],
  categories: WikiCategory[],
): boolean {
  if (drafts.length !== categories.length) return true;
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  return drafts.some((draft) => {
    const current = categoriesById.get(draft.id);
    return !current
      || draft.name.trim() !== current.name
      || (draft.parent_id || null) !== current.parent_id
      || draft.sort_order !== current.sort_order;
  });
}

function mergeCategoryDrafts(
  drafts: WikiCategoryDraft[],
  previousCategories: WikiCategory[],
  nextCategories: WikiCategory[],
): WikiCategoryDraft[] {
  const nextDrafts = toCategoryDrafts(nextCategories);
  if (!draftsDifferFromCategories(drafts, previousCategories)) return nextDrafts;

  const previousById = new Map(previousCategories.map((category) => [category.id, category]));
  const nextById = new Map(nextDrafts.map((draft) => [draft.id, draft]));
  const nextIds = new Set(nextDrafts.map((draft) => draft.id));
  const merge = (draft: WikiCategoryDraft): WikiCategoryDraft => {
    const previous = previousById.get(draft.id);
    const next = nextById.get(draft.id);
    if (!previous || !next) return next ?? draft;
    const dirtyParent = (draft.parent_id || null) !== previous.parent_id
      && (!draft.parent_id || nextIds.has(draft.parent_id));
    return {
      ...next,
      name: draft.name.trim() !== previous.name ? draft.name : next.name,
      parent_id: dirtyParent ? draft.parent_id : next.parent_id,
      sort_order: draft.sort_order !== previous.sort_order ? draft.sort_order : next.sort_order,
    };
  };
  const retained = drafts.filter((draft) => nextIds.has(draft.id)).map(merge);
  const retainedIds = new Set(retained.map((draft) => draft.id));
  return [...retained, ...nextDrafts.filter((draft) => !retainedIds.has(draft.id))];
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
  const previousCategoriesRef = useRef(categories);

  useEffect(() => {
    setCategoryDrafts((current) => mergeCategoryDrafts(
      current,
      previousCategoriesRef.current,
      categories,
    ));
    previousCategoriesRef.current = categories;
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

  /*
   * 挪位置和改层级是同一件事，所以只有这一个入口：拖也好、按 ← → 也好，
   * 落点都表达成「挂到谁底下、排第几」。拆成两个动作时，先改父级再排序会在中间
   * 留下一帧父子不一致的草稿，而这份草稿正是保存时要发出去的东西。
   */
  const moveCategory = (categoryId: string, move: CategoryMove) => {
    setCategoryDrafts((current) => applyCategoryMove(current, categoryId, move));
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
    moveCategory,
    saveCategoryDrafts,
    resetCategoryDrafts,
    deleteCategory,
  };
}
