import { ArrowLeftIcon, SpeakerphoneIcon } from "@portal/components/icons";
import { ContentPreviewCard } from "@portal/components/shared/ContentPreviewCard";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { isApiRequestError } from "@portal/services/AnnouncementService";
import { useTranslation } from "react-i18next";
import { usePageHeaderActions } from "../../context/PageHeaderContext";
import { useAnnouncementsController } from "../../hooks/useAnnouncementsController";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { formatDateTimeWithTimeZone } from "../../utils/datetime";
import { resolveMediaUrl } from "../../utils/media";
import { AnnouncementDetailCard } from "../feature/announcements/AnnouncementDetailCard";
import { AnnouncementFiltersCard } from "../feature/announcements/AnnouncementFiltersCard";
import { AnnouncementListCard } from "../feature/announcements/AnnouncementListCard";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import "./AnnouncementsPage.css";

export function AnnouncementsPage() {
  const { t } = useTranslation("announcements");
  const controller = useAnnouncementsController();

  usePageHeaderActions(null);
  useLoadWarningToast(controller.listQuery.isError || controller.detailQuery.isError, t("common:loadErrorRetry"));

  const hasActiveFilters = Boolean(
    controller.search.trim()
    || controller.statusFilter
    || controller.categoryFilter
    || controller.sortOrder !== "updated_desc",
  );
  const isDetailPage = controller.isCreating || Boolean(controller.selectedId);
  const showPinnedSection = !hasActiveFilters && controller.pinnedRows.length > 0;
  const pinnedRowIds = new Set(controller.pinnedRows.map(({ id }) => id));
  const catalogRows = showPinnedSection
    ? controller.rows.filter(({ id }) => !pinnedRowIds.has(id))
    : controller.rows;
  const detailMissing = Boolean(
    controller.selectedId
      && isApiRequestError(controller.detailQuery.error)
      && controller.detailQuery.error.status === 404,
  );
  const detailUnavailable = Boolean(
    !controller.isCreating
      && controller.selectedId
      && (detailMissing || (!controller.selected && (controller.detailQuery.isError || !controller.detailQuery.isLoading))),
  );
  const detailRefreshError = Boolean(
    !controller.isCreating
      && controller.selectedId
      && controller.detailQuery.isError
      && controller.selected
      && !detailMissing,
  );

  const detailCard = (
    <AnnouncementDetailCard
      navigation={(
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="announcements-back-button"
          onClick={() => { void controller.setSelectedId(null); }}
        >
          <ArrowLeftIcon size={16} aria-hidden="true" />
          {t("action.backToList")}
        </Button>
      )}
      title={controller.isCreating ? t("detail.titleCreate") : t("detail.title")}
      canEdit={controller.canEdit}
      canCreate={controller.canCreate}
      canArchive={controller.canArchive}
      canDelete={controller.canDelete}
      selectedId={controller.isCreating ? "new" : controller.selectedId}
      selected={controller.isCreating ? null : controller.selected}
      isLoading={controller.detailQuery.isLoading}
      savePending={controller.savePending}
      titleValue={controller.title}
      onTitleChange={controller.setTitle}
      category={controller.category}
      onCategoryChange={controller.setCategory}
      bodyJson={controller.bodyJson}
      onBodyJsonChange={controller.setBodyJson}
      pinned={controller.pinned}
      onPinnedChange={controller.setPinned}
      publishAt={controller.publishAt}
      onPublishAtChange={controller.setPublishAt}
      onStartEditing={controller.handleStartEditing}
      onFinish={controller.handleFinish}
      onDelete={controller.handleDelete}
      onCloseEditor={controller.handleCloseEditor}
      archivePending={controller.archivePending}
      deletePending={controller.deletePending}
      onImageUpload={controller.handleUploadAnnouncementImages}
      attachments={controller.attachments}
      attachmentUploading={controller.attachmentUploading}
      attachmentMaxBytes={controller.attachmentMaxBytes}
      attachmentQuota={controller.attachmentQuota}
      onAttachmentUpload={controller.handleUploadAnnouncementAttachment}
      onAttachmentRemove={controller.handleRemoveAnnouncementAttachment}
      isDirty={controller.isDirty}
      isPublishReady={controller.isPublishReady}
      emptyTitle={t("common:message.noData")}
    />
  );

  if (isDetailPage) {
    if (detailUnavailable) {
      return (
        <PageLayout workspaceMode="scroll">
          <div className="announcements-detail-page">
            <EmptyState
              status="error"
              title={detailMissing ? t("common:notFound.title") : t("common:loadError")}
              description={detailMissing ? t("common:notFound.description") : t("common:errors.connectionIssue")}
              actions={detailMissing ? (
                <Button type="button" onClick={() => { void controller.setSelectedId(null); }}>
                  <ArrowLeftIcon size={16} aria-hidden="true" />
                  {t("action.backToList")}
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
        <div className="announcements-detail-page">
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
          {detailCard}
          {controller.isBusy ? (
            <div className="announcements-page__loading" role="status" aria-label={t("status.updating")}>
              <span aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </PageLayout>
    );
  }

  const emptyText = (
    <EmptyState
      title={hasActiveFilters ? t("empty.filtered") : t("empty")}
      description={hasActiveFilters ? t("empty.filteredDescription") : t("empty.description")}
      icon={<SpeakerphoneIcon size={28} aria-hidden="true" />}
      actions={hasActiveFilters ? (
        <Button onClick={controller.resetFilters}>{t("action.resetFilters")}</Button>
      ) : controller.canCreate ? (
        <Button onClick={controller.handleCreateByStatus}>{t("action.newAnnouncement")}</Button>
      ) : undefined}
    />
  );

  return (
    <PageLayout
      className="announcements-page"
      workspaceMode="scroll"
      toolbar={(
        <AnnouncementFiltersCard
          statusFilter={controller.statusFilter}
          sortOrder={controller.sortOrder}
          search={controller.search}
          canEdit={controller.canManageContent}
          onStatusFilterChange={controller.setStatusFilter}
          onSortOrderChange={controller.setSortOrder}
          onSearchChange={controller.setSearch}
        />
      )}
    >
      <div className="announcements-page__workspace">
        {showPinnedSection ? (
          <Card className="content-pinned-section" role="region" aria-labelledby="announcement-pinned-title">
            <header className="content-pinned-section__header">
              <p>{t("pinned.eyebrow")}</p>
              <h2 id="announcement-pinned-title">{t("pinned.title")}</h2>
            </header>
            <div className="content-pinned-grid" data-count={controller.pinnedRows.length}>
              {controller.pinnedRows.map((item) => (
                <ContentPreviewCard
                  key={item.id}
                  compact
                  domain="announcements"
                  title={item.title}
                  excerpt={item.excerpt}
                  category={t(`category.${item.category}`)}
                  author={item.author.display_name}
                  timestamp={formatDateTimeWithTimeZone(item.publish_at ?? item.created_at)}
                  viewLabel={t("meta.views", { count: item.view_count })}
                  imageUrl={item.preview_media_id ? resolveMediaUrl(item.preview_media_id) : null}
                  pinned
                  pinnedLabel={t("status.pinned")}
                  ariaLabel={t("aria.openAnnouncement", { title: item.title })}
                  onOpen={() => { void controller.setSelectedId(item.id); }}
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
                className={!controller.categoryFilter ? "is-active" : undefined}
                aria-pressed={!controller.categoryFilter}
                onClick={() => controller.setCategoryFilter(undefined)}
              >
                <span>{t("category.all")}</span>
                <span>{catalogRows.length}</span>
              </button>
              {controller.categoryOptions.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={controller.categoryFilter === value ? "is-active" : undefined}
                  aria-pressed={controller.categoryFilter === value}
                  onClick={() => controller.setCategoryFilter(value)}
                >
                  <span>{t(`category.${value}`)}</span>
                </button>
              ))}
            </div>
          </Card>

          <AnnouncementListCard
            title={t("list.title")}
            rows={catalogRows}
            canCreate={controller.canCreate}
            isLoading={controller.listQuery.isLoading}
            isError={controller.listQuery.isError}
            warningMessage={t("common:loadError")}
            onRetry={() => { void controller.listQuery.refetch(); }}
            retryPending={controller.listQuery.isFetching}
            emptyText={emptyText}
            onSelect={(id) => { void controller.setSelectedId(id); }}
            onCreate={controller.handleCreateByStatus}
            hasMore={controller.listHasMore}
            isLoadingMore={controller.listLoadingMore}
            onLoadMore={controller.onLoadMoreList}
          />
        </div>
      </div>
    </PageLayout>
  );
}
