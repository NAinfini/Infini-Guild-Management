import { type WikiArticle } from "@guild/shared";
import { Button, Drawer, Group, Skeleton, Stack, Text, TextInput, VisuallyHidden } from "@mantine/core";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { DepthToggle } from "@portal/components/shared/DepthToggle";
import { TipTapEditor, buildTipTapEditorLabels } from "@portal/components/shared/TipTapEditor";
import { PortalCard } from "../shared/PortalCard";
import { modals } from "@mantine/modals";
import { IconArchive, IconEdit, IconPinned } from "@tabler/icons-react";
import { useDebouncedValue, useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchWikiArticleBySlug,
  fetchWikiArticles,
  fetchWikiCategories,
} from "../../api/queries/wiki";
import { useBeforeUnloadPrompt } from "../../hooks/useBeforeUnloadPrompt";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useWikiArticleEditor } from "../../hooks/useWikiArticleEditor";
import { useWikiCategoryEditor } from "../../hooks/useWikiCategoryEditor";
import { queryKeys } from "../../api/query-keys";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { WikiArticleEditorCard } from "../feature/wiki/WikiArticleEditorCard";
import { WikiArticleListCard } from "../feature/wiki/WikiArticleListCard";
import { WikiCategoryEditorCard } from "../feature/wiki/WikiCategoryEditorCard";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import "./WikiPage.css";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return format(date, "yyyy-MM-dd HH:mm");
}

