import { Button, Group, Loader, Stack } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ArrowLeftIcon } from "@portal/components/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePageHeaderActions } from "../../context/PageHeaderContext";
import { useAnnouncementsController } from "../../hooks/useAnnouncementsController";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { AnnouncementDetailCard } from "../feature/announcements/AnnouncementDetailCard";
import { AnnouncementFiltersCard } from "../feature/announcements/AnnouncementFiltersCard";
import { AnnouncementListCard } from "../feature/announcements/AnnouncementListCard";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import "./AnnouncementsPage.css";

export function AnnouncementsPage() {
  const { t } = useTranslation("announcements");
  const controller = useAnnouncementsController();
  const isMobile = useMediaQuery("(max-width: 47.99em)");
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  usePageHeaderActions(null);
  useLoadWarningToast(controller.listQuery.isError || controller.detailQuery.isError, t("common:loadErrorRetry"));

  const hasActiveFilters = Boolean(
    controller.search.trim() || controller.statusFilter || controller.pinnedFilter || controller.sortOrder !== "updated_desc",
  );
  const emptyText = (
    <EmptyState
      title={hasActiveFilters ? t("empty.filtered") : t("empty")}
      actions={hasActiveFilters ? (
        <Button onClick={controller.resetFilters}>{t("action.resetFilters")}</Button>
      ) : controller.canCreate ? (
        <Button onClick={controller.handleCreateByStatus}>{t("action.newAnnouncement")}</Button>
      ) : undefined}
    />
  );
  const openAnnouncement = async (id: string | null) => {
    if (id !== null && id === controller.selectedId && !controller.isCreating) {
      setShowMobileDetail(true);
      return;
    }
    const selected = await controller.setSelectedId(id);
    if (selected !== false) {
      setShowMobileDetail(true);
    }
  };
  const openCreate = () => {
    controller.handleCreateByStatus();
    setShowMobileDetail(true);
  };
  const returnToMobileList = async () => {
    const canLeave = await controller.setSelectedId(controller.selectedId);
    if (canLeave === false) {
      return;
    }
    controller.handleCloseEditor();
    setShowMobileDetail(false);
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
      isDirty={controller.isDirty}
      isPublishReady={controller.isPublishReady}
      emptyTitle={t("common:message.noData")}
    />
  );

  return (
    <PageLayout className="announcements-page">
      <Stack gap="var(--page-rhythm)" className="announcements-page__stack">
      {!isMobile || !showMobileDetail ? (
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
      ) : null}

      {isMobile ? (
        <Stack gap="sm" className="announcements-mobile-flow">
          {showMobileDetail ? (
            <>
              <Group>
                <Button
                  variant="subtle"
                  leftSection={<ArrowLeftIcon size={16} />}
                  onClick={() => {
                    void returnToMobileList();
                  }}
                >
                  {t("action.backToList")}
                </Button>
              </Group>
              {detailCard}
            </>
          ) : listCard}
        </Stack>
      ) : (
        <div className="announcements-page-grid">
          <div className="announcements-page-column">{listCard}</div>
          <div className="announcements-page-column announcements-page-column--detail">{detailCard}</div>
        </div>
      )}

      {controller.isBusy ? <Loader size="sm" /> : null}
      </Stack>
    </PageLayout>
  );
}
