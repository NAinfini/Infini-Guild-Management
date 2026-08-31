import { wikiArticleEtag, type WikiArticle } from "@guild/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../api/query-keys";
import {
  fetchWikiArticleRevision,
  fetchWikiArticleRevisions,
  restoreWikiArticleRevision,
} from "../services/WikiService";
import { useAppError } from "./useAppError";
import { notifySuccess } from "../utils/notifications";
import { areWikiHistoryBodiesEqual, compareWikiHistory } from "../utils/wiki-history-diff";

export type { WikiHistoryDiffBlock } from "../utils/wiki-history-diff";

export type WikiHistoryCompareMode = "current" | "previous";

type UseWikiHistoryParams = {
  article: WikiArticle;
  opened: boolean;
  onClose: () => void;
};

export function useWikiHistory({ article, opened, onClose }: UseWikiHistoryParams) {
  const { t } = useTranslation("wiki");
  const queryClient = useQueryClient();
  const { showError } = useAppError();
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState<WikiHistoryCompareMode>("current");
  const [articleAtOpen, setArticleAtOpen] = useState<WikiArticle | null>(null);

  useEffect(() => {
    if (!opened) {
      setArticleAtOpen(null);
      return;
    }
    setArticleAtOpen((current) => current?.id === article.id ? current : article);
  }, [article, opened]);

  const currentArticle = articleAtOpen?.id === article.id ? articleAtOpen : article;

  const revisionsQuery = useQuery({
    queryKey: queryKeys.wiki.revisions(currentArticle.id),
    enabled: opened,
    queryFn: () => fetchWikiArticleRevisions(currentArticle.id),
  });
  const revisions = useMemo(() => revisionsQuery.data ?? [], [revisionsQuery.data]);
  const latestRevisionNumber = revisions[0]?.revision ?? null;

  useEffect(() => {
    if (!opened) {
      setSelectedRevision(null);
      setCompareMode("current");
      return;
    }
    if (selectedRevision === null && latestRevisionNumber !== null) {
      setSelectedRevision(latestRevisionNumber);
    }
  }, [opened, latestRevisionNumber, selectedRevision]);

  const detailQuery = useQuery({
    queryKey: queryKeys.wiki.revision(currentArticle.id, selectedRevision),
    enabled: opened && selectedRevision !== null,
    queryFn: () => fetchWikiArticleRevision(currentArticle.id, selectedRevision as number),
  });

  const previousRevisionNumber = selectedRevision !== null && selectedRevision > 1 ? selectedRevision - 1 : null;
  const previousQuery = useQuery({
    queryKey: queryKeys.wiki.revision(currentArticle.id, previousRevisionNumber),
    enabled: opened && compareMode === "previous" && previousRevisionNumber !== null,
    queryFn: () => fetchWikiArticleRevision(currentArticle.id, previousRevisionNumber as number),
  });

  const restoreMutation = useMutation({
    mutationFn: (revision: number) => restoreWikiArticleRevision(
      currentArticle.id,
      revision,
      wikiArticleEtag(currentArticle),
    ),
    onSuccess: async () => {
      notifySuccess(t("history.message.restored"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      onClose();
    },
    onError: (error) => {
      showError(error, t("history.message.restoreFailed"));
    },
  });

  const selected = detailQuery.data ?? null;
  const isIdenticalToCurrent = selected !== null
    && selected.title === currentArticle.title
    && areWikiHistoryBodiesEqual(selected.body_json, currentArticle.body_json);

  const diff = useMemo(() => {
    if (!selected) return null;
    if (compareMode === "current") {
      return compareWikiHistory(
        { title: selected.title, bodyJson: selected.body_json },
        { title: currentArticle.title, bodyJson: currentArticle.body_json },
      );
    }
    if (previousRevisionNumber === null || !previousQuery.data) return null;
    return compareWikiHistory(
      { title: previousQuery.data.title, bodyJson: previousQuery.data.body_json },
      { title: selected.title, bodyJson: selected.body_json },
    );
  }, [selected, compareMode, currentArticle.title, currentArticle.body_json, previousRevisionNumber, previousQuery.data]);

  const hasChanges = diff !== null && (diff.titleChanged || diff.formatChanged
    || diff.blocks.some((block) => block.kind !== "context"));
  const isDiffLoading = detailQuery.isLoading || (compareMode === "previous" && previousRevisionNumber !== null && previousQuery.isLoading);
  const listError = revisionsQuery.isError;
  const diffError = detailQuery.isError || (compareMode === "previous" && previousRevisionNumber !== null && previousQuery.isError);

  return {
    revisions,
    isListLoading: revisionsQuery.isLoading,
    listError,
    retryList: () => revisionsQuery.refetch(),
    latestRevisionNumber,
    selectedRevision,
    setSelectedRevision,
    compareMode,
    setCompareMode,
    previousRevisionNumber,
    diff,
    hasChanges,
    isDiffLoading,
    diffError,
    retryDiff: async () => {
      const retries = [detailQuery.refetch()];
      if (compareMode === "previous" && previousRevisionNumber !== null) retries.push(previousQuery.refetch());
      await Promise.all(retries);
    },
    isIdenticalToCurrent,
    restore: (revision: number) => restoreMutation.mutate(revision),
    isRestoring: restoreMutation.isPending,
  };
}
