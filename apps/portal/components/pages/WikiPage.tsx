import { ActionIcon, Button, Card, Drawer, Group, Paper, SegmentedControl, Skeleton, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { buildTipTapEditorLabels } from "@portal/components/shared/tiptap-meta";
import { ClockIcon, PencilIcon, PinIcon } from "@portal/components/icons";
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
    || controller.selectedCategoryIds.length > 0,
  );
  const resetFilters = () => {
    controller.setSearch("");
    controller.setPinnedOnly(false);
    controller.setArchivedMode("active");
    controller.handleCategoryFilterChange([]);
  };

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
        <Button size="xs" onClick={() => controller.setMobilePane("list")} style={{ alignSelf: "flex-start" }}>
          {t("backToList")}
        </Button>
      ) : null}
      {controller.editorTab === "categories" ? (
        <WikiCategoryEditorCard
          canEdit={controller.canEdit}
          categoryName={controller.categoryEditor.categoryName}
          categoryDrafts={controller.categoryEditor.categoryDrafts}
          isCreating={controller.categoryEditor.isCreating}
          isSavingDrafts={controller.categoryEditor.isSavingDrafts}
          canSaveDrafts={controller.categoryEditor.canSaveDrafts}
          deletingCategoryId={controller.categoryEditor.deletingCategoryId}
          onCategoryNameChange={controller.categoryEditor.setCategoryName}
          onCreateCategory={controller.categoryEditor.createCategory}
          onSaveDrafts={controller.categoryEditor.saveCategoryDrafts}
          onCloseEditor={controller.handleCloseCategoryEditorWithoutSave}
          onCategoryDraftNameChange={controller.categoryEditor.setCategoryDraftName}
          onCategoryDraftParentIdChange={controller.categoryEditor.setCategoryDraftParentId}
          onCategoryReorder={controller.categoryEditor.reorderCategories}
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
        <Button size="xs" onClick={() => controller.setMobilePane("list")} style={{ alignSelf: "flex-start" }}>
          {t("backToList")}
        </Button>
      ) : null}
      <Paper withBorder className="wiki-article-reader-card" p="lg">
          <Stack gap={12}>
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
              <>
                <Group justify="space-between" align="start">
                  <Text fw={700} size="lg">
                    {controller.selectedArticle.title}
                  </Text>
                  {controller.canEdit ? (
                    <Group gap={6}>
                      <Tooltip label={t("history.button")} withArrow>
                        <ActionIcon variant="default" size="sm" onClick={controller.openHistory} aria-label={t("history.button")}>
                          <ClockIcon size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t("editor.editWiki")} withArrow>
                        <ActionIcon variant="default" size="sm" onClick={controller.handleOpenArticleEditor} aria-label={t("editor.editWiki")}>
                          <PencilIcon size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  ) : null}
                </Group>
                <Group gap={6}>
                  <Text size="sm">{t("title")}</Text>
                  <Text size="sm" c="dimmed">
                    /
                  </Text>
                  <Text size="sm">{controller.selectedCategory?.name ?? t("articleEditor.categoryFallback")}</Text>
                </Group>
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
              </>
            )}
          </Stack>
      </Paper>
    </Stack>
  );

  return (
    <PageLayout>
      <PageLayout.Section>
        <Paper withBorder p="sm" className="wiki-page-toolbar">
          <Group gap="sm" align="center" wrap="wrap">
            <TextInput
              className="wiki-page-toolbar__search"
              placeholder={t("filter.search")}
              aria-label={t("filter.searchAria")}
              value={controller.search}
              onChange={(event) => controller.setSearch(event.currentTarget.value)}
            />
              <SegmentedControl
                value={controller.archivedMode}
                onChange={(value) => controller.setArchivedMode(value as "active" | "archived" | "all")}
                data={[
                  { value: "active", label: t("filter.status.active") },
                  { value: "archived", label: t("filter.status.archived") },
                  { value: "all", label: t("filter.status.all") },
                ]}
                aria-label={t("filter.status")}
              />
              <Tooltip label={controller.pinnedOnly ? t("filter.showAll") : t("filter.showPinned")} withArrow>
                <ActionIcon
                  variant={controller.pinnedOnly ? "filled" : "default"}
                  color={controller.pinnedOnly ? "portal-brand" : "gray"}
                  size="lg"
                  aria-pressed={controller.pinnedOnly}
                  aria-label={controller.pinnedOnly ? t("filter.showAll") : t("filter.showPinned")}
                  onClick={() => controller.setPinnedOnly((value) => !value)}
                >
                  <PinIcon size={16} />
                </ActionIcon>
              </Tooltip>
            {hasActiveFilters ? (
              <Button variant="subtle" size="compact-sm" onClick={resetFilters}>
                {t("action.resetFilters")}
              </Button>
            ) : null}
          </Group>
        </Paper>
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
              selectedCategoryIds={controller.selectedCategoryIds}
              onCategoryFilterChange={controller.handleCategoryFilterChange}
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
            title={controller.selectedArticle?.title ?? t("articleEditor.title")}
            opened={controller.mobilePane === "article"}
            onClose={() => controller.setMobilePane("list")}
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
