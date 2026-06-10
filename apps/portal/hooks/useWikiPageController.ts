import { type WikiArticle } from "@guild/shared";
import { modals } from "@mantine/modals";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchWikiArticleBySlug,
  fetchWikiArticles,
  fetchWikiCategories,
} from "../services/WikiService";
import { useBeforeUnloadPrompt } from "./useBeforeUnloadPrompt";
import { useExternalView } from "./useExternalView";
import { useWikiArticleEditor } from "./useWikiArticleEditor";
import { useWikiCategoryEditor } from "./useWikiCategoryEditor";
import { queryKeys } from "../api/query-keys";
import { useEffectivePermissions } from "./useEffectivePermissions";

type WikiArchivedMode = "active" | "archived" | "all";

function toArchivedParam(mode: WikiArchivedMode): boolean | undefined {
  if (mode === "active") return false;
  if (mode === "archived") return true;
  return undefined;
}

export function useWikiPageController() {
  const { t } = useTranslation("wiki");
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const routeSlug = (params as { slug?: string }).slug ?? null;
  const isDesktop = useMediaQuery("(min-width: 1200px)", true);
  const isMobile = !isDesktop;
  const isExternalView = useExternalView();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const isModerator = canManagePermission(["wiki.articles.create", "wiki.articles.edit", "wiki.articles.archive", "wiki.articles.delete", "wiki.categories.manage"]);
  const canEdit = isModerator && !isExternalView;

  const { search, setSearch, debouncedSearch: debouncedSearchRaw } = useDebouncedSearch();
  const debouncedSearch = debouncedSearchRaw.trim();
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [archivedMode, setArchivedMode] = useState<WikiArchivedMode>("active");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(routeSlug);
  const [skipAutoSelectOnce, setSkipAutoSelectOnce] = useState(false);
  const [editorTab, setEditorTab] = useState<"article" | "categories">("article");
  const [mobilePane, setMobilePane] = useState<"list" | "article">("list");
  const [showEditorPane, editorPaneHandlers] = useDisclosure(false);
  const [showHistory, historyHandlers] = useDisclosure(false);
  const isEditorPaneVisible = canEdit && showEditorPane;
  const isHistoryOpen = canEdit && showHistory;

  const [articlesPage, setArticlesPage] = useState(1);
  const accumulatedArticlesRef = useRef<WikiArticle[]>([]);
  const [accumulatedArticles, setAccumulatedArticles] = useState<WikiArticle[]>([]);
  const [articlesTotal, setArticlesTotal] = useState(0);

  const categoriesQuery = useQuery({
    queryKey: queryKeys.wiki.categories(),
    queryFn: fetchWikiCategories,
    staleTime: Infinity,
  });

  const selectedCategoryFilterKey =
    selectedCategoryIds.length === 0 ? "all" : [...selectedCategoryIds].sort().join(",");
  const singleSelectedCategoryId = selectedCategoryIds.length === 1 ? selectedCategoryIds[0] : undefined;

  const articlesQuery = useQuery({
    queryKey: queryKeys.wiki.articles(selectedCategoryFilterKey, debouncedSearch, archivedMode, pinnedOnly, articlesPage),
    queryFn: () =>
      fetchWikiArticles({
        page: articlesPage,
        limit: 50,
        category_id: singleSelectedCategoryId,
        search: debouncedSearch || undefined,
        archived: toArchivedParam(archivedMode),
        pinned: pinnedOnly ? true : undefined,
      }),
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.wiki.article(selectedSlug),
    enabled: Boolean(selectedSlug),
    queryFn: () => fetchWikiArticleBySlug(selectedSlug as string),
    staleTime: 10 * 60_000,
  });

  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const categoriesById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);

  // Reset accumulated articles when filter params change
  useEffect(() => {
    accumulatedArticlesRef.current = [];
    setAccumulatedArticles([]);
    setArticlesTotal(0);
    setArticlesPage(1);

  }, [selectedCategoryFilterKey, debouncedSearch, archivedMode, pinnedOnly]);

  // Accumulate articles across pages
  useEffect(() => {
    if (!articlesQuery.data) return;
    const newItems = articlesQuery.data.data;
    if (articlesPage === 1) {
      accumulatedArticlesRef.current = newItems;
    } else {
      const existingIds = new Set(accumulatedArticlesRef.current.map((item) => item.id));
      const deduplicated = newItems.filter((item) => !existingIds.has(item.id));
      accumulatedArticlesRef.current = [...accumulatedArticlesRef.current, ...deduplicated];
    }
    setAccumulatedArticles([...accumulatedArticlesRef.current]);
    setArticlesTotal(articlesQuery.data.total);
  }, [articlesQuery.data, articlesPage]);

  const articlesHasMore = accumulatedArticles.length < articlesTotal;

  const articles = useMemo(() => {
    const selectedSet = new Set(selectedCategoryIds);
    return accumulatedArticles.filter((item) => {
      if (selectedCategoryIds.length > 0 && !selectedSet.has(item.category_id)) {
        return false;
      }
      return true;
    });
  }, [accumulatedArticles, selectedCategoryIds]);

  const selectedArticle = detailQuery.data ?? null;

  const handleArticleCreated = useCallback((slug: string | null) => {
    setSelectedSlug(slug);
    if (slug) {
      setSkipAutoSelectOnce(false);
      return;
    }
    setSkipAutoSelectOnce(true);
    if (routeSlug) {
      void navigate({ to: "/wiki", replace: true, viewTransition: false });
    }
  }, [navigate, routeSlug]);

  const articleEditor = useWikiArticleEditor({
    canEdit,
    categories,
    selectedArticle,
    selectedCategoryId,
    selectedCategoryIds,
    onArticleCreated: handleArticleCreated,
  });
  const categoryEditor = useWikiCategoryEditor({ categories });

  useEffect(() => {
    if (routeSlug && routeSlug !== selectedSlug) {
      setSelectedSlug(routeSlug);
      setSkipAutoSelectOnce(false);
    }
  }, [routeSlug, selectedSlug]);

  useEffect(() => {
    if (skipAutoSelectOnce) {
      return;
    }
    if (!selectedSlug && !articleEditor.isCreatingArticle && articles.length > 0) {
      const firstSlug = articles[0]?.slug ?? null;
      setSelectedSlug(firstSlug);
      if (firstSlug) {
        void navigate({
          to: "/wiki/$slug",
          params: { slug: firstSlug },
          replace: true,
          viewTransition: false,
        });
      }
    }
  }, [articleEditor.isCreatingArticle, articles, navigate, routeSlug, selectedSlug, skipAutoSelectOnce]);

  useEffect(() => {
    if (!isMobile) {
      setMobilePane("list");
    }
  }, [isMobile]);

  useEffect(() => {
    const categoryIdSet = new Set(categories.map((item) => item.id));
    setSelectedCategoryIds((current) => {
      const next = current.filter((id) => categoryIdSet.has(id));
      return next.length === current.length ? current : next;
    });
  }, [categories]);

  useEffect(() => {
    if (!canEdit) {
      editorPaneHandlers.close();
    }
  }, [canEdit, editorPaneHandlers]);

  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));
  const selectedCategory = selectedArticle ? categoriesById.get(selectedArticle.category_id) ?? null : null;

  useBeforeUnloadPrompt(isEditorPaneVisible && (articleEditor.isDirty || categoryEditor.isDirty));

  const handleSelectArticle = useCallback((slug: string) => {
    setSkipAutoSelectOnce(false);
    setSelectedSlug(slug);
    void navigate({
      to: "/wiki/$slug",
      params: { slug },
      viewTransition: false,
    });
    if (isMobile) {
      setMobilePane("article");
    }
  }, [isMobile, navigate]);

  const handleStartCreateArticle = useCallback(() => {
    setEditorTab("article");
    editorPaneHandlers.open();
    articleEditor.startCreateArticle();
    setSelectedSlug(null);
    setSkipAutoSelectOnce(true);
    if (routeSlug) {
      void navigate({ to: "/wiki", viewTransition: false });
    }
    if (isMobile) {
      setMobilePane("article");
    }
  }, [articleEditor, editorPaneHandlers, isMobile, navigate, routeSlug]);

  const handleOpenArticleEditor = useCallback(() => {
    setEditorTab("article");
    editorPaneHandlers.open();
    if (isMobile) {
      setMobilePane("article");
    }
  }, [editorPaneHandlers, isMobile]);

  const handleOpenCategoryEditor = useCallback(() => {
    setEditorTab("categories");
    editorPaneHandlers.open();
    if (isMobile) {
      setMobilePane("article");
    }
  }, [editorPaneHandlers, isMobile]);

  const handleExitArticleEditor = useCallback(() => {
    if (articleEditor.isDirty) {
      modals.openConfirmModal({
        title: t("confirm.discardArticle.title"),
        children: t("confirm.discardArticle.description"),
        centered: true,
        confirmProps: { color: "red" },
        labels: {
          cancel: t("common:action.cancel"),
          confirm: t("common:action.discard"),
        },
        onConfirm: () => {
          articleEditor.exitEditor();
          editorPaneHandlers.close();
        },
      });
      return;
    }
    articleEditor.exitEditor();
    editorPaneHandlers.close();
  }, [articleEditor, editorPaneHandlers, t]);

  const setSkipAutoSelectOnceTrue = useCallback(() => {
    setSkipAutoSelectOnce(true);
  }, []);

  const handleCategoryFilterChange = useCallback((values: string[]) => {
    setSelectedCategoryIds(values);
    setSelectedCategoryId(values.length === 1 ? values[0] : undefined);
  }, []);

  const handleCloseCategoryEditorWithoutSave = useCallback(() => {
    categoryEditor.resetCategoryDrafts();
    editorPaneHandlers.close();
  }, [categoryEditor, editorPaneHandlers]);

  const handleDeleteCategory = useCallback((categoryId: string) => {
    const category = categoriesById.get(categoryId);
    if (!category) return;
    modals.openConfirmModal({
      title: t("confirm.deleteCategory.title"),
      children: t("confirm.deleteCategory.description", { name: category.name }),
      centered: true,
      confirmProps: { color: "red" },
      labels: {
        cancel: t("common:action.cancel"),
        confirm: t("common:action.delete"),
      },
      onConfirm: () => categoryEditor.deleteCategory(categoryId),
    });
  }, [categoriesById, categoryEditor, t]);

  return {
    // layout / responsive
    isMobile,
    mobilePane,
    setMobilePane,
    isEditorPaneVisible,
    editorTab,

    // filter state
    search,
    setSearch,
    pinnedOnly,
    setPinnedOnly,
    archivedMode,
    setArchivedMode,
    selectedCategoryIds,

    // queries
    categoriesQuery,
    articlesQuery,
    detailQuery,

    // derived data
    categories,
    categoryOptions,
    articles,
    articlesHasMore,
    articlesPage,
    setArticlesPage,
    selectedArticle,
    selectedSlug,
    selectedCategory,
    canEdit,

    // revision history
    isHistoryOpen,
    openHistory: historyHandlers.open,
    closeHistory: historyHandlers.close,

    // sub-editors
    articleEditor,
    categoryEditor,

    // handlers
    handleSelectArticle,
    handleStartCreateArticle,
    handleOpenArticleEditor,
    handleOpenCategoryEditor,
    handleExitArticleEditor,
    handleCategoryFilterChange,
    handleCloseCategoryEditorWithoutSave,
    handleDeleteCategory,
    setSkipAutoSelectOnceTrue,
  };
}
