import type {
  BatchUpdateWikiCategoryItem,
  WikiCategory,
  WikiCategoryCatalog,
} from "@guild/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WikiCategoryDraft } from "../types/wiki";
import { reorderCategoryDrafts } from "../utils/wiki-category-order";
import { useAppError } from "./useAppError";
import { notifySuccess } from "../utils/notifications";
import {
  batchUpdateWikiCategories,
  createWikiCategory,
  deleteWikiCategory,
} from "../services/WikiService";
import { queryKeys } from "../api/query-keys";

type CategoryEditorSession = Readonly<{
  categories: WikiCategory[];
  revisionToken: string | null;
}>;

function toCategoryDrafts(categories: WikiCategory[]): WikiCategoryDraft[] {
  return [...categories]
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name))
    .map(toCategoryDraft);
}

function toCategoryDraft(category: WikiCategory): WikiCategoryDraft {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    sort_order: category.sort_order,
  };
}

function sessionFrom(catalog: WikiCategoryCatalog | undefined): CategoryEditorSession {
  return {
    categories: catalog?.categories ?? [],
    revisionToken: catalog?.revision_token ?? null,
  };
}

function mergePendingCreatedCategories(
  categories: WikiCategory[],
  pendingCategories: WikiCategory[],
): WikiCategory[] {
  const knownIds = new Set(categories.map((category) => category.id));
  return [...categories, ...pendingCategories.filter((category) => !knownIds.has(category.id))];
}

function haveSameCategoryIds(left: WikiCategory[], right: WikiCategory[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right.map((category) => category.id));
  return left.every((category) => rightIds.has(category.id));
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
      || draft.sort_order !== current.sort_order;
  });
}

type UseWikiCategoryEditorParams = {
  categoryCatalog: WikiCategoryCatalog | undefined;
  isOpen: boolean;
};

