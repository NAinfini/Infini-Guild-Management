import { type PaginatedResponse, type WikiArticle } from "@guild/shared";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useMediaQuery } from "@portal/hooks/useMediaQuery";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useRetainedQueryData } from "./useRetainedQueryData";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchWikiArticleBySlug,
  fetchWikiArticles,
  fetchWikiCategories,
  recordWikiArticleView,
} from "../services/WikiService";
import { useBeforeUnloadPrompt } from "./useBeforeUnloadPrompt";
import { useExternalView } from "./useExternalView";
import { useWikiArticleEditor } from "./useWikiArticleEditor";
import { useWikiCategoryEditor } from "./useWikiCategoryEditor";
import { queryKeys } from "../api/query-keys";
import { useEffectivePermissions } from "./useEffectivePermissions";

type WikiArchivedMode = "active" | "archived" | "all";
type WikiSort = "curated" | "updated_desc" | "updated_asc";
type WikiSelection =
  | { kind: "none" }
  | { kind: "selected"; slug: string };
type WikiListCache = InfiniteData<PaginatedResponse<WikiArticle>>;

function toArchivedParam(mode: WikiArchivedMode): boolean | undefined {
  if (mode === "active") return false;
  if (mode === "archived") return true;
  return undefined;
}

function selectionFromRoute(routeSlug: string | null): WikiSelection {
  if (routeSlug) return { kind: "selected", slug: routeSlug };
  return { kind: "none" };
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const routeSlug = (params as { slug?: string }).slug ?? null;
  const routeLocation = useLocation({
    select: (location) => ({
      pathname: location.pathname,
      entryKey: location.state.__TSR_key ?? location.state.key ?? location.href,
    }),
  });
  const { pathname, entryKey: routeEntryKey } = routeLocation;
  const isCreateRoute = pathname === "/wiki/new";
  const isDesktop = useMediaQuery("(min-width: 1200px)");
  const isMobile = !isDesktop;
  const isExternalView = useExternalView();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const canCreateArticle = canManagePermission(["wiki.articles.create"]) && !isExternalView;
  const canEditArticle = canManagePermission(["wiki.articles.edit"]) && !isExternalView;
  const canArchiveArticle = canManagePermission(["wiki.articles.archive"]) && !isExternalView;
  const canDeleteArticle = canManagePermission(["wiki.articles.delete"]) && !isExternalView;
  const canManageCategories = canManagePermission(["wiki.categories.manage"]) && !isExternalView;
  const canViewNonPublicContent = canCreateArticle
    || canEditArticle
    || canArchiveArticle
    || canDeleteArticle;
  const canManageContent = canCreateArticle
    || canEditArticle
    || canArchiveArticle
    || canDeleteArticle
    || canManageCategories;

  const { search, setSearch, debouncedSearch: debouncedSearchRaw } = useDebouncedSearch();
  const debouncedSearch = debouncedSearchRaw.trim();
  const [sortOrder, setSortOrder] = useState<WikiSort>("curated");
  const [archivedMode, setArchivedMode] = useState<WikiArchivedMode>("active");
  const effectiveArchivedMode = canViewNonPublicContent ? archivedMode : "active";
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const [selection, setSelection] = useState<WikiSelection>(() =>
    selectionFromRoute(routeSlug));
  const selectedSlug = selection.kind === "selected" ? selection.slug : null;
  const [editorTab, setEditorTab] = useState<"article" | "categories">("article");
  const [mobilePane, setMobilePane] = useState<"list" | "article">("list");
  const [showEditorPane, setShowEditorPane] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const isEditorPaneVisible = showEditorPane && (
    editorTab === "categories"
      ? canManageCategories
      : canCreateArticle || canEditArticle
  );
  const isHistoryOpen = canEditArticle && showHistory;
  const selectionRef = useRef(selection);
  const articleEditorRef = useRef<ReturnType<typeof useWikiArticleEditor> | null>(null);
  const isMobileRef = useRef(isMobile);
  const editorPaneVisibleRef = useRef(isEditorPaneVisible);
  const closeEditorPaneRef = useRef(() => setShowEditorPane(false));
  const routeSelectionProcessedRef = useRef(false);
  const createRouteInitializedRef = useRef(false);
  const lastViewedArticleRouteEntryRef = useRef<string | null>(null);
  selectionRef.current = selection;
  isMobileRef.current = isMobile;
  editorPaneVisibleRef.current = isEditorPaneVisible;
  closeEditorPaneRef.current = () => setShowEditorPane(false);

  useEffect(() => {
    if (!canViewNonPublicContent && archivedMode !== "active") {
      setArchivedMode("active");
    }
  }, [archivedMode, canViewNonPublicContent]);

  const categoriesQuery = useQuery({
    queryKey: queryKeys.wiki.categories(),
    queryFn: fetchWikiCategories,
    staleTime: Infinity,
  });

  const selectedCategoryFilterKey = selectedCategoryId ?? "all";

  const retainedListData = useRetainedQueryData();
  const articlesQuery = useInfiniteQuery({
    ...retainedListData,
    queryKey: queryKeys.wiki.articles(selectedCategoryFilterKey, debouncedSearch, effectiveArchivedMode, sortOrder),
    queryFn: ({ pageParam }) =>
      fetchWikiArticles({
        page: pageParam,
        limit: 50,
        category_id: selectedCategoryId ? [selectedCategoryId] : [],
        search: debouncedSearch || undefined,
        archived: toArchivedParam(effectiveArchivedMode),
        sort: sortOrder,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    staleTime: 10 * 60_000,
    enabled: pathname === "/wiki",
  });

  const pinnedQuery = useQuery({
    queryKey: queryKeys.wiki.pinned(),
    queryFn: () => fetchWikiArticles({
      page: 1,
      limit: 3,
      archived: false,
      pinned: true,
      sort: "curated",
    }),
    staleTime: 10 * 60_000,
    enabled: pathname === "/wiki",
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.wiki.article(selectedSlug),
    enabled: Boolean(selectedSlug),
    queryFn: () => fetchWikiArticleBySlug(selectedSlug as string),
    staleTime: 10 * 60_000,
  });

  const categoryCatalog = categoriesQuery.data;
  const categories = useMemo(() => categoryCatalog?.categories ?? [], [categoryCatalog]);
  const categoriesById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);

  const articles = useMemo(
    () => flattenUniqueArticles(articlesQuery.data),
    [articlesQuery.data],
  );
  const articlesHasMore = !articlesQuery.isPlaceholderData && (articlesQuery.hasNextPage ?? false);

  const selectedArticle = detailQuery.data ?? null;

  const recordViewMutation = useMutation({
    mutationFn: recordWikiArticleView,
    retry: false,
    onSuccess: ({ view_count }, slug) => {
      queryClient.setQueryData<WikiArticle>(queryKeys.wiki.article(slug), (current) =>
        current ? { ...current, view_count } : current);
      for (const [key, current] of queryClient.getQueriesData<WikiListCache>({ queryKey: queryKeys.wiki.all })) {
        if (!Array.isArray(key) || key[1] !== "articles") continue;
        queryClient.setQueryData<WikiListCache>(key, current ? {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            data: page.data.map((item) => item.slug === slug ? { ...item, view_count } : item),
          })),
        } : current);
      }
      queryClient.setQueryData<PaginatedResponse<WikiArticle>>(queryKeys.wiki.pinned(), (current) =>
        current ? {
          ...current,
          data: current.data.map((item) => item.slug === slug ? { ...item, view_count } : item),
        } : current);
    },
    onError: (error, slug) => {
      console.error(`[wiki-view] failed to count ${slug}`, error);
    },
  });

  useEffect(() => {
    if (!routeSlug) return;
    if (pathname !== `/wiki/${encodeURIComponent(routeSlug)}`) return;
    if (selectedSlug !== routeSlug) return;
    if (!detailQuery.isSuccess || detailQuery.isFetching) return;
    if (lastViewedArticleRouteEntryRef.current === routeEntryKey) return;
    lastViewedArticleRouteEntryRef.current = routeEntryKey;
    recordViewMutation.mutate(selectedSlug);
  }, [detailQuery.isFetching, detailQuery.isSuccess, pathname, recordViewMutation, routeEntryKey, routeSlug, selectedSlug]);

  const setWikiSelection = useCallback((
    next: WikiSelection,
    options?: { replace?: boolean },
  ) => {
    setSelection(next);
    if (next.kind === "selected") {
      void navigate({
        to: "/wiki/$slug",
        params: { slug: next.slug },
        replace: options?.replace,
        viewTransition: false,
      });
      return;
    }
    void navigate({
      to: "/wiki",
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
    canCreate: canCreateArticle,
    canEdit: canEditArticle,
    canArchive: canArchiveArticle,
    canDelete: canDeleteArticle,
    categories,
    selectedArticle,
    selectedCategoryId,
    onArticleCreated: handleArticleCreated,
  });
  articleEditorRef.current = articleEditor;
  const categoryEditor = useWikiCategoryEditor({
    categoryCatalog,
    isOpen: isEditorPaneVisible && editorTab === "categories",
  });

  useEffect(() => {
    const next = selectionFromRoute(routeSlug);
    const routeChangedExternally = !routeSelectionProcessedRef.current
      || !sameSelection(selectionRef.current, next);
    routeSelectionProcessedRef.current = true;
    if (routeChangedExternally && !isCreateRoute) {
      if (articleEditorRef.current?.isCreatingArticle) {
        articleEditorRef.current.exitEditor();
      }
      if (editorPaneVisibleRef.current) {
        closeEditorPaneRef.current();
      }
      if (isMobileRef.current) {
        setMobilePane(next.kind === "selected" ? "article" : "list");
      }
    }
    setSelection((current) => sameSelection(current, next) ? current : next);
  }, [isCreateRoute, routeSlug]);

  useEffect(() => {
    if (!isCreateRoute) {
      createRouteInitializedRef.current = false;
      return;
    }
    if (!canCreateArticle || createRouteInitializedRef.current) return;
    createRouteInitializedRef.current = true;
    setEditorTab("article");
    setShowEditorPane(true);
    articleEditor.startCreateArticle();
    setSelection({ kind: "none" });
  }, [articleEditor, canCreateArticle, isCreateRoute]);

  useEffect(() => {
    if (!isMobile) {
      setMobilePane("list");
    }
  }, [isMobile]);

  useEffect(() => {
    const categoryIdSet = new Set(categories.map((item) => item.id));
    setSelectedCategoryId((current) => current && !categoryIdSet.has(current) ? undefined : current);
  }, [categories]);

  useEffect(() => {
    if (!canManageContent) {
      setShowEditorPane(false);
    }
  }, [canManageContent]);

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
    setShowEditorPane(true);
    articleEditor.startCreateArticle();
    setSelection({ kind: "none" });
    void navigate({ to: "/wiki/new", viewTransition: false });
    if (isMobile) {
      setMobilePane("article");
    }
  }, [articleEditor, canCreateArticle, isMobile, navigate]);

  const handleOpenArticleEditor = useCallback(() => {
    if (!canEditArticle) return;
    setEditorTab("article");
    articleEditor.startEditArticle();
    setShowEditorPane(true);
    if (isMobile) {
      setMobilePane("article");
    }
  }, [articleEditor, canEditArticle, isMobile]);

  const handleOpenCategoryEditor = useCallback(() => {
    if (!canManageCategories) return;
    setEditorTab("categories");
    setShowEditorPane(true);
    if (isMobile) {
      setMobilePane("article");
    }
  }, [canManageCategories, isMobile]);

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
        return false;
      }
    }
    articleEditor.exitEditor();
    setShowEditorPane(false);
    if (isCreateRoute) {
      setWikiSelection({ kind: "none" }, { replace: true });
    }
    return true;
  }, [articleEditor, confirm, isCreateRoute, setWikiSelection, t]);

  const handleCloseCategoryEditorWithoutSave = useCallback(async () => {
    if (categoryEditor.isDirty) {
      const confirmed = await confirm({
        title: t("confirm.discardCategory.title"),
        description: t("confirm.discardCategory.description"),
        confirmLabel: t("common:action.discard"),
        cancelLabel: t("common:action.cancel"),
        intent: "danger",
      });
      if (!confirmed) return false;
    }
    categoryEditor.resetCategoryDrafts();
    setShowEditorPane(false);
    return true;
  }, [categoryEditor, confirm, t]);

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

  const handleBackToList = useCallback(async () => {
    if (isEditorPaneVisible) {
      const closed = editorTab === "categories"
        ? await handleCloseCategoryEditorWithoutSave()
        : await handleExitArticleEditor();
      if (!closed) return false;
    }
    setWikiSelection({ kind: "none" });
    return true;
  }, [editorTab, handleCloseCategoryEditorWithoutSave, handleExitArticleEditor, isEditorPaneVisible, setWikiSelection]);

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
    sortOrder,
    setSortOrder,
    archivedMode,
    setArchivedMode,
    selectedCategoryId,
    setSelectedCategoryId,

    // queries
    categoriesQuery,
    articlesQuery,
    pinnedQuery,
    detailQuery,

    // derived data
    categories,
    categoryOptions,
    articles,
    pinnedArticles: pinnedQuery.data?.data.slice(0, 3) ?? [],
    articlesHasMore,
    articlesLoadingMore: articlesQuery.isFetchingNextPage,
    loadMoreArticles: () => { if (!articlesQuery.isPlaceholderData) void articlesQuery.fetchNextPage(); },
    selectedArticle,
    selectedSlug,
    selectedCategory,
    canManageContent,
    canViewNonPublicContent,
    canCreateArticle,
    canEditArticle,
    canArchiveArticle,
    canDeleteArticle,
    canManageCategories,
    isCreateRoute,

    // revision history
    isHistoryOpen,
    openHistory: () => setShowHistory(true),
    closeHistory: () => setShowHistory(false),

    // sub-editors
    articleEditor,
    categoryEditor,

    // handlers
    handleSelectArticle,
    handleStartCreateArticle,
    handleOpenArticleEditor,
    handleOpenCategoryEditor,
    handleExitArticleEditor,
    handleCloseCategoryEditorWithoutSave,
    handleDeleteCategory,
    handleBackToList,
  };
}
