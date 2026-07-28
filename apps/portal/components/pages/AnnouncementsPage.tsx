import { SpeakerphoneIcon } from "@portal/components/icons";
import { Button, Loader } from "@mantine/core";
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

  usePageHeaderActions(null);
  useLoadWarningToast(controller.listQuery.isError || controller.detailQuery.isError, t("common:loadErrorRetry"));

  const hasActiveFilters = Boolean(
    controller.search.trim() || controller.statusFilter || controller.pinnedFilter,
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

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<SpeakerphoneIcon size={22} />} className="announcements-page">
      <AnnouncementFiltersCard
        pinnedFilter={controller.pinnedFilter}
        statusFilter={controller.statusFilter}
        search={controller.search}
        canEdit={controller.canEdit}
        onPinnedFilterChange={controller.setPinnedFilter}
        onStatusFilterChange={controller.setStatusFilter}
        onSearchChange={controller.setSearch}
      />

      <div className="announcements-page-grid">
        <div>
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
            onSelect={controller.setSelectedId}
            onCreate={controller.handleCreateByStatus}
            hasMore={controller.listHasMore}
            isLoadingMore={controller.listLoadingMore}
            onLoadMore={controller.onLoadMoreList}
          />
        </div>

        <div>
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
            emptyTitle={t("common:message.noData")}
          />
        </div>
      </div>

      {controller.isBusy ? <Loader size="sm" /> : null}
    </PageLayout>
  );
}
