import type { WikiArticle, WikiCategory } from "@guild/shared";
import { TIPTAP_DEFAULT_JSON } from "@portal/components/shared/TipTapEditor";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useAppError } from "./useAppError";
import {
  createWikiArticle,
  type CreateWikiArticlePayload,
  type UpdateWikiArticlePayload,
  updateWikiArticle,
  uploadWikiArticleImages,
} from "../services/WikiService";
import { queryKeys } from "../services/PortalQueryKeys";

type UseWikiArticleEditorParams = {
  canEdit: boolean;
  categories: WikiCategory[];
  selectedArticle: WikiArticle | null;
  selectedCategoryId?: string;
  selectedCategoryIds: string[];
  onArticleCreated: (slug: string) => void;
};

function getDefaultCategoryId(
  categories: WikiCategory[],
  selectedCategoryId: string | undefined,
  selectedCategoryIds: string[],
) {
  return selectedCategoryId ?? selectedCategoryIds[0] ?? categories[0]?.id ?? "";
}

export function useWikiArticleEditor({
  canEdit,
  categories,
  selectedArticle,
  selectedCategoryId,
  selectedCategoryIds,
  onArticleCreated,
}: UseWikiArticleEditorParams) {
  const { t } = useTranslation("wiki");
  const queryClient = useQueryClient();
  const { showError } = useAppError();

  const [articleTitle, setArticleTitle] = useState("");
  const [articleBody, setArticleBody] = useState(TIPTAP_DEFAULT_JSON);
  const [articleSortOrder, setArticleSortOrder] = useState(0);
  const [articleCategoryId, setArticleCategoryId] = useState("");
  const [pinnedIntent, setPinnedIntent] = useState<"none" | "pin" | "unpin">("none");
  const [archiveIntent, setArchiveIntent] = useState<"none" | "archive" | "unarchive">("none");
  const [isCreatingArticle, isCreatingArticleHandlers] = useDisclosure(false);

  useEffect(() => {
    if (!canEdit) {
      isCreatingArticleHandlers.close();
    }
  }, [canEdit]);

  useEffect(() => {
    if (!selectedArticle || isCreatingArticle) {
      return;
    }

    isCreatingArticleHandlers.close();
    setPinnedIntent("none");
    setArchiveIntent("none");
    setArticleTitle(selectedArticle.title);
    setArticleBody(selectedArticle.body_json);
    setArticleSortOrder(selectedArticle.sort_order);
    setArticleCategoryId(selectedArticle.category_id);
  }, [selectedArticle]);

  const createArticleMutation = useMutation({
    mutationFn: createWikiArticle,
    onSuccess: async (created) => {
      notifications.show({ color: "infini-success", message: t("message.articleCreated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      isCreatingArticleHandlers.close();
      onArticleCreated(created.slug);
    },
    onError: (error) => {
      showError(error, t("message.articleCreateFailed"));
    },
  });

  const updateArticleMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateWikiArticlePayload }) => updateWikiArticle(id, payload),
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.articleSaved") });
      setPinnedIntent("none");
      setArchiveIntent("none");
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      if (selectedArticle?.slug) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.article(selectedArticle.slug) });
      }
    },
    onError: (error) => {
      showError(error, t("message.articleSaveFailed"));
    },
  });

  const canCreateArticle = Boolean(
    articleCategoryId || getDefaultCategoryId(categories, selectedCategoryId, selectedCategoryIds),
  );

  const isDirty = useMemo(() => {
    if (!canEdit) {
      return false;
    }

    if (selectedArticle) {
      return (
        articleTitle !== selectedArticle.title ||
        articleBody !== selectedArticle.body_json ||
        articleSortOrder !== selectedArticle.sort_order ||
        articleCategoryId !== selectedArticle.category_id ||
        pinnedIntent !== "none" ||
        archiveIntent !== "none"
      );
    }

    return (
      articleTitle.trim().length > 0 ||
      articleBody !== TIPTAP_DEFAULT_JSON ||
      articleSortOrder !== 0 ||
      articleCategoryId.trim().length > 0
    );
  }, [
    archiveIntent,
    articleBody,
    articleCategoryId,
    articleSortOrder,
    articleTitle,
    canEdit,
    pinnedIntent,
    selectedArticle,
  ]);

  const startCreateArticle = () => {
    isCreatingArticleHandlers.open();
    setPinnedIntent("none");
    setArchiveIntent("none");
    setArticleTitle("");
    setArticleBody(TIPTAP_DEFAULT_JSON);
    setArticleSortOrder(0);
    setArticleCategoryId(getDefaultCategoryId(categories, selectedCategoryId, selectedCategoryIds));
  };

  const exitEditor = () => {
    if (selectedArticle) {
      setArticleTitle(selectedArticle.title);
      setArticleBody(selectedArticle.body_json);
      setArticleSortOrder(selectedArticle.sort_order);
      setArticleCategoryId(selectedArticle.category_id);
    } else {
      setArticleTitle("");
      setArticleBody(TIPTAP_DEFAULT_JSON);
      setArticleSortOrder(0);
      setArticleCategoryId("");
    }
    isCreatingArticleHandlers.close();
    setPinnedIntent("none");
    setArchiveIntent("none");
  };

  const saveSelectedArticle = () => {
    if (!selectedArticle) {
      return;
    }

    const payload: UpdateWikiArticlePayload = {
      title: articleTitle,
      body_json: articleBody,
      sort_order: articleSortOrder,
      category_id: articleCategoryId || selectedArticle.category_id,
    };
    if (pinnedIntent === "pin") {
      payload.pinned = true;
    }
    if (pinnedIntent === "unpin") {
      payload.pinned = false;
    }
    if (archiveIntent === "archive") {
      payload.archived_at = new Date().toISOString();
    }
    if (archiveIntent === "unarchive") {
      payload.archived_at = null;
    }

    updateArticleMutation.mutate({
      id: selectedArticle.id,
      payload,
    });
  };

  const createArticle = () => {
    const payload: CreateWikiArticlePayload = {
      title: articleTitle || t("articleEditor.defaultTitle"),
      category_id: articleCategoryId || getDefaultCategoryId(categories, selectedCategoryId, selectedCategoryIds),
      body_json: articleBody || TIPTAP_DEFAULT_JSON,
      sort_order: articleSortOrder,
    };
    createArticleMutation.mutate(payload);
  };

  const togglePinnedIntent = () => {
    if (!selectedArticle) {
      return;
    }
    setPinnedIntent((current) => {
      if (selectedArticle.pinned) {
        return current === "unpin" ? "none" : "unpin";
      }
      return current === "pin" ? "none" : "pin";
    });
  };

  const toggleArchiveIntent = () => {
    if (!selectedArticle) {
      return;
    }
    setArchiveIntent((current) => {
      if (selectedArticle.archived_at) {
        return current === "unarchive" ? "none" : "unarchive";
      }
      return current === "archive" ? "none" : "archive";
    });
  };

  const uploadWikiArticleImage = async (file: File) => {
    if (!selectedArticle) {
      throw new Error("Save article first before uploading images");
    }
    const uploaded = await uploadWikiArticleImages(selectedArticle.id, [file]);
    const key = uploaded.keys[0];
    if (!key) {
      throw new Error("Image upload returned no key");
    }
    return key;
  };

  return {
    articleTitle,
    setArticleTitle,
    articleBody,
    setArticleBody,
    articleSortOrder,
    setArticleSortOrder,
    articleCategoryId,
    setArticleCategoryId,
    pinnedIntent,
    archiveIntent,
    isCreatingArticle,
    isDirty,
    isSaving: updateArticleMutation.isPending,
    isCreating: createArticleMutation.isPending,
    canCreateArticle,
    startCreateArticle,
    exitEditor,
    createArticle,
    saveSelectedArticle,
    togglePinnedIntent,
    toggleArchiveIntent,
    uploadWikiArticleImage,
  };
}
