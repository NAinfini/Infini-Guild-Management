import { type PaginatedResponse, type WikiArticle } from "@guild/shared";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useDebouncedSearch } from "./useDebouncedSearch";
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
type WikiSelection =
  | { kind: "auto" }
  | { kind: "none" }
  | { kind: "selected"; slug: string };
type WikiRouteSearch = { selection?: "none" };
type WikiListCache = InfiniteData<PaginatedResponse<WikiArticle>>;

function toArchivedParam(mode: WikiArchivedMode): boolean | undefined {
  if (mode === "active") return false;
  if (mode === "archived") return true;
  return undefined;
}

function selectionFromRoute(
  routeSlug: string | null,
  search: WikiRouteSearch,
): WikiSelection {
  if (routeSlug) return { kind: "selected", slug: routeSlug };
  if (search.selection === "none") return { kind: "none" };
  return { kind: "auto" };
}

function sameSelection(left: WikiSelection, right: WikiSelection): boolean {
  return left.kind === right.kind
    && (left.kind !== "selected"
      || (right.kind === "selected" && left.slug === right.slug));
}

function flattenUniqueArticles(data: WikiListCache | undefined): WikiArticle[] {
  const byId = new Map<string, WikiArticle>();
  for (const page of data?.pages ?? []) {
    for (const article of page.data) {
      if (!byId.has(article.id)) byId.set(article.id, article);
    }
  }
  return [...byId.values()];
}

