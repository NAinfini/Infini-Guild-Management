import type { WikiArticle, WikiCategory } from "@guild/shared";
import { TIPTAP_DEFAULT_JSON } from "@portal/components/shared/tiptap-meta";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useAppError } from "./useAppError";
import { notifySuccess } from "../utils/notifications";
import {
  createWikiArticle,
  type CreateWikiArticlePayload,
  type UpdateWikiArticlePayload,
  updateWikiArticle,
  uploadWikiArticleImages,
  deleteWikiArticle,
} from "../services/WikiService";
import { queryKeys } from "../api/query-keys";

type UseWikiArticleEditorParams = {
  canEdit: boolean;
  categories: WikiCategory[];
  selectedArticle: WikiArticle | null;
  selectedCategoryId?: string;
  selectedCategoryIds: string[];
  onArticleCreated: (slug: string | null) => void;
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

  /** 把编辑器恢复成 base 的原样（base 为 null 就是清空），并撤掉两个待保存意图。 */
  const resetDraft = (base: WikiArticle | null) => {
    setArticleTitle(base?.title ?? "");
    setArticleBody(base?.body_json ?? TIPTAP_DEFAULT_JSON);
    setArticleSortOrder(base?.sort_order ?? 0);
    setArticleCategoryId(base?.category_id ?? "");
    isCreatingArticleHandlers.close();
    setPinnedIntent("none");
    setArchiveIntent("none");
  };

  const createArticleMutation = useMutation({
    mutationFn: createWikiArticle,
    onSuccess: async (created) => {
      notifySuccess(t("message.articleCreated"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      /*
       * 先把草稿清干净再跳转。跳转要经过未保存改动拦截器（useBeforeUnloadPrompt），
       * 草稿还在的话，用户刚点完「创建」就会被问「有未保存的改动，确定离开吗」；
       * 选 Stay 更糟——列表里新文章已经是选中态，地址栏却停在 ?selection=none，
       * 刷新一下选中就没了。flushSync 是为了让拦截器在这次跳转被评估之前
       * 就看到已经不脏的状态，否则 setState 还没落地，拦截器读到的仍是旧值。
       */
      flushSync(() => resetDraft(null));
      onArticleCreated(created.slug);
    },
    onError: (error) => {
      showError(error, t("message.articleCreateFailed"));
    },
  });

  const updateArticleMutation = useMutation({
    mutationFn: ({ id, payload, ifMatch }: { id: string; payload: UpdateWikiArticlePayload; ifMatch?: string }) => updateWikiArticle(id, payload, ifMatch),
    onSuccess: async () => {
      notifySuccess(t("message.articleSaved"));
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

  const deleteArticleMutation = useMutation({
    mutationFn: (id: string) => deleteWikiArticle(id),
    onSuccess: async () => {
      notifySuccess(t("message.articleDeleted"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      onArticleCreated(null);
    },
    onError: (error) => {
      showError(error, t("message.articleDeleteFailed"));
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
    resetDraft(selectedArticle);
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
      ifMatch: `"wiki-${selectedArticle.id}-${selectedArticle.updated_at}"`,
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

  const deleteArticle = (id: string) => {
    deleteArticleMutation.mutate(id);
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
    if (/^(?:https?:)?\/\//i.test(key) || key.startsWith("data:")) return key;
    const path = `/api/wiki/image?key=${encodeURIComponent(key)}`;
    return new URL(path, window.location.origin).toString();
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
    deleteArticle,
  };
}
