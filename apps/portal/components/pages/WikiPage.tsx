import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Checkbox } from "@portal/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@portal/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@portal/components/ui/sheet";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Switch } from "@portal/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@portal/components/ui/tooltip";
import { ContentFilterGroup, ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { buildTipTapEditorLabels } from "@portal/components/shared/tiptap-meta";
import {
  ArrowLeftIcon,
  ClockIcon,
  PencilIcon,
  SearchIcon,
  XIcon,
} from "@portal/components/icons";
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import { Suspense, lazy, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useWikiPageController } from "../../hooks/useWikiPageController";
import { WikiArticleListCard } from "../feature/wiki/WikiArticleListCard";
import { WikiCategoryEditorCard } from "../feature/wiki/WikiCategoryEditorCard";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
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
      description: (
        <p className="wiki-confirmation-copy">
          {t("confirm.deleteArticle.description", { title: controller.selectedArticle.title })}
        </p>
      ),
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

  const backToList = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="wiki-back-button"
      onClick={() => {
        void closeMobilePane();
      }}
    >
      <ArrowLeftIcon size={16} aria-hidden="true" />
      {t("backToList")}
    </Button>
  );

  const renderEditorPane = (mobileMode: boolean) => (
    <div className={`wiki-page-column ${mobileMode ? "wiki-page-column--mobile" : ""}`}>
      {mobileMode ? backToList : null}
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
        <Suspense fallback={<div className="wiki-pane-loading"><Skeleton /></div>}>
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
    </div>
  );

  const renderReaderPane = (mobileMode: boolean) => (
    <div className={`wiki-page-column ${mobileMode ? "wiki-page-column--mobile" : ""}`}>
      {mobileMode ? backToList : null}
      <Card className="wiki-article-reader-card">
        <div className="wiki-card-scroll wiki-article-reader-scroll">
          {(controller.detailQuery.isLoading || (controller.detailQuery.isFetching && !controller.detailQuery.data)) && controller.selectedSlug ? (
            <div className="wiki-reader-loading" aria-busy="true">
              <Skeleton className="wiki-skeleton-line wiki-skeleton-line--title" />
              <div className="wiki-reader-loading__meta">
                <Skeleton className="wiki-skeleton-line wiki-skeleton-line--tiny" />
                <Skeleton className="wiki-skeleton-line wiki-skeleton-line--short" />
              </div>
              <Skeleton className="wiki-skeleton-line wiki-skeleton-line--short" />
              <Skeleton className="wiki-skeleton-line" />
              <Skeleton className="wiki-skeleton-line" />
              <Skeleton className="wiki-skeleton-line wiki-skeleton-line--wide" />
              <Skeleton className="wiki-skeleton-line" />
              <Skeleton className="wiki-skeleton-line wiki-skeleton-line--medium" />
            </div>
          ) : !controller.selectedArticle ? (
            <EmptyState title={t("welcome.title")} description={t("welcome.description")} />
          ) : (
            <article className="wiki-article-reader-content">
              <header className="wiki-article-reader-header">
                <h2 className="wiki-article-reader-title">
                  {controller.selectedArticle.title}
                </h2>
                {controller.canEdit ? (
                  <div className="wiki-article-reader-actions">
                    <Tooltip>
                      <TooltipTrigger
                        render={(
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-lg"
                            aria-label={t("history.button")}
                            className="wiki-icon-button"
                            onClick={controller.openHistory}
                          />
                        )}
                      >
                        <ClockIcon size={16} aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent>{t("history.button")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={(
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-lg"
                            aria-label={t("editor.editWiki")}
                            className="wiki-icon-button"
                            onClick={controller.handleOpenArticleEditor}
                          />
                        )}
                      >
                        <PencilIcon size={16} aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent>{t("editor.editWiki")}</TooltipContent>
                    </Tooltip>
                  </div>
                ) : null}
              </header>
              <nav className="wiki-article-breadcrumb" aria-label={t("aria.breadcrumb")}>
                <span>{t("title")}</span>
                <span aria-hidden="true" className="wiki-muted-copy">/</span>
                <span>{controller.selectedCategory?.name ?? t("articleEditor.categoryFallback")}</span>
              </nav>
              <Suspense fallback={<div className="wiki-pane-loading"><Skeleton /></div>}>
                <LazyTipTapEditor
                  value={controller.selectedArticle.body_json}
                  onChange={() => {
                    // Read-only pane intentionally ignores editor updates.
                  }}
                  editable={false}
                  labels={editorLabels}
                />
              </Suspense>
              <p className="wiki-muted-copy wiki-article-reader-meta">
                {t("articleEditor.lastUpdatedBy", {
                  user: controller.selectedArticle.updated_by_display_name
                    ?? controller.selectedArticle.created_by.slice(0, 8),
                  date: formatDateTimeWithTimeZone(controller.selectedArticle.updated_at),
                })}
              </p>
              {controller.selectedArticle.archived_at ? (
                <p className="wiki-muted-copy wiki-article-reader-meta">
                  {t("articleEditor.archivedAt", {
                    date: formatDateTimeWithTimeZone(controller.selectedArticle.archived_at),
                  })}
                </p>
              ) : null}
            </article>
          )}
        </div>
      </Card>
    </div>
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

  const filterToolbar = (
    <ContentFilterToolbar
      className="wiki-page-toolbar"
      filterLabel={t("common:filter.toggle")}
      activeFilterCount={activeFilterCount}
      resetLabel={t("common:filter.reset")}
      onReset={resetFilters}
      search={(
        <InputGroup className="wiki-page-toolbar__search">
          <InputGroupAddon>
            <SearchIcon size={16} aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            placeholder={t("filter.search")}
            aria-label={t("filter.searchAria")}
            value={controller.search}
            onChange={(event) => controller.setSearch(event.currentTarget.value)}
          />
        </InputGroup>
      )}
      filterControls={(
        <>
          <ContentFilterGroup label={t("filter.categories")}>
            <div className="wiki-filter-options" role="group" aria-label={t("filter.categories")}>
              {controller.categoryOptions.map((option) => {
                const checked = controller.selectedCategoryIds.includes(option.value);
                return (
                  <label key={option.value} className="wiki-filter-option">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(nextChecked) => {
                        controller.handleCategoryFilterChange(
                          nextChecked
                            ? [...controller.selectedCategoryIds, option.value]
                            : controller.selectedCategoryIds.filter((id) => id !== option.value),
                        );
                      }}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
          </ContentFilterGroup>
          <ContentFilterGroup label={t("filter.status")}>
            <RadioGroup
              value={controller.archivedMode}
              onValueChange={(value) => controller.setArchivedMode(value as "active" | "archived" | "all")}
              aria-label={t("filter.status")}
              className="wiki-filter-options"
            >
              {statusOptions.map((option) => (
                <label key={option.value} className="wiki-filter-option">
                  <RadioGroupItem value={option.value} />
                  <span>{option.label}</span>
                </label>
              ))}
            </RadioGroup>
          </ContentFilterGroup>
          <ContentFilterGroup label={t("filter.sort")}>
            <RadioGroup
              value={controller.sortOrder}
              onValueChange={(value) => controller.setSortOrder(value as "curated" | "updated_desc" | "updated_asc")}
              aria-label={t("filter.sort")}
              className="wiki-filter-options"
            >
              {sortOptions.map((option) => (
                <label key={option.value} className="wiki-filter-option">
                  <RadioGroupItem value={option.value} />
                  <span>{option.label}</span>
                </label>
              ))}
            </RadioGroup>
          </ContentFilterGroup>
          <ContentFilterGroup label={t("filter.options")}>
            <label className="wiki-filter-option">
              <Switch
                checked={controller.pinnedOnly}
                onCheckedChange={controller.setPinnedOnly}
              />
              <span>{t("filter.showPinned")}</span>
            </label>
          </ContentFilterGroup>
        </>
      )}
    />
  );

  return (
    <PageLayout toolbar={filterToolbar} workspaceMode={controller.isMobile ? "scroll" : "contained"}>
      <div className="wiki-page-workspace">
        <div className={`wiki-page-grid ${controller.isMobile ? "wiki-page-grid--mobile" : ""}`}>
          {!controller.isMobile || controller.mobilePane === "list" ? (
            <div className={`wiki-page-column ${controller.isMobile ? "wiki-page-column--mobile" : ""}`}>
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
            </div>
          ) : null}

          {!controller.isMobile ? (
            controller.isEditorPaneVisible ? renderEditorPane(false) : renderReaderPane(false)
          ) : (
            <Sheet
              open={controller.mobilePane === "article"}
              onOpenChange={(open) => {
                if (!open) void closeMobilePane();
              }}
            >
              <SheetContent side="right" showCloseButton={false} className="wiki-mobile-sheet">
                <SheetHeader className="wiki-mobile-sheet__header">
                  <SheetTitle>{mobileDrawerTitle}</SheetTitle>
                  <SheetClose
                    aria-label={t("common:action.close")}
                    render={<Button type="button" variant="ghost" size="icon-lg" className="wiki-mobile-sheet__close" />}
                  >
                    <XIcon size={18} aria-hidden="true" />
                  </SheetClose>
                </SheetHeader>
                <div className="wiki-mobile-sheet__body">
                  {controller.isEditorPaneVisible ? renderEditorPane(true) : renderReaderPane(true)}
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
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
