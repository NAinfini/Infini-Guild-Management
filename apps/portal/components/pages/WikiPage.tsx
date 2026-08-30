import {
  ArchiveIcon,
  ArrowLeftIcon,
  ClockIcon,
  PencilIcon,
  PinIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "@portal/components/icons";
import {
  ContentFilterGroup,
  ContentFilterOption,
  ContentFilterToolbar,
} from "@portal/components/shared/ContentFilterToolbar";
import { ContentPreviewCard } from "@portal/components/shared/ContentPreviewCard";
import { ContentDetailHeader } from "@portal/components/shared/ContentDetailHeader";
import { buildTipTapEditorLabels } from "@portal/components/shared/tiptap-meta";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@portal/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { isApiRequestError } from "@portal/services/WikiService";
import { formatDateTimeWithTimeZone } from "@portal/utils/datetime";
import { resolveMediaUrl } from "@portal/utils/media";
import { lazy, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useWikiPageController } from "../../hooks/useWikiPageController";
import { WikiArticleListCard } from "../feature/wiki/WikiArticleListCard";
import { WikiCategoryEditorCard } from "../feature/wiki/WikiCategoryEditorCard";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import "./WikiPage.css";

const LazyWikiArticleEditorCard = lazy(() =>
  import("../feature/wiki/WikiArticleEditorCard").then((module) => ({ default: module.WikiArticleEditorCard })),
);
const LazyTipTapEditor = lazy(() =>
  import("@portal/components/shared/TipTapEditor").then((module) => ({ default: module.TipTapEditor })),
);
const LazyWikiHistoryModal = lazy(() =>
  import("../feature/wiki/WikiHistoryModal").then((module) => ({ default: module.WikiHistoryModal })),
);

export function WikiPage() {
  const { t } = useTranslation("wiki");
  const { t: te } = useTranslation("editor");
  const editorLabels = useMemo(() => buildTipTapEditorLabels(te), [te]);
  const confirm = useConfirmDialog();
  const controller = useWikiPageController();

  useLoadWarningToast(
    controller.categoriesQuery.isError || controller.articlesQuery.isError || controller.detailQuery.isError,
    t("common:loadErrorRetry"),
  );

  const hasActiveFilters = Boolean(
    controller.search.trim()
    || controller.archivedMode !== "active"
    || Boolean(controller.selectedCategoryId)
    || controller.sortOrder !== "curated",
  );
  const showPinnedSection = !hasActiveFilters && controller.pinnedArticles.length > 0;
  const pinnedArticleSlugs = new Set(controller.pinnedArticles.map(({ slug }) => slug));
  const catalogArticles = showPinnedSection
    ? controller.articles.filter(({ slug }) => !pinnedArticleSlugs.has(slug))
    : controller.articles;
  const resetToolbarFilters = () => {
    controller.setArchivedMode("active");
    controller.setSortOrder("curated");
  };
  const resetFilters = () => {
    controller.setSearch("");
    resetToolbarFilters();
    controller.setSelectedCategoryId(undefined);
  };

  const handleDeleteArticle = async () => {
    if (!controller.canDeleteArticle || !controller.selectedArticle) return;
    const accepted = await confirm({
      title: t("confirm.deleteArticle.title"),
      description: t("confirm.deleteArticle.description", { title: controller.selectedArticle.title }),
      cancelLabel: t("common:action.cancel"),
      confirmLabel: t("common:action.delete"),
      intent: "danger",
    });
    if (accepted && controller.selectedArticle) {
      controller.articleEditor.deleteArticle();
    }
  };

  const handleArchiveArticle = async () => {
    if (!controller.canArchiveArticle || !controller.selectedArticle || controller.selectedArticle.archived_at) return;
    const accepted = await confirm({
      title: t("confirm.archiveArticle.title"),
      description: t("confirm.archiveArticle.description", { title: controller.selectedArticle.title }),
      cancelLabel: t("common:action.cancel"),
      confirmLabel: t("articleEditor.archive"),
      intent: "danger",
    });
    if (accepted) controller.articleEditor.archiveArticle();
  };

  const backButton = (
    <Button type="button" variant="outline" size="sm" className="wiki-back-button" onClick={() => { void controller.handleBackToList(); }}>
      <ArrowLeftIcon size={16} aria-hidden="true" />
      {t("backToList")}
    </Button>
  );

  if (controller.isEditorPaneVisible && controller.editorTab === "categories") {
    return (
      <PageLayout workspaceMode="scroll">
        <div className="wiki-detail-page">
          <WikiCategoryEditorCard
            navigation={backButton}
            canEdit={controller.canManageCategories}
            categoryDrafts={controller.categoryEditor.categoryDrafts}
            isCreating={controller.categoryEditor.isCreating}
            isSavingDrafts={controller.categoryEditor.isSavingDrafts}
            canSaveDrafts={controller.categoryEditor.canSaveDrafts}
            canRunDirectCommands={controller.categoryEditor.canRunDirectCommands}
            deletingCategoryId={controller.categoryEditor.deletingCategoryId}
            onCreateCategory={controller.categoryEditor.createCategory}
            onSaveDrafts={controller.categoryEditor.saveCategoryDrafts}
            onCloseEditor={controller.handleCloseCategoryEditorWithoutSave}
            onCategoryDraftNameChange={controller.categoryEditor.setCategoryDraftName}
            onCategoryMove={controller.categoryEditor.moveCategory}
            onDeleteCategory={controller.handleDeleteCategory}
          />
        </div>
      </PageLayout>
    );
  }

  const isArticlePage = Boolean(controller.selectedSlug) || controller.isCreateRoute || controller.articleEditor.isCreatingArticle;
  if (isArticlePage) {
    const detailMissing = Boolean(
      controller.selectedSlug
        && isApiRequestError(controller.detailQuery.error)
        && controller.detailQuery.error.status === 404,
    );
    const detailUnavailable = Boolean(
      controller.selectedSlug
        && (detailMissing || (!controller.selectedArticle && (controller.detailQuery.isError || !controller.detailQuery.isLoading))),
    );
    const detailRefreshError = Boolean(
      controller.selectedSlug
        && controller.detailQuery.isError
        && controller.selectedArticle
        && !detailMissing,
    );
    const articleEditorName = controller.selectedArticle
      ? controller.selectedArticle.updated_by_display_name ?? t("meta.editorFallback")
      : "";

    if (detailUnavailable) {
      return (
        <PageLayout workspaceMode="scroll">
          <div className="wiki-detail-page">
            <EmptyState
              status="error"
              title={detailMissing ? t("common:notFound.title") : t("common:loadError")}
              description={detailMissing ? t("common:notFound.description") : t("common:errors.connectionIssue")}
              actions={detailMissing ? (
                <Button type="button" onClick={() => { void controller.handleBackToList(); }}>
                  <ArrowLeftIcon size={16} aria-hidden="true" />
                  {t("backToList")}
                </Button>
              ) : (
                <Button type="button" loading={controller.detailQuery.isFetching} onClick={() => { void controller.detailQuery.refetch(); }}>
                  {t("common:action.retry")}
                </Button>
              )}
            />
          </div>
        </PageLayout>
      );
    }

    return (
      <PageLayout workspaceMode="scroll">
        <div className="wiki-detail-page">
          {detailRefreshError ? (
            <Alert variant="destructive">
              <AlertTitle>{t("common:loadError")}</AlertTitle>
              <AlertDescription>
                <Button type="button" size="sm" variant="outline" loading={controller.detailQuery.isFetching} onClick={() => { void controller.detailQuery.refetch(); }}>
                  {t("common:action.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {controller.isEditorPaneVisible ? (
            <Suspense fallback={<Skeleton className="wiki-detail-skeleton" />}>
              <LazyWikiArticleEditorCard
                navigation={backButton}
                canCreate={controller.canCreateArticle}
                canEdit={controller.canEditArticle}
                canArchive={controller.canArchiveArticle}
                canDelete={controller.canDeleteArticle}
                isCreatingArticle={controller.articleEditor.isCreatingArticle}
                selectedArticle={controller.articleEditor.editorArticle}
                selectedCategory={controller.selectedCategory}
                isLoading={controller.detailQuery.isLoading}
                articleTitle={controller.articleEditor.articleTitle}
                articleBody={controller.articleEditor.articleBody}
                articleCategoryId={controller.articleEditor.articleCategoryId}
                categoryOptions={controller.categoryOptions}
                pinnedIntent={controller.articleEditor.pinnedIntent}
                archiveIntent={controller.articleEditor.archiveIntent}
                isSaving={controller.articleEditor.isSaving}
                isCreating={controller.articleEditor.isCreating}
                isDeleting={controller.articleEditor.isDeleting}
                isArchiving={controller.articleEditor.isArchiving}
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
          ) : (
            <Card className="wiki-detail-reader">
              {controller.detailQuery.isLoading ? <Skeleton className="wiki-detail-skeleton" /> : null}
              {!controller.detailQuery.isLoading && !controller.selectedArticle ? (
                <EmptyState title={t("welcome.title")} description={t("welcome.description")} />
              ) : null}
              {controller.selectedArticle ? (
                <article>
                  <div className="wiki-detail-reader__body">
                    <ContentDetailHeader
                      domain="wiki"
                      navigation={backButton}
                      category={controller.selectedCategory?.name ?? t("articleEditor.categoryFallback")}
                      states={(
                        <>
                          {controller.selectedArticle.pinned ? (
                            <Badge variant="outline" className="content-detail-header__state">
                              <PinIcon size={13} aria-hidden="true" />
                              {t("articleEditor.pinned")}
                            </Badge>
                          ) : null}
                          {controller.selectedArticle.archived_at ? (
                            <Badge variant="outline" className="content-detail-header__state">
                              <ArchiveIcon size={13} aria-hidden="true" />
                              {t("articleEditor.archived")}
                            </Badge>
                          ) : null}
                        </>
                      )}
                      title={controller.selectedArticle.title}
                      titleClassName="wiki-detail-title"
                      authorLabel={t("meta.lastEditor")}
                      authorName={articleEditorName}
                      authorAvatarClassName="wiki-detail-author-avatar"
                      timestampLabel={t("meta.updatedLabel")}
                      timestamp={formatDateTimeWithTimeZone(controller.selectedArticle.updated_at)}
                      timestampDateTime={controller.selectedArticle.updated_at}
                      viewsLabel={t("meta.viewsLabel")}
                      viewCount={controller.selectedArticle.view_count}
                      actions={controller.canEditArticle || controller.canArchiveArticle || controller.canDeleteArticle ? (
                        <div className="wiki-detail-actions">
                          {controller.canEditArticle ? (
                            <>
                              <Button type="button" variant="outline" size="sm" onClick={controller.openHistory}>
                                <ClockIcon size={15} aria-hidden="true" /> {t("history.button")}
                              </Button>
                              <Button type="button" size="sm" onClick={controller.handleOpenArticleEditor}>
                                <PencilIcon size={15} aria-hidden="true" /> {t("editor.editWiki")}
                              </Button>
                            </>
                          ) : null}
                          {controller.canArchiveArticle && !controller.selectedArticle.archived_at ? (
                            <Button type="button" variant="outline" size="sm" loading={controller.articleEditor.isArchiving} onClick={() => { void handleArchiveArticle(); }}>
                              <ArchiveIcon size={15} aria-hidden="true" /> {t("articleEditor.archive")}
                            </Button>
                          ) : null}
                          {controller.canDeleteArticle ? (
                            <Button type="button" variant="destructive" size="sm" loading={controller.articleEditor.isDeleting} onClick={() => { void handleDeleteArticle(); }}>
                              <TrashIcon size={15} aria-hidden="true" /> {t("common:action.delete")}
                            </Button>
                          ) : null}
                        </div>
                      ) : undefined}
                    />
                    <Suspense fallback={<Skeleton className="wiki-detail-skeleton" />}>
                      <LazyTipTapEditor
                        value={controller.selectedArticle.body_json}
                        onChange={() => {}}
                        editable={false}
                        labels={editorLabels}
                      />
                    </Suspense>
                  </div>
                </article>
              ) : null}
            </Card>
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

  const filterToolbar = (
    <ContentFilterToolbar
      className="wiki-page-toolbar"
      filterLabel={t("common:filter.toggle")}
      activeFilterCount={[
        controller.canViewNonPublicContent && controller.archivedMode !== "active",
        controller.sortOrder !== "curated",
      ].filter(Boolean).length}
      resetLabel={t("common:filter.reset")}
      onReset={resetToolbarFilters}
      search={(
        <InputGroup className="wiki-page-toolbar__search">
          <InputGroupAddon><SearchIcon size={16} aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput
            placeholder={t("filter.search")}
            aria-label={t("filter.searchAria")}
            value={controller.search}
            onChange={(event) => controller.setSearch(event.currentTarget.value)}
          />
          {controller.search ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={t("common:action.clear")}
                onClick={() => controller.setSearch("")}
                size="icon-xs"
              >
                <XIcon size={14} aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      )}
      filterControls={(
        <>
          {controller.canViewNonPublicContent ? (
            <ContentFilterGroup label={t("filter.status")}>
              <RadioGroup
                value={controller.archivedMode}
                onValueChange={(value) => controller.setArchivedMode(value as "active" | "archived" | "all")}
                aria-label={t("filter.status")}
                className="content-filter-toolbar__option-list content-filter-toolbar__option-list--columns"
              >
                {(["active", "archived", "all"] as const).map((value) => (
                  <ContentFilterOption key={value}>
                    <RadioGroupItem value={value} />
                    <span>{t(`filter.status.${value}`)}</span>
                  </ContentFilterOption>
                ))}
              </RadioGroup>
            </ContentFilterGroup>
          ) : null}
          <ContentFilterGroup label={t("filter.sort")}>
            <RadioGroup
              value={controller.sortOrder}
              onValueChange={(value) => controller.setSortOrder(value as typeof controller.sortOrder)}
              aria-label={t("filter.sort")}
              className="content-filter-toolbar__option-list content-filter-toolbar__option-list--columns"
            >
              {(["curated", "updated_desc", "updated_asc"] as const).map((value) => (
                <ContentFilterOption key={value}>
                  <RadioGroupItem value={value} />
                  <span>{t(`filter.sort.${value}`)}</span>
                </ContentFilterOption>
              ))}
            </RadioGroup>
          </ContentFilterGroup>
        </>
      )}
    />
  );

  return (
    <PageLayout toolbar={filterToolbar} workspaceMode="scroll">
      <div className="wiki-catalog-page">
        {showPinnedSection ? (
          <Card className="content-pinned-section" role="region" aria-labelledby="wiki-pinned-title">
            <header className="content-pinned-section__header">
              <p>{t("pinned.eyebrow")}</p>
              <h2 id="wiki-pinned-title">{t("pinned.title")}</h2>
            </header>
            <div className="content-pinned-grid" data-count={controller.pinnedArticles.length}>
              {controller.pinnedArticles.map((item) => (
                <ContentPreviewCard
                  key={item.slug}
                  compact
                  domain="wiki"
                  title={item.title}
                  excerpt={item.excerpt}
                  category={controller.categories.find((category) => category.id === item.category_id)?.name ?? t("articleEditor.categoryFallback")}
                  author={item.updated_by_display_name ?? item.created_by.slice(0, 8)}
                  timestamp={formatDateTimeWithTimeZone(item.updated_at)}
                  viewLabel={t("meta.views", { count: item.view_count })}
                  imageUrl={item.preview_media_id ? resolveMediaUrl(item.preview_media_id) : null}
                  pinned
                  pinnedLabel={t("articleEditor.pinned")}
                  ariaLabel={t("aria.openArticle", { title: item.title })}
                  onOpen={() => controller.handleSelectArticle(item.slug)}
                />
              ))}
            </div>
          </Card>
        ) : null}

        <div className="content-catalog-layout">
          <Card className="content-category-rail">
            <p className="content-category-rail__eyebrow">{t("categoryRail.eyebrow")}</p>
            <h2 className="content-category-rail__title">{t("categoryRail.title")}</h2>
            <div className="content-category-rail__options">
              <button
                type="button"
                className={!controller.selectedCategoryId ? "is-active" : undefined}
                aria-pressed={!controller.selectedCategoryId}
                onClick={() => controller.setSelectedCategoryId(undefined)}
              >
                {t("filter.allCategories")}
              </button>
              {controller.categoryOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={controller.selectedCategoryId === option.value ? "is-active" : undefined}
                  aria-pressed={controller.selectedCategoryId === option.value}
                  onClick={() => controller.setSelectedCategoryId(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Card>

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
            onRetry={() => { void controller.articlesQuery.refetch(); }}
            retryPending={controller.articlesQuery.isFetching}
            articles={catalogArticles}
            selectedSlug={null}
            emptyTitle={t("empty")}
            onSelectArticle={controller.handleSelectArticle}
            hasMore={controller.articlesHasMore}
            isLoadingMore={controller.articlesLoadingMore}
            onLoadMore={controller.loadMoreArticles}
          />
        </div>
      </div>
    </PageLayout>
  );
}