export function useWikiCategoryEditor({ categoryCatalog, isOpen }: UseWikiCategoryEditorParams) {
  const { t } = useTranslation("wiki");
  const queryClient = useQueryClient();
  const { showError } = useAppError();
  const [session, setSession] = useState<CategoryEditorSession>(() => sessionFrom(categoryCatalog));
  const [categoryDrafts, setCategoryDrafts] = useState<WikiCategoryDraft[]>(() =>
    toCategoryDrafts(categoryCatalog?.categories ?? []));
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [pendingCreatedCategories, setPendingCreatedCategories] = useState<WikiCategory[]>([]);

  const hasDraftChanges = useMemo(
    () => draftsDifferFromCategories(categoryDrafts, session.categories),
    [categoryDrafts, session.categories],
  );

  useEffect(() => {
    if (!categoryCatalog) {
      return;
    }
    const serverCategoryIds = new Set(categoryCatalog.categories.map((category) => category.id));
    const remainingPendingCategories = pendingCreatedCategories.filter((category) => !serverCategoryIds.has(category.id));
    if (remainingPendingCategories.length !== pendingCreatedCategories.length) {
      setPendingCreatedCategories(remainingPendingCategories);
    }

    if (isOpen && hasDraftChanges) return;

    const nextCategories = mergePendingCreatedCategories(
      categoryCatalog.categories,
      remainingPendingCategories,
    );
    if (
      session.revisionToken === categoryCatalog.revision_token
      && haveSameCategoryIds(session.categories, nextCategories)
    ) {
      return;
    }
    setSession({ categories: nextCategories, revisionToken: categoryCatalog.revision_token });
    setCategoryDrafts(toCategoryDrafts(nextCategories));
  }, [
    categoryCatalog,
    hasDraftChanges,
    isOpen,
    pendingCreatedCategories,
    session.categories,
    session.revisionToken,
  ]);

  const createCategoryMutation = useMutation({
    mutationFn: createWikiCategory,
    onSuccess: async (created) => {
      notifySuccess(t("message.categoryCreated"));
      /*
       * 新建成功后不能只等分类查询失效再回填：目录首次加载尚在飞行时，
       * 用户已经能打开编辑器，旧响应可能短暂把草稿留在空列表里。
       * 创建响应本身已经是可信的服务端事实，先合入同一份基线与草稿；
       * 后续失效查询负责拿到新的目录版本令牌并完成最终对齐。
       */
      setPendingCreatedCategories((current) => current.some((category) => category.id === created.id)
        ? current
        : [...current, created]);
      setSession((current) => current.categories.some((category) => category.id === created.id)
        ? current
        : { ...current, categories: [...current.categories, created] });
      setCategoryDrafts((current) => current.some((draft) => draft.id === created.id)
        ? current
        : [...current, toCategoryDraft(created)]
          .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)));
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
    },
    onError: (error) => {
      showError(error, t("message.categoryCreateFailed"));
    },
  });

  const saveCategoryDraftsMutation = useMutation({
    mutationFn: async ({
      drafts,
      expectedRevisionToken,
      baseCategories,
    }: {
      drafts: WikiCategoryDraft[];
      expectedRevisionToken: string;
      baseCategories: WikiCategory[];
    }) => {
      const baseById = new Map(baseCategories.map((category) => [category.id, category]));
      const updates = drafts
        .map((draft) => {
          const current = baseById.get(draft.id);
          if (!current) return null;

          const update: BatchUpdateWikiCategoryItem = { id: draft.id };
          const nextName = draft.name.trim();
          if (nextName && nextName !== current.name) update.name = nextName;
          if (draft.sort_order !== current.sort_order) update.sort_order = draft.sort_order;
          return Object.keys(update).length > 1 ? update : null;
        })
        .filter((item): item is BatchUpdateWikiCategoryItem => item !== null);

      if (updates.length === 0) return null;
      return batchUpdateWikiCategories(expectedRevisionToken, updates);
    },
    onSuccess: (catalog) => {
      if (!catalog) return;
      notifySuccess(t("message.categorySaved"));
      setSession(sessionFrom(catalog));
      setCategoryDrafts(toCategoryDrafts(catalog.categories));
      queryClient.setQueryData(queryKeys.wiki.categories(), catalog);
    },
    onError: async (error) => {
      showError(error, t("message.categorySaveFailed"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: ({ categoryId, expectedRevisionToken }: {
      categoryId: string;
      expectedRevisionToken: string;
    }) => deleteWikiCategory(categoryId, expectedRevisionToken),
    onMutate: ({ categoryId }) => {
      setDeletingCategoryId(categoryId);
    },
    onSuccess: async () => {
      notifySuccess(t("message.categoryDeleted"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
    },
    onError: async (error) => {
      showError(error, t("message.categoryDeleteFailed"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
    },
    onSettled: () => {
      setDeletingCategoryId(null);
    },
  });

  const canRunDirectCommands = !hasDraftChanges
    && !saveCategoryDraftsMutation.isPending
    && !createCategoryMutation.isPending
    && deletingCategoryId === null;

  const createCategory = () => {
    if (!canRunDirectCommands) return;
    createCategoryMutation.mutate({ name: t("categoryEditor.defaultName") });
  };

  const setCategoryDraftName = (categoryId: string, value: string) => {
    setCategoryDrafts((current) =>
      current.map((category) => (category.id === categoryId ? { ...category, name: value } : category)),
    );
  };

  const moveCategory = (categoryId: string, overCategoryId: string) => {
    setCategoryDrafts((current) => reorderCategoryDrafts(current, categoryId, overCategoryId));
  };

  const saveCategoryDrafts = () => {
    if (!session.revisionToken || !hasDraftChanges) return;
    saveCategoryDraftsMutation.mutate({
      drafts: categoryDrafts,
      expectedRevisionToken: session.revisionToken,
      baseCategories: session.categories,
    });
  };

  const resetCategoryDrafts = () => {
    setSession(sessionFrom(categoryCatalog));
    setCategoryDrafts(toCategoryDrafts(categoryCatalog?.categories ?? []));
  };

  const deleteCategory = (categoryId: string) => {
    if (!canRunDirectCommands || !session.revisionToken) return;
    deleteCategoryMutation.mutate({
      categoryId,
      expectedRevisionToken: session.revisionToken,
    });
  };

  return {
    categoryDrafts,
    deletingCategoryId,
    isCreating: createCategoryMutation.isPending,
    isSavingDrafts: saveCategoryDraftsMutation.isPending,
    hasDraftChanges,
    isDirty: hasDraftChanges,
    canSaveDrafts: hasDraftChanges && !saveCategoryDraftsMutation.isPending && Boolean(session.revisionToken),
    canRunDirectCommands,
    createCategory,
    setCategoryDraftName,
    moveCategory,
    saveCategoryDrafts,
    resetCategoryDrafts,
    deleteCategory,
  };
}