export function useWikiPageController() {
  const { t } = useTranslation("wiki");
  const confirm = useConfirmDialog();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const routeSlug = (params as { slug?: string }).slug ?? null;
  const routeSearch = useSearch({ strict: false }) as WikiRouteSearch;
  const isDesktop = useMediaQuery("(min-width: 1200px)", true);
  const isMobile = !isDesktop;
  const isExternalView = useExternalView();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const isModerator = canManagePermission(["wiki.articles.create", "wiki.articles.edit", "wiki.articles.archive", "wiki.articles.delete", "wiki.categories.manage"]);
  const canEdit = isModerator && !isExternalView;
  const canCreateArticle = canManagePermission(["wiki.articles.create"]) && !isExternalView;
  const canManageCategories = canManagePermission(["wiki.categories.manage"]) && !isExternalView;

  const { search, setSearch, debouncedSearch: debouncedSearchRaw } = useDebouncedSearch();
  const debouncedSearch = debouncedSearchRaw.trim();
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [archivedMode, setArchivedMode] = useState<WikiArchivedMode>("active");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<WikiSelection>(() =>
    selectionFromRoute(routeSlug, routeSearch));
  const selectedSlug = selection.kind === "selected" ? selection.slug : null;
  const [editorTab, setEditorTab] = useState<"article" | "categories">("article");
  const [mobilePane, setMobilePane] = useState<"list" | "article">("list");
  const [showEditorPane, editorPaneHandlers] = useDisclosure(false);
  const [showHistory, historyHandlers] = useDisclosure(false);
  const isEditorPaneVisible = canEdit && showEditorPane;
  const isHistoryOpen = canEdit && showHistory;

  const categoriesQuery = useQuery({
    queryKey: queryKeys.wiki.categories(),
    queryFn: fetchWikiCategories,
    staleTime: Infinity,
  });

  const selectedCategoryFilterKey =
    selectedCategoryIds.length === 0 ? "all" : [...selectedCategoryIds].sort().join(",");

  const articlesQuery = useInfiniteQuery({
    queryKey: queryKeys.wiki.articles(selectedCategoryFilterKey, debouncedSearch, archivedMode, pinnedOnly),
    queryFn: ({ pageParam }) =>
      fetchWikiArticles({
        page: pageParam,
        limit: 50,
        category_id: selectedCategoryIds,
        search: debouncedSearch || undefined,
        archived: toArchivedParam(archivedMode),
        pinned: pinnedOnly ? true : undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    staleTime: 10 * 60_000,
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.wiki.article(selectedSlug),
    enabled: Boolean(selectedSlug),
    queryFn: () => fetchWikiArticleBySlug(selectedSlug as string),
    staleTime: 10 * 60_000,
  });

  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const categoriesById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);

  const articles = useMemo(
    () => flattenUniqueArticles(articlesQuery.data),
    [articlesQuery.data],
  );
  const articlesHasMore = articlesQuery.hasNextPage ?? false;

  const selectedArticle = detailQuery.data ?? null;

  const setWikiSelection = useCallback((
    next: WikiSelection,
    options?: { replace?: boolean },
  ) => {
    setSelection(next);
    if (next.kind === "selected") {
      void navigate({
        to: "/wiki/$slug",
        params: { slug: next.slug },
        search: (previous) => ({ ...previous, selection: undefined }),
        replace: options?.replace,
        viewTransition: false,
      });
      return;
    }
    void navigate({
      to: "/wiki",
      search: (previous) => ({
        ...previous,
        selection: next.kind === "none" ? "none" as const : undefined,
      }),
      replace: options?.replace,
      viewTransition: false,
    });
  }, [navigate]);

  const handleArticleCreated = useCallback((slug: string | null) => {
    setWikiSelection(
      slug ? { kind: "selected", slug } : { kind: "none" },
      { replace: true },
    );
  }, [setWikiSelection]);

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
    const next = selectionFromRoute(routeSlug, routeSearch);
    setSelection((current) => sameSelection(current, next) ? current : next);
  }, [routeSearch.selection, routeSlug]);

  useEffect(() => {
    if (selection.kind !== "auto" || articleEditor.isCreatingArticle) return;
    const firstSlug = articles[0]?.slug;
    if (firstSlug) {
      setWikiSelection({ kind: "selected", slug: firstSlug }, { replace: true });
    }
  }, [articleEditor.isCreatingArticle, articles, selection.kind, setWikiSelection]);

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
    setWikiSelection({ kind: "selected", slug });
    if (isMobile) {
      setMobilePane("article");
    }
  }, [isMobile, setWikiSelection]);

  const handleStartCreateArticle = useCallback(() => {
    if (!canCreateArticle) return;
    setEditorTab("article");
    editorPaneHandlers.open();
    articleEditor.startCreateArticle();
    setWikiSelection({ kind: "none" });
    if (isMobile) {
      setMobilePane("article");
    }
  }, [articleEditor, canCreateArticle, editorPaneHandlers, isMobile, setWikiSelection]);

  const handleOpenArticleEditor = useCallback(() => {
    setEditorTab("article");
    editorPaneHandlers.open();
    if (isMobile) {
      setMobilePane("article");
    }
  }, [editorPaneHandlers, isMobile]);

  const handleOpenCategoryEditor = useCallback(() => {
    if (!canManageCategories) return;
    setEditorTab("categories");
    editorPaneHandlers.open();
    if (isMobile) {
      setMobilePane("article");
    }
  }, [canManageCategories, editorPaneHandlers, isMobile]);

  const handleExitArticleEditor = useCallback(async () => {
    if (articleEditor.isDirty) {
      const confirmed = await confirm({
        title: t("confirm.discardArticle.title"),
        description: t("confirm.discardArticle.description"),
        confirmLabel: t("common:action.discard"),
        cancelLabel: t("common:action.cancel"),
        intent: "danger",
      });
      if (!confirmed) {
        return;
      }
    }
    articleEditor.exitEditor();
    editorPaneHandlers.close();
  }, [articleEditor, confirm, editorPaneHandlers, t]);

  const handleCategoryFilterChange = useCallback((values: string[]) => {
    setSelectedCategoryIds(values);
    setSelectedCategoryId(values.length === 1 ? values[0] : undefined);
  }, []);

  const handleCloseCategoryEditorWithoutSave = useCallback(async () => {
    if (categoryEditor.isDirty) {
      const confirmed = await confirm({
        title: t("confirm.discardCategory.title"),
        description: t("confirm.discardCategory.description"),
        confirmLabel: t("common:action.discard"),
        cancelLabel: t("common:action.cancel"),
        intent: "danger",
      });
      if (!confirmed) return;
    }
    categoryEditor.resetCategoryDrafts();
    editorPaneHandlers.close();
  }, [categoryEditor, confirm, editorPaneHandlers, t]);

  const handleDeleteCategory = useCallback(async (categoryId: string) => {
    const category = categoriesById.get(categoryId);
    if (!category) return;
    const confirmed = await confirm({
      title: t("confirm.deleteCategory.title"),
      description: t("confirm.deleteCategory.description", { name: category.name }),
      confirmLabel: t("common:action.delete"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });
    if (confirmed) {
      categoryEditor.deleteCategory(categoryId);
    }
  }, [categoriesById, categoryEditor, confirm, t]);

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
    articlesLoadingMore: articlesQuery.isFetchingNextPage,
    loadMoreArticles: () => void articlesQuery.fetchNextPage(),
    selectedArticle,
    selectedSlug,
    selectedCategory,
    canEdit,
    canCreateArticle,
    canManageCategories,

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
  };
}