export function WikiPage() {
  const { t } = useTranslation("wiki");
  const { t: te } = useTranslation("editor");
  const editorLabels = useMemo(() => buildTipTapEditorLabels(te), [te]);
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const routeSlug = (params as { slug?: string }).slug ?? null;
  const isDesktop = useMediaQuery("(min-width: 1200px)", true);
  const isMobile = !isDesktop;
  const isExternalView = useExternalView();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const isModerator = canManagePermission(["wiki.articles.create", "wiki.articles.edit", "wiki.articles.archive", "wiki.categories.manage"]);
  const canEdit = isModerator && !isExternalView;

  const [search, setSearch] = useState("");
  const [debouncedSearchRaw] = useDebouncedValue(search, 300);
  const debouncedSearch = debouncedSearchRaw.trim();
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(routeSlug);
  const [editorTab, setEditorTab] = useState<"article" | "categories">("article");
  const [mobilePane, setMobilePane] = useState<"list" | "article">("list");
  const [showEditorPane, editorPaneHandlers] = useDisclosure(false);
  const isEditorPaneVisible = canEdit && showEditorPane;

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
    queryKey: queryKeys.wiki.articles(selectedCategoryFilterKey, debouncedSearch, archivedOnly ? "archived" : "active", articlesPage),
    queryFn: () =>
      fetchWikiArticles({
        page: articlesPage,
        limit: 50,
        category_id: singleSelectedCategoryId,
        search: debouncedSearch || undefined,
        archived: archivedOnly,
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
   
  }, [selectedCategoryFilterKey, debouncedSearch, archivedOnly]);

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
      if (pinnedOnly && !item.pinned) {
        return false;
      }
      return true;
    });
  }, [accumulatedArticles, pinnedOnly, selectedCategoryIds]);
  const selectedArticle = detailQuery.data ?? null;
  const articleEditor = useWikiArticleEditor({
    canEdit,
    categories,
    selectedArticle,
    selectedCategoryId,
    selectedCategoryIds,
    onArticleCreated: setSelectedSlug,
  });
  const categoryEditor = useWikiCategoryEditor({ categories });

  useEffect(() => {
    if (routeSlug && routeSlug !== selectedSlug) {
      setSelectedSlug(routeSlug);
    }
  }, [routeSlug, selectedSlug]);

  useEffect(() => {
    if (!selectedSlug && !articleEditor.isCreatingArticle && articles.length > 0 && routeSlug) {
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
  }, [articleEditor.isCreatingArticle, articles, navigate, routeSlug, selectedSlug]);

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
  }, [canEdit]);

  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));
  const selectedCategory = selectedArticle ? categoriesById.get(selectedArticle.category_id) ?? null : null;
  useBeforeUnloadPrompt(isEditorPaneVisible && (articleEditor.isDirty || categoryEditor.isDirty));

  const handleSelectArticle = (slug: string) => {
    setSelectedSlug(slug);
    void navigate({
      to: "/wiki/$slug",
      params: { slug },
      viewTransition: false,
    });
    if (isMobile) {
      setMobilePane("article");
    }
  };

  const handleStartCreateArticle = () => {
    setEditorTab("article");
    editorPaneHandlers.open();
    articleEditor.startCreateArticle();
    setSelectedSlug(null);
    if (routeSlug) {
      void navigate({ to: "/wiki", viewTransition: false });
    }
    if (isMobile) {
      setMobilePane("article");
    }
  };

  const handleOpenArticleEditor = () => {
    setEditorTab("article");
    editorPaneHandlers.open();
    if (isMobile) {
      setMobilePane("article");
    }
  };

  const handleOpenCategoryEditor = () => {
    setEditorTab("categories");
    editorPaneHandlers.open();
    if (isMobile) {
      setMobilePane("article");
    }
  };

  const handleExitArticleEditor = () => {
    if (articleEditor.isDirty) {
      modals.openConfirmModal({
        title: t("confirm.discardArticle.title"),
        children: t("confirm.discardArticle.description"),
        centered: true,
        confirmProps: { color: "red" },
        labels: {
          cancel: t("common:action.cancel"),
          confirm: t("common:action.delete"),
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
  };

  const handleCategoryFilterChange = (values: string[]) => {
    setSelectedCategoryIds(values);
    setSelectedCategoryId(values.length === 1 ? values[0] : undefined);
  };

  const handleCloseCategoryEditorWithoutSave = () => {
    categoryEditor.resetCategoryDrafts();
    editorPaneHandlers.close();
  };

  const handleDeleteCategory = (categoryId: string) => {
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
  };

  const renderEditorPane = (mobileMode: boolean) => (
    <Stack
      className={`wiki-page-column ${mobileMode ? "wiki-page-column--mobile" : ""}`}
      style={{ width: "100%", alignItems: "stretch" }}
      gap={12}
    >
      {mobileMode ? (
        <Button size="xs" onClick={() => setMobilePane("list")} style={{ alignSelf: "flex-start" }}>
          {t("backToList")}
        </Button>
      ) : null}
      {editorTab === "categories" ? (
        <WikiCategoryEditorCard
          canEdit={canEdit}
          categoryName={categoryEditor.categoryName}
          categoryDrafts={categoryEditor.categoryDrafts}
          isCreating={categoryEditor.isCreating}
          isSavingDrafts={categoryEditor.isSavingDrafts}
          canSaveDrafts={categoryEditor.canSaveDrafts}
          deletingCategoryId={categoryEditor.deletingCategoryId}
          onCategoryNameChange={categoryEditor.setCategoryName}
          onCreateCategory={categoryEditor.createCategory}
          onSaveDrafts={categoryEditor.saveCategoryDrafts}
          onCloseEditor={handleCloseCategoryEditorWithoutSave}
          onCategoryDraftNameChange={categoryEditor.setCategoryDraftName}
          onCategoryDraftParentIdChange={categoryEditor.setCategoryDraftParentId}
          onCategoryReorder={categoryEditor.reorderCategories}
          onDeleteCategory={handleDeleteCategory}
        />
      ) : (
        <WikiArticleEditorCard
          canEdit={canEdit}
          isCreatingArticle={articleEditor.isCreatingArticle}
          selectedArticle={selectedArticle}
          selectedCategory={selectedCategory}
          isLoading={detailQuery.isLoading}
          isError={detailQuery.isError}
          warningMessage={t("common:loadError")}
          articleTitle={articleEditor.articleTitle}
          articleBody={articleEditor.articleBody}
          articleCategoryId={articleEditor.articleCategoryId}
          categoryOptions={categoryOptions}
          pinnedIntent={articleEditor.pinnedIntent}
          archiveIntent={articleEditor.archiveIntent}
          isSaving={articleEditor.isSaving}
          isCreating={articleEditor.isCreating}
          canCreateArticle={articleEditor.canCreateArticle}
          onArticleTitleChange={articleEditor.setArticleTitle}
          onArticleBodyChange={articleEditor.setArticleBody}
          onArticleCategoryChange={articleEditor.setArticleCategoryId}
          onSaveArticle={articleEditor.saveSelectedArticle}
          onTogglePinnedIntent={articleEditor.togglePinnedIntent}
          onToggleArchiveIntent={articleEditor.toggleArchiveIntent}
          onCreateArticle={articleEditor.createArticle}
          onExitEditor={handleExitArticleEditor}
          onImageUpload={articleEditor.uploadWikiArticleImage}
          emptyTitle={t("empty")}
        />
      )}
    </Stack>
  );

  const renderReaderPane = (mobileMode: boolean) => (
    <Stack
      className={`wiki-page-column ${mobileMode ? "wiki-page-column--mobile" : ""}`}
      style={{ width: "100%", alignItems: "stretch" }}
      gap={12}
    >
      {mobileMode ? (
        <Button size="xs" onClick={() => setMobilePane("list")} style={{ alignSelf: "flex-start" }}>
          {t("backToList")}
        </Button>
      ) : null}
      <PortalCard className="wiki-article-reader-card" interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Stack gap={12}>
            {(detailQuery.isLoading || (detailQuery.isFetching && !detailQuery.data)) && selectedSlug ? (
              <Stack gap={12} style={{ padding: "1rem 0" }}>
                <Skeleton height={22} width="55%" />
                <Group gap={8}><Skeleton height={12} width="15%" /><Skeleton height={12} width="25%" /></Group>
                <Skeleton height={12} width="35%" />
                <Skeleton height={14} />
                <Skeleton height={14} />
                <Skeleton height={14} width="80%" />
                <Skeleton height={14} />
                <Skeleton height={14} width="60%" />
              </Stack>
            ) : !selectedArticle ? (
              <EmptyState title={t("welcome.title")} description={t("welcome.description")} />
            ) : (
              <>
                <Group justify="space-between" align="start">
                  <Text fw={700} size="lg">
                    {selectedArticle.title}
                  </Text>
                  {canEdit ? (
                    <DepthButton type="secondary" size="sm" onClick={handleOpenArticleEditor} tooltip={{ label: t("editor.editWiki"), withArrow: true }}>
                        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          <IconEdit size={16} />
                        </span>
                        <VisuallyHidden>{t("editor.editWiki")}</VisuallyHidden>
                      </DepthButton>
                  ) : null}
                </Group>
                <Group gap={6}>
                  <Text size="sm">{t("title")}</Text>
                  <Text size="sm" c="dimmed">
                    /
                  </Text>
                  <Text size="sm">{selectedCategory?.name ?? t("articleEditor.categoryFallback")}</Text>
                </Group>
                <Text c="dimmed" size="sm">
                  {t("articleEditor.lastUpdatedBy", { user: selectedArticle.created_by.slice(0, 8), date: formatDateTime(selectedArticle.updated_at) })}
                </Text>
                {selectedArticle.archived_at ? (
                  <Text c="yellow" size="sm">
                    {t("articleEditor.archivedAt", { date: formatDateTime(selectedArticle.archived_at) })}
                  </Text>
                ) : null}
                <TipTapEditor
                  value={selectedArticle.body_json}
                  onChange={() => {
                    // Read-only pane intentionally ignores editor updates.
                  }}
                  editable={false}
                  labels={editorLabels}
                />
              </>
            )}
          </Stack>
        </div>
      </PortalCard>
    </Stack>
  );

  useLoadWarningToast(
    categoriesQuery.isError || articlesQuery.isError || detailQuery.isError,
    t("common:loadErrorRetry"),
  );

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")}>
      <PageLayout.Section>
        <PortalCard interactive={false}>
          <div style={{ padding: "1.2rem" }}>
            <Group gap={8} wrap="wrap">
              <TextInput
                style={{ width: 300 }}
                placeholder={t("filter.search")}
                aria-label={t("filter.searchAria")}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
              <DepthToggle
                  pressed={pinnedOnly}
                  onToggle={() => setPinnedOnly((value) => !value)}
                  type="secondary"
                  size="sm"
                  iconOnly
                  aria-label={pinnedOnly ? t("filter.showAll") : t("filter.showPinned")}
                  tooltip={{ label: pinnedOnly ? t("filter.showAll") : t("filter.showPinned"), withArrow: true }}
                >
                  <IconPinned size={16} />
                </DepthToggle>
              <DepthToggle
                  pressed={archivedOnly}
                  onToggle={() => setArchivedOnly((value) => !value)}
                  type="secondary"
                  size="sm"
                  iconOnly
                  aria-label={archivedOnly ? t("filter.showActive") : t("filter.showArchived")}
                  tooltip={{ label: archivedOnly ? t("filter.showActive") : t("filter.showArchived"), withArrow: true }}
                >
                  <IconArchive size={16} />
                </DepthToggle>
            </Group>
          </div>
        </PortalCard>
      </PageLayout.Section>

      <div className={`wiki-page-grid ${isMobile ? "wiki-page-grid--mobile" : ""}`}>
        {!isMobile || mobilePane === "list" ? (
          <Stack
            className={`wiki-page-column ${isMobile ? "wiki-page-column--mobile" : ""}`}
            style={{ width: "100%", alignItems: "stretch" }}
            gap={12}
          >
            <WikiArticleListCard
              title={t("articles.title")}
              canEdit={canEdit}
              createLabel={t("articleEditor.create")}
              onCreateArticle={handleStartCreateArticle}
              onOpenCategoryEditor={handleOpenCategoryEditor}
              categoryOptions={categoryOptions}
              selectedCategoryIds={selectedCategoryIds}
              onCategoryFilterChange={handleCategoryFilterChange}
              isLoading={articlesQuery.isLoading && articlesPage === 1}
              isError={articlesQuery.isError}
              warningMessage={t("common:loadError")}
              articles={articles}
              selectedSlug={selectedSlug}
              emptyTitle={t("empty")}
              onSelectArticle={handleSelectArticle}
              hasMore={articlesHasMore}
              isLoadingMore={articlesQuery.isFetching && articlesPage > 1}
              onLoadMore={() => setArticlesPage((p) => p + 1)}
            />
          </Stack>
        ) : null}

        {!isMobile ? (
          isEditorPaneVisible ? renderEditorPane(false) : renderReaderPane(false)
        ) : (
          <Drawer
            position="right"
            size="100%"
            title={selectedArticle?.title ?? t("articleEditor.title")}
            opened={mobilePane === "article"}
            onClose={() => setMobilePane("list")}
            keepMounted={false}
          >
            {isEditorPaneVisible ? renderEditorPane(true) : renderReaderPane(true)}
          </Drawer>
        )}
      </div>
    </PageLayout>
  );
}
