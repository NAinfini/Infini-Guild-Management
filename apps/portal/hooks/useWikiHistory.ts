import type { WikiArticle } from "@guild/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { diffChars, diffLines, type Change } from "diff";
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
import { extractTipTapText } from "../utils/tiptap-text";

export type WikiHistoryCompareMode = "current" | "previous";

export type WikiHistoryDiffBlock =
  | { kind: "context" | "added" | "removed"; text: string }
  | { kind: "modified"; parts: Change[] };

function buildDiffBlocks(oldText: string, newText: string): WikiHistoryDiffBlock[] {
  const changes = diffLines(oldText, newText);
  const blocks: WikiHistoryDiffBlock[] = [];
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]!;
    if (change.removed && changes[i + 1]?.added) {
      blocks.push({ kind: "modified", parts: diffChars(change.value, changes[i + 1]!.value) });
      i++;
      continue;
    }
    if (change.added) blocks.push({ kind: "added", text: change.value });
    else if (change.removed) blocks.push({ kind: "removed", text: change.value });
    else blocks.push({ kind: "context", text: change.value });
  }
  return blocks;
}

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

  const revisionsQuery = useQuery({
    queryKey: queryKeys.wiki.revisions(article.id),
    enabled: opened,
    queryFn: () => fetchWikiArticleRevisions(article.id),
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
    queryKey: queryKeys.wiki.revision(article.id, selectedRevision),
    enabled: opened && selectedRevision !== null,
    queryFn: () => fetchWikiArticleRevision(article.id, selectedRevision as number),
  });

  const previousRevisionNumber = selectedRevision !== null && selectedRevision > 1 ? selectedRevision - 1 : null;
  const previousQuery = useQuery({
    queryKey: queryKeys.wiki.revision(article.id, previousRevisionNumber),
    enabled: opened && compareMode === "previous" && previousRevisionNumber !== null,
    queryFn: () => fetchWikiArticleRevision(article.id, previousRevisionNumber as number),
  });

  const restoreMutation = useMutation({
    mutationFn: (revision: number) => restoreWikiArticleRevision(article.id, revision),
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
  const isIdenticalToCurrent = selected !== null && selected.title === article.title && selected.body_json === article.body_json;

  const diff = useMemo(() => {
    if (!selected) return null;
    if (compareMode === "current") {
      return {
        titleChanged: selected.title !== article.title,
        oldTitle: selected.title,
        newTitle: article.title,
        blocks: buildDiffBlocks(extractTipTapText(selected.body_json), extractTipTapText(article.body_json)),
      };
    }
    if (previousRevisionNumber === null || !previousQuery.data) return null;
    return {
      titleChanged: previousQuery.data.title !== selected.title,
      oldTitle: previousQuery.data.title,
      newTitle: selected.title,
      blocks: buildDiffBlocks(extractTipTapText(previousQuery.data.body_json), extractTipTapText(selected.body_json)),
    };
  }, [selected, compareMode, article.title, article.body_json, previousRevisionNumber, previousQuery.data]);

  const hasChanges = diff !== null && (diff.titleChanged || diff.blocks.some((block) => block.kind !== "context"));
  const isDiffLoading = detailQuery.isLoading || (compareMode === "previous" && previousRevisionNumber !== null && previousQuery.isLoading);

  return {
    revisions,
    isListLoading: revisionsQuery.isLoading,
    latestRevisionNumber,
    selectedRevision,
    setSelectedRevision,
    compareMode,
    setCompareMode,
    previousRevisionNumber,
    diff,
    hasChanges,
    isDiffLoading,
    isIdenticalToCurrent,
    restore: (revision: number) => restoreMutation.mutate(revision),
    isRestoring: restoreMutation.isPending,
  };
}
