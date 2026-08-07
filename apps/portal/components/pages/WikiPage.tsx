import {
  ActionIcon,
  Button,
  Card,
  Drawer,
  Group,
  MultiSelect,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { buildTipTapEditorLabels } from "@portal/components/shared/tiptap-meta";
import { ArrowLeftIcon, ClockIcon, PencilIcon, PinIcon, SearchIcon } from "@portal/components/icons";
import { Suspense, lazy, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useWikiPageController } from "../../hooks/useWikiPageController";
import { WikiArticleListCard } from "../feature/wiki/WikiArticleListCard";
import { WikiCategoryEditorCard } from "../feature/wiki/WikiCategoryEditorCard";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import { format } from "date-fns";
import "./WikiPage.css";

const LazyWikiArticleEditorCard = lazy(() =>
  import("../feature/wiki/WikiArticleEditorCard").then((m) => ({ default: m.WikiArticleEditorCard })),
);
const LazyTipTapEditor = lazy(() =>
  import("@portal/components/shared/TipTapEditor").then((m) => ({ default: m.TipTapEditor })),
);
const LazyWikiHistoryModal = lazy(() =>
  import("../feature/wiki/WikiHistoryModal").then((m) => ({ default: m.WikiHistoryModal })),
);

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
  const confirm = useConfirmDialog();

  const controller = useWikiPageController();
  const hasActiveFilters = Boolean(
    controller.search.trim()
    || controller.pinnedOnly
    || controller.archivedMode !== "active"
    || controller.selectedCategoryIds.length > 0
    || controller.sortOrder !== "curated",
  );
  const activeFilterCount = [
    controller.search.trim().length > 0,
    controller.selectedCategoryIds.length > 0,
    controller.archivedMode !== "active",
    controller.pinnedOnly,
    controller.sortOrder !== "curated",
  ].filter(Boolean).length;
  const resetFilters = () => {
    controller.setSearch("");
    controller.setPinnedOnly(false);
    controller.setArchivedMode("active");
    controller.handleCategoryFilterChange([]);
    controller.setSortOrder("curated");
  };
  const closeMobilePane = async () => {
    if (controller.isEditorPaneVisible) {
      const closed = controller.editorTab === "categories"
        ? await controller.handleCloseCategoryEditorWithoutSave()
        : await controller.handleExitArticleEditor();
      if (!closed) return;
    }
    controller.setMobilePane("list");
  };
  const mobileDrawerTitle = controller.isEditorPaneVisible
    ? controller.editorTab === "categories"
      ? t("categoryEditor.title")
      : t("articleEditor.title")
    : t("drawer.readerTitle", {
        category: controller.selectedCategory?.name
          ?? t("articleEditor.categoryFallback"),
      });

  const handleDeleteArticle = async () => {
    if (!controller.selectedArticle) return;
    const accepted = await confirm({
      title: t("confirm.deleteArticle.title"),
      description: <Text size="sm">{t("confirm.deleteArticle.description", { title: controller.selectedArticle.title })}</Text>,
      cancelLabel: t("common:action.cancel"),
      confirmLabel: t("common:action.delete"),
      intent: "danger",
    });
    if (!accepted || !controller.selectedArticle) return;
    controller.articleEditor.deleteArticle(controller.selectedArticle.id);
  };

  useLoadWarningToast(
    controller.categoriesQuery.isError || controller.articlesQuery.isError || controller.detailQuery.isError,
    t("common:loadErrorRetry"),
  );

  const renderEditorPane = (mobileMode: boolean) => (
    <Stack
      className={`wiki-page-column ${mobileMode ? "wiki-page-column--mobile" : ""}`}
      style={{ width: "100%", alignItems: "stretch" }}
      gap={12}
    >
      {mobileMode ? (
        <Button
          variant="subtle"
          size="sm"
          leftSection={<ArrowLeftIcon size={16} />}
          onClick={() => {
            void closeMobilePane();
          }}
          style={{ alignSelf: "flex-start" }}
        >
          {t("backToList")}
        </Button>
      ) : null}
      {controller.editorTab === "categories" ? (
        <WikiCategoryEditorCard
          canEdit={controller.canEdit}
          categoryDrafts={controller.categoryEditor.categoryDrafts}
          isCreating={controller.categoryEditor.isCreating}
          isSavingDrafts={controller.categoryEditor.isSavingDrafts}
          canSaveDrafts={controller.categoryEditor.canSaveDrafts}
          deletingCategoryId={controller.categoryEditor.deletingCategoryId}
          onCreateCategory={controller.categoryEditor.createCategory}
          onSaveDrafts={controller.categoryEditor.saveCategoryDrafts}
          onCloseEditor={controller.handleCloseCategoryEditorWithoutSave}
          onCategoryDraftNameChange={controller.categoryEditor.setCategoryDraftName}
          onCategoryMove={controller.categoryEditor.moveCategory}
          onDeleteCategory={controller.handleDeleteCategory}
        />
      ) : (
        <Suspense fallback={<Card><Stack gap={8} p="md"><Skeleton height={200} radius={8} /></Stack></Card>}>
          <LazyWikiArticleEditorCard
            canEdit={controller.canEdit}
            isCreatingArticle={controller.articleEditor.isCreatingArticle}
            selectedArticle={controller.selectedArticle}
            selectedCategory={controller.selectedCategory}
            isLoading={controller.detailQuery.isLoading}
            isError={controller.detailQuery.isError}
            warningMessage={t("common:loadError")}
            articleTitle={controller.articleEditor.articleTitle}
            articleBody={controller.articleEditor.articleBody}
            articleCategoryId={controller.articleEditor.articleCategoryId}
            categoryOptions={controller.categoryOptions}
            pinnedIntent={controller.articleEditor.pinnedIntent}
            archiveIntent={controller.articleEditor.archiveIntent}
            isSaving={controller.articleEditor.isSaving}
            isCreating={controller.articleEditor.isCreating}
            isDeleting={controller.articleEditor.isDeleting}
            canCreateArticle={controller.articleEditor.canCreateArticle}
            onArticleTitleChange={controller.articleEditor.setArticleTitle}
            onArticleBodyChange={controller.articleEditor.setArticleBody}
            onArticleCategoryChange={controller.articleEditor.setArticleCategoryId}
            onSaveArticle={controller.articleEditor.saveSelectedArticle}
            onTogglePinnedIntent={controller.articleEditor.togglePinnedIntent}
            onToggleArchiveIntent={controller.articleEditor.toggleArchiveIntent}
            onCreateArticle={controller.articleEditor.createArticle}
            onExitEditor={controller.handleExitArticleEditor}
            onImageUpload={controller.articleEditor.uploadWikiArticleImage}
            onDeleteArticle={handleDeleteArticle}
            emptyTitle={t("empty")}
          />
        </Suspense>
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
        <Button
          variant="subtle"
          size="sm"
          leftSection={<ArrowLeftIcon size={16} />}
          onClick={() => {
            void closeMobilePane();
          }}
          style={{ alignSelf: "flex-start" }}
        >
          {t("backToList")}
        </Button>
      ) : null}
      {/* 正文卡整块内滚：标题、面包屑、正文是一篇东西，一起滚才对，不像编辑器那样钉卡头。 */}
      <Paper withBorder className="wiki-article-reader-card" p="lg">
          <Stack gap={12} className="wiki-card-scroll">
            {(controller.detailQuery.isLoading || (controller.detailQuery.isFetching && !controller.detailQuery.data)) && controller.selectedSlug ? (
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
            ) : !controller.selectedArticle ? (
              <EmptyState title={t("welcome.title")} description={t("welcome.description")} />
            ) : (
              <div className="wiki-article-reader-content">
                <Group justify="space-between" align="start">
                  <Text component="h2" fw={700} size="lg" className="wiki-article-reader-title">
                    {controller.selectedArticle.title}
                  </Text>
                  {controller.canEdit ? (
                    <Group gap={6}>
                      <Tooltip label={t("history.button")} withArrow>
                        <ActionIcon variant="default" size="lg" onClick={controller.openHistory} aria-label={t("history.button")}>
                          <ClockIcon size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t("editor.editWiki")} withArrow>
                        <ActionIcon variant="default" size="lg" onClick={controller.handleOpenArticleEditor} aria-label={t("editor.editWiki")}>
                          <PencilIcon size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  ) : null}
                </Group>
                <nav className="wiki-article-breadcrumb" aria-label={t("aria.breadcrumb")}>
                  <Group gap={6}>
                    <Text component="span" size="sm">{t("title")}</Text>
                    <Text component="span" size="sm" c="dimmed">
                      /
                    </Text>
                    <Text component="span" size="sm">
                      {controller.selectedCategory?.name ?? t("articleEditor.categoryFallback")}
                    </Text>
                  </Group>
                </nav>
                <Suspense fallback={<Card><Stack gap={8} p="md"><Skeleton height={200} radius={8} /></Stack></Card>}>
                  <LazyTipTapEditor
                    value={controller.selectedArticle.body_json}
                    onChange={() => {
                      // Read-only pane intentionally ignores editor updates.
                    }}
                    editable={false}
                    labels={editorLabels}
                  />
                </Suspense>
                <Text c="dimmed" size="sm">
                  {t("articleEditor.lastUpdatedBy", { user: controller.selectedArticle.updated_by_username ?? controller.selectedArticle.created_by.slice(0, 8), date: formatDateTime(controller.selectedArticle.updated_at) })}
                </Text>
                {controller.selectedArticle.archived_at ? (
                  <Text c="gray" size="sm">
                    {t("articleEditor.archivedAt", { date: formatDateTime(controller.selectedArticle.archived_at) })}
                  </Text>
                ) : null}
              </div>
            )}
          </Stack>
      </Paper>
    </Stack>
  );

  const statusOptions = [
    { value: "active", label: t("filter.status.active") },
    { value: "archived", label: t("filter.status.archived") },
    { value: "all", label: t("filter.status.all") },
  ];
  const sortOptions = [
    { value: "curated", label: t("filter.sort.curated") },
    { value: "updated_desc", label: t("filter.sort.updated_desc") },
    { value: "updated_asc", label: t("filter.sort.updated_asc") },
  ];
  const selectedCategoryNames = controller.selectedCategoryIds.map(
    (id) => controller.categoryOptions.find((option) => option.value === id)?.label ?? id,
  );
  const filterSummary = [
    controller.search.trim()
      ? t("filter.summary.search", { value: controller.search.trim() })
      : null,
    selectedCategoryNames.length > 0
      ? t("filter.summary.categories", { value: selectedCategoryNames.join(", ") })
      : null,
    controller.archivedMode !== "active"
      ? t("filter.summary.status", {
          value: statusOptions.find((option) => option.value === controller.archivedMode)?.label
            ?? controller.archivedMode,
        })
      : null,
    controller.pinnedOnly ? t("filter.summary.pinned") : null,
    controller.sortOrder !== "curated"
      ? t("filter.summary.sort", {
          value: sortOptions.find((option) => option.value === controller.sortOrder)?.label
            ?? controller.sortOrder,
        })
      : null,
  ].filter(Boolean).join(" · ");
  const filterToolbar = (
    <ContentFilterToolbar
      className="wiki-page-toolbar"
      toggleLabel={t("common:filter.toggle")}
      activeSummary={filterSummary}
      activeFilterCount={activeFilterCount}
      collapseBelow={1120}
      search={(
        <TextInput
          placeholder={t("filter.search")}
          aria-label={t("filter.searchAria")}
          value={controller.search}
          onChange={(event) => controller.setSearch(event.currentTarget.value)}
          leftSection={<SearchIcon size={16} />}
        />
      )}
      controls={(
        <>
          <MultiSelect
            className="wiki-page-toolbar__categories"
            clearable
            searchable
            placeholder={t("filter.allCategories")}
            aria-label={t("filter.categories")}
            value={controller.selectedCategoryIds}
            onChange={controller.handleCategoryFilterChange}
            data={controller.categoryOptions}
          />
          <Select
            value={controller.archivedMode}
            onChange={(value) => {
              if (value) controller.setArchivedMode(value as "active" | "archived" | "all");
            }}
            data={statusOptions}
            aria-label={t("filter.status")}
            allowDeselect={false}
          />
          <Select
            value={controller.sortOrder}
            onChange={(value) => {
              if (value) controller.setSortOrder(value as "curated" | "updated_desc" | "updated_asc");
            }}
            data={sortOptions}
            aria-label={t("filter.sort")}
            allowDeselect={false}
          />
          <Tooltip label={controller.pinnedOnly ? t("filter.showAll") : t("filter.showPinned")} withArrow>
            <ActionIcon
              variant={controller.pinnedOnly ? "light" : "default"}
              color="portal-brand"
              size="lg"
              aria-pressed={controller.pinnedOnly}
              aria-label={controller.pinnedOnly ? t("filter.showAll") : t("filter.showPinned")}
              onClick={() => controller.setPinnedOnly((value) => !value)}
            >
              <PinIcon size={16} />
            </ActionIcon>
          </Tooltip>
        </>
      )}
    />
  );

  return (
    <PageLayout>
      <PageLayout.Section>
        {filterToolbar}
      </PageLayout.Section>

      <div className={`wiki-page-grid ${controller.isMobile ? "wiki-page-grid--mobile" : ""}`}>
        {!controller.isMobile || controller.mobilePane === "list" ? (
          <Stack
            className={`wiki-page-column ${controller.isMobile ? "wiki-page-column--mobile" : ""}`}
            style={{ width: "100%", alignItems: "stretch" }}
            gap={12}
          >
            <WikiArticleListCard
              title={t("articles.title")}
              canCreateArticle={controller.canCreateArticle}
              canManageCategories={controller.canManageCategories}
              createLabel={t("articleEditor.create")}
              onCreateArticle={controller.handleStartCreateArticle}
              onOpenCategoryEditor={controller.handleOpenCategoryEditor}
              categoryOptions={controller.categoryOptions}
              hasActiveFilters={hasActiveFilters}
              resetFiltersLabel={t("action.resetFilters")}
              onResetFilters={resetFilters}
              isLoading={controller.articlesQuery.isLoading}
              isError={controller.articlesQuery.isError}
              warningMessage={t("common:loadError")}
              articles={controller.articles}
              selectedSlug={controller.selectedSlug}
              emptyTitle={t("empty")}
              onSelectArticle={controller.handleSelectArticle}
              hasMore={controller.articlesHasMore}
              isLoadingMore={controller.articlesLoadingMore}
              onLoadMore={controller.loadMoreArticles}
            />
          </Stack>
        ) : null}

        {!controller.isMobile ? (
          controller.isEditorPaneVisible ? renderEditorPane(false) : renderReaderPane(false)
        ) : (
          <Drawer
            position="right"
            size="100%"
            title={mobileDrawerTitle}
            opened={controller.mobilePane === "article"}
            onClose={() => {
              void closeMobilePane();
            }}
            keepMounted={false}
          >
            {controller.isEditorPaneVisible ? renderEditorPane(true) : renderReaderPane(true)}
          </Drawer>
        )}
      </div>

      {controller.isHistoryOpen && controller.selectedArticle ? (
        <Suspense fallback={null}>
          <LazyWikiHistoryModal
            opened={controller.isHistoryOpen}
            onClose={controller.closeHistory}
            article={controller.selectedArticle}
          />
        </Suspense>
      ) : null}
    </PageLayout>
  );
}
