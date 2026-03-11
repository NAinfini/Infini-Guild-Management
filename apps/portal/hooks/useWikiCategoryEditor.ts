import type { WikiCategory } from "@guild/shared";
import { arrayMove } from "@dnd-kit/sortable";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WikiCategoryDraft } from "../components/feature/wiki/WikiCategoryEditorCard";
import { useAppError } from "./useAppError";
import {
  createWikiCategory,
  deleteWikiCategory,
  type UpdateWikiCategoryPayload,
  updateWikiCategory,
} from "../services/WikiService";
import { queryKeys } from "../services/PortalQueryKeys";

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
      notifications.show({ color: "infini-success", message: t("message.categoryCreated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
      setCategoryName("");
    },
    onError: (error) => {
      showError(error, t("message.categoryCreateFailed"));
    },
  });

  const saveCategoryDraftsMutation = useMutation({
    mutationFn: async (drafts: WikiCategoryDraft[]) => {
      const patches = drafts
        .map((draft) => {
          const current = categoriesById.get(draft.id);
          if (!current) {
            return null;
          }

          const payload: UpdateWikiCategoryPayload = {};
          const nextName = draft.name.trim();
          if (nextName && nextName !== current.name) {
            payload.name = nextName;
          }
          const nextParent = draft.parent_id || null;
          if (nextParent !== current.parent_id) {
            payload.parent_id = nextParent;
          }
          if (draft.sort_order !== current.sort_order) {
            payload.sort_order = draft.sort_order;
          }

          return Object.keys(payload).length > 0 ? { id: draft.id, payload } : null;
        })
        .filter((item): item is { id: string; payload: UpdateWikiCategoryPayload } => item !== null);

      for (const patch of patches) {
        await updateWikiCategory(patch.id, patch.payload);
      }

      return patches.length;
    },
    onSuccess: async (changedCount) => {
      if (changedCount > 0) {
        notifications.show({ color: "infini-success", message: t("message.categorySaved") });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
    },
    onError: (error) => {
      showError(error, t("message.categorySaveFailed"));
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: deleteWikiCategory,
    onMutate: (categoryId) => {
      setDeletingCategoryId(categoryId);
    },
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.categoryDeleted") });
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
    void saveCategoryDraftsMutation.mutateAsync(categoryDrafts);
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
