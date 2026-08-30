import { wikiArticleEtag, type WikiArticle, type WikiCategory } from "@guild/shared";
import { TIPTAP_DEFAULT_JSON } from "@portal/components/shared/tiptap-meta";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAppError } from "./useAppError";
import { notifySuccess } from "../utils/notifications";
import {
  archiveWikiArticle,
  createWikiArticle,
  type CreateWikiArticlePayload,
  type UpdateWikiArticlePayload,
  updateWikiArticle,
  uploadWikiArticleImages,
  deleteWikiArticle,
} from "../services/WikiService";
import { queryKeys } from "../api/query-keys";
import { resolveMediaUrl } from "../utils/media";

type UseWikiArticleEditorParams = {
  canCreate: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  categories: WikiCategory[];
  selectedArticle: WikiArticle | null;
  selectedCategoryId?: string;
  onArticleCreated: (slug: string | null) => void;
};

function getDefaultCategoryId(
  categories: WikiCategory[],
  selectedCategoryId: string | undefined,
) {
  return selectedCategoryId ?? categories[0]?.id ?? "";
}

export function useWikiArticleEditor({
  canCreate,
  canEdit,
  canArchive,
  canDelete,
  categories,
  selectedArticle,
  selectedCategoryId,
  onArticleCreated,
}: UseWikiArticleEditorParams) {
  const { t } = useTranslation("wiki");
  const queryClient = useQueryClient();
  const { showError } = useAppError();
  const deletePendingRef = useRef(false);
  const editorBaselineRef = useRef<WikiArticle | null>(null);
  const createSessionRef = useRef(0);

  const [articleTitle, setArticleTitle] = useState("");
  const [articleBody, setArticleBody] = useState(TIPTAP_DEFAULT_JSON);
  const [articleSortOrder, setArticleSortOrder] = useState(0);
  const [articleCategoryId, setArticleCategoryId] = useState("");
  const [pinnedIntent, setPinnedIntent] = useState<"none" | "pin" | "unpin">("none");
  const [archiveIntent, setArchiveIntent] = useState<"none" | "archive" | "unarchive">("none");
  const [isCreatingArticle, setIsCreatingArticle] = useState(false);

  useEffect(() => {
    if (!canCreate && !canEdit) {
      setIsCreatingArticle(false);
    }
  }, [canCreate, canEdit]);

  useEffect(() => {
    if (!selectedArticle || isCreatingArticle) {
      return;
    }

    const baseline = editorBaselineRef.current;
    if (!baseline || baseline.id !== selectedArticle.id) {
      editorBaselineRef.current = null;
      setIsCreatingArticle(false);
      setPinnedIntent("none");
      setArchiveIntent("none");
      setArticleTitle(selectedArticle.title);
      setArticleBody(selectedArticle.body_json);
      setArticleSortOrder(selectedArticle.sort_order);
      setArticleCategoryId(selectedArticle.category_id);
    }
  }, [selectedArticle]);

  /** 把编辑器恢复成 base 的原样（base 为 null 就是清空），并撤掉两个待保存意图。 */
  const resetDraft = (base: WikiArticle | null) => {
    setArticleTitle(base?.title ?? "");
    setArticleBody(base?.body_json ?? TIPTAP_DEFAULT_JSON);
    setArticleSortOrder(base?.sort_order ?? 0);
    setArticleCategoryId(base?.category_id ?? "");
    setIsCreatingArticle(false);
    setPinnedIntent("none");
    setArchiveIntent("none");
  };

  const createArticleMutation = useMutation({
    mutationFn: ({ payload }: { payload: CreateWikiArticlePayload; sessionId: number }) => createWikiArticle(payload),
    onSuccess: async (created, { sessionId }) => {
      notifySuccess(t("message.articleCreated"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      if (sessionId !== createSessionRef.current) return;
      /*
       * 先把草稿清干净再跳转。跳转要经过未保存改动拦截器（useBeforeUnloadPrompt），
       * 草稿还在的话，用户刚点完「创建」就会被问「有未保存的改动，确定离开吗」；
       * 选 Stay 更糟——列表里新文章已经是选中态，地址栏却停在 ?selection=none，
       * 刷新一下选中就没了。flushSync 是为了让拦截器在这次跳转被评估之前
       * 就看到已经不脏的状态，否则 setState 还没落地，拦截器读到的仍是旧值。
       */
      flushSync(() => resetDraft(null));
      editorBaselineRef.current = null;
      onArticleCreated(created.slug);
    },
    onError: (error) => {
      showError(error, t("message.articleCreateFailed"));
    },
  });

  const updateArticleMutation = useMutation({
    mutationFn: ({ id, payload, ifMatch }: { id: string; payload: UpdateWikiArticlePayload; ifMatch: string }) => updateWikiArticle(id, payload, ifMatch),
    onSuccess: async (updated) => {
      notifySuccess(t("message.articleSaved"));
      editorBaselineRef.current = updated;
      resetDraft(updated);
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
    },
    onError: (error) => {
      showError(error, t("message.articleSaveFailed"));
    },
  });

  const deleteArticleMutation = useMutation({
    mutationFn: ({ id, ifMatch }: { id: string; ifMatch: string }) => deleteWikiArticle(id, ifMatch),
    onSuccess: async () => {
      notifySuccess(t("message.articleDeleted"));
      editorBaselineRef.current = null;
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      onArticleCreated(null);
    },
    onError: (error) => {
      showError(error, t("message.articleDeleteFailed"));
    },
    onSettled: () => {
      deletePendingRef.current = false;
    },
  });

  const archiveArticleMutation = useMutation({
    mutationFn: ({ id, ifMatch }: { id: string; ifMatch: string }) => archiveWikiArticle(id, ifMatch),
    onSuccess: async () => {
      notifySuccess(t("message.articleArchived"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
    },
    onError: (error) => {
      showError(error, t("message.articleArchiveFailed"));
    },
  });

  const canCreateArticle = Boolean(
    articleCategoryId || getDefaultCategoryId(categories, selectedCategoryId),
  );
  const editorArticle = editorBaselineRef.current ?? selectedArticle;

  const isDirty = useMemo(() => {
    if (!(isCreatingArticle ? canCreate : canEdit)) {
      return false;
    }

    if (editorArticle) {
      return (
        articleTitle !== editorArticle.title ||
        articleBody !== editorArticle.body_json ||
        articleSortOrder !== editorArticle.sort_order ||
        articleCategoryId !== editorArticle.category_id ||
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
    canCreate,
    editorArticle,
    isCreatingArticle,
    pinnedIntent,
  ]);

  const startCreateArticle = () => {
    if (!canCreate) return;
    createSessionRef.current += 1;
    editorBaselineRef.current = null;
    setIsCreatingArticle(true);
    setPinnedIntent("none");
    setArchiveIntent("none");
    setArticleTitle("");
    setArticleBody(TIPTAP_DEFAULT_JSON);
    setArticleSortOrder(0);
    setArticleCategoryId(getDefaultCategoryId(categories, selectedCategoryId));
  };

  const startEditArticle = () => {
    if (!canEdit || !selectedArticle) return;
    editorBaselineRef.current = selectedArticle;
    resetDraft(selectedArticle);
  };

  const exitEditor = () => {
    createSessionRef.current += 1;
    editorBaselineRef.current = null;
    resetDraft(selectedArticle);
  };

  const saveSelectedArticle = () => {
    if (!canEdit) return;
    const baseline = editorBaselineRef.current ?? selectedArticle;
    if (!baseline) {
      return;
    }

    const payload: UpdateWikiArticlePayload = {
      title: articleTitle,
      body_json: articleBody,
      sort_order: articleSortOrder,
      category_id: articleCategoryId || baseline.category_id,
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
      id: baseline.id,
      payload,
      ifMatch: wikiArticleEtag(baseline),
    });
  };

  const createArticle = () => {
    if (!canCreate || !isCreatingArticle || createArticleMutation.isPending) return;
    const payload: CreateWikiArticlePayload = {
      title: articleTitle || t("articleEditor.defaultTitle"),
      category_id: articleCategoryId || getDefaultCategoryId(categories, selectedCategoryId),
      body_json: articleBody || TIPTAP_DEFAULT_JSON,
      sort_order: articleSortOrder,
    };
    createArticleMutation.mutate({ payload, sessionId: createSessionRef.current });
  };

  const togglePinnedIntent = () => {
    if (!canEdit) return;
    const baseline = editorBaselineRef.current ?? selectedArticle;
    if (!baseline) {
      return;
    }
    setPinnedIntent((current) => {
      if (baseline.pinned) {
        return current === "unpin" ? "none" : "unpin";
      }
      return current === "pin" ? "none" : "pin";
    });
  };

  const toggleArchiveIntent = () => {
    if (!canEdit || !canArchive) return;
    const baseline = editorBaselineRef.current ?? selectedArticle;
    if (!baseline) {
      return;
    }
    setArchiveIntent((current) => {
      if (baseline.archived_at) {
        return current === "unarchive" ? "none" : "unarchive";
      }
      return current === "archive" ? "none" : "archive";
    });
  };

  const deleteArticle = () => {
    if (!canDelete) return;
    if (deletePendingRef.current) return;
    const baseline = editorBaselineRef.current ?? selectedArticle;
    if (!baseline) return;
    deletePendingRef.current = true;
    deleteArticleMutation.mutate({ id: baseline.id, ifMatch: wikiArticleEtag(baseline) });
  };

  const archiveArticle = () => {
    const baseline = editorBaselineRef.current ?? selectedArticle;
    if (!canArchive || !baseline || baseline.archived_at || archiveArticleMutation.isPending) return;
    archiveArticleMutation.mutate({ id: baseline.id, ifMatch: wikiArticleEtag(baseline) });
  };

  const uploadWikiArticleImage = async (file: File) => {
    if (!canEdit) {
      throw new Error("Wiki article edit permission is required to upload images");
    }
    const baseline = editorBaselineRef.current ?? selectedArticle;
    if (!baseline) {
      throw new Error("Save article first before uploading images");
    }
    const uploaded = await uploadWikiArticleImages(baseline.id, [file]);
    const mediaId = uploaded.media_ids[0];
    if (!mediaId) {
      throw new Error("Image upload returned no media id");
    }
    return resolveMediaUrl(mediaId);
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
    editorArticle,
    isCreatingArticle,
    isDirty,
    isSaving: updateArticleMutation.isPending,
    isCreating: createArticleMutation.isPending,
    isDeleting: deleteArticleMutation.isPending,
    isArchiving: archiveArticleMutation.isPending,
    canCreateArticle,
    startCreateArticle,
    startEditArticle,
    exitEditor,
    createArticle,
    saveSelectedArticle,
    togglePinnedIntent,
    toggleArchiveIntent,
    uploadWikiArticleImage,
    deleteArticle,
    archiveArticle,
  };
}
