import { ArrowLeftIcon, SpeakerphoneIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePageHeaderActions } from "../../context/PageHeaderContext";
import { useAnnouncementsController } from "../../hooks/useAnnouncementsController";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { AnnouncementDetailCard } from "../feature/announcements/AnnouncementDetailCard";
import { AnnouncementFiltersCard } from "../feature/announcements/AnnouncementFiltersCard";
import { AnnouncementListCard } from "../feature/announcements/AnnouncementListCard";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import "./AnnouncementsPage.css";

export function AnnouncementsPage() {
  const { t } = useTranslation("announcements");
  const controller = useAnnouncementsController();
  const isCompact = useMediaQuery("(max-width: 61.99em)");
  const [showCompactDetail, setShowCompactDetail] = useState(false);

  usePageHeaderActions(null);
  useLoadWarningToast(controller.listQuery.isError || controller.detailQuery.isError, t("common:loadErrorRetry"));

  const hasActiveFilters = Boolean(
    controller.search.trim() || controller.statusFilter || controller.pinnedFilter || controller.sortOrder !== "updated_desc",
  );
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
  const openAnnouncement = async (id: string | null) => {
    if (id !== null && id === controller.selectedId && !controller.isCreating) {
      setShowCompactDetail(true);
      return;
    }
    const selected = await controller.setSelectedId(id);
    if (selected !== false) {
      setShowCompactDetail(true);
    }
  };
  const openCreate = () => {
    controller.handleCreateByStatus();
    setShowCompactDetail(true);
  };
  const returnToMobileList = async () => {
    const canLeave = await controller.setSelectedId(controller.selectedId);
    if (canLeave === false) {
      return;
    }
    controller.handleCloseEditor();
    setShowCompactDetail(false);
  };

  const listCard = (
    <AnnouncementListCard
      title={t("list.title")}
      rows={controller.rows}
      selectedId={controller.selectedId}
      canEdit={controller.canEdit}
      canCreate={controller.canCreate}
      announcementsLastSeenAt={controller.announcementsLastSeenAt}
      isLoading={controller.listQuery.isLoading}
      isError={controller.listQuery.isError}
      warningMessage={t("common:loadError")}
      emptyText={emptyText}
      onSelect={(id) => {
        void openAnnouncement(id);
      }}
      onCreate={openCreate}
      hasMore={controller.listHasMore}
      isLoadingMore={controller.listLoadingMore}
      onLoadMore={controller.onLoadMoreList}
    />
  );
  const detailCard = (
    <AnnouncementDetailCard
      title={controller.isCreating ? t("detail.titleCreate") : t("detail.title")}
      canEdit={controller.canEdit}
      selectedId={controller.isCreating ? "new" : controller.selectedId}
      selected={controller.isCreating ? null : controller.selected}
      isLoading={controller.detailQuery.isLoading}
      isError={controller.detailQuery.isError}
      warningMessage={t("common:loadError")}
      savePending={controller.savePending}
      titleValue={controller.title}
      onTitleChange={controller.setTitle}
      bodyJson={controller.bodyJson}
      onBodyJsonChange={controller.setBodyJson}
      pinned={controller.pinned}
      onPinnedChange={controller.setPinned}
      scheduleEnabled={controller.scheduleEnabled}
      onScheduleEnabledChange={controller.setScheduleEnabled}
      publishAt={controller.publishAt}
      onPublishAtChange={controller.setPublishAt}
      onFinish={controller.handleFinish}
      onDelete={controller.handleDelete}
      onCloseEditor={controller.handleCloseEditor}
      deletePending={controller.deletePending}
      draftEnabled={controller.draftEnabled}
      onDraftEnabledChange={controller.setDraftEnabled}
      archived={controller.archived}
      onArchivedChange={controller.setArchived}
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
  const filters = !isCompact || !showCompactDetail ? (
    <AnnouncementFiltersCard
      pinnedFilter={controller.pinnedFilter}
      statusFilter={controller.statusFilter}
      sortOrder={controller.sortOrder}
      search={controller.search}
      canEdit={controller.canEdit}
      onPinnedFilterChange={controller.setPinnedFilter}
      onStatusFilterChange={controller.setStatusFilter}
      onSortOrderChange={controller.setSortOrder}
      onSearchChange={controller.setSearch}
    />
  ) : null;

  return (
    <PageLayout
      className="announcements-page"
      toolbar={filters}
      workspaceMode={isCompact ? "scroll" : "contained"}
    >
      <div className="announcements-page__workspace">
        {isCompact ? (
          <div className="announcements-mobile-flow">
            {showCompactDetail ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="announcements-back-button"
                  onClick={() => {
                    void returnToMobileList();
                  }}
                >
                  <ArrowLeftIcon size={16} aria-hidden="true" />
                  {t("action.backToList")}
                </Button>
                {detailCard}
              </>
            ) : listCard}
          </div>
        ) : (
          <div className="announcements-page-grid">
            <div className="announcements-page-column">{listCard}</div>
            <div className="announcements-page-column announcements-page-column--detail">{detailCard}</div>
          </div>
        )}

        {controller.isBusy ? (
          <div className="announcements-page__loading" role="status" aria-label={t("common:message.loading")}>
            <span aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </PageLayout>
  );
}
