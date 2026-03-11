import { IconPlus, IconSpeakerphone } from "@tabler/icons-react";
import { Button, Grid, Group, Loader } from "@mantine/core";
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

  const emptyText = (
    <EmptyState
      title={controller.search.trim() || controller.statusFilter || controller.pinnedFilter ? t("empty.filtered") : t("empty")}
      actions={
        <Group gap={8} wrap="wrap">
          <Button
            variant="default"
            onClick={controller.resetFilters}
            disabled={!controller.search.trim() && !controller.statusFilter && !controller.pinnedFilter}
          >
            {t("action.resetFilters")}
          </Button>
          {controller.canEdit ? (
            <Button onClick={controller.handleCreateByStatus} leftSection={<IconPlus size={16} />}>
              {t("action.createAnnouncement")}
            </Button>
          ) : null}
        </Group>
      }
    />
  );

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<IconSpeakerphone size={22} />} className="announcements-page">
      <AnnouncementFiltersCard
        pinnedFilter={controller.pinnedFilter}
        statusFilter={controller.statusFilter}
        search={controller.search}
        canEdit={controller.canEdit}
        onPinnedFilterChange={controller.setPinnedFilter}
        onStatusFilterChange={controller.setStatusFilter}
        onSearchChange={controller.setSearch}
      />

      <Grid gutter={12}>
        <Grid.Col span={{ base: 12, lg: 3 }}>
          <AnnouncementListCard
            title={t("list.title")}
            rows={controller.rows}
            selectedId={controller.selectedId}
            canEdit={controller.canEdit}
            announcementsLastSeenAt={controller.announcementsLastSeenAt}
            isLoading={false}
            isError={false}
            warningMessage={t("common:loadError")}
            emptyText={emptyText}
            onSelect={controller.setSelectedId}
            onCreate={controller.handleCreateByStatus}
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: "auto" }}>
          <AnnouncementDetailCard
            title={controller.isCreating ? t("detail.titleCreate") : t("detail.title")}
            canEdit={controller.canEdit}
            selectedId={controller.isCreating ? "new" : controller.selectedId}
            selected={controller.isCreating ? null : controller.selected}
            isLoading={false}
            isError={false}
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
            notifyDiscord={controller.notifyDiscord}
            onNotifyDiscordChange={controller.setNotifyDiscord}
            notifyWechat={controller.notifyWechat}
            onNotifyWechatChange={controller.setNotifyWechat}
            publishAt={controller.publishAt}
            onPublishAtChange={controller.setPublishAt}
            expiresAt={controller.expiresAt}
            onExpiresAtChange={controller.setExpiresAt}
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
        </Grid.Col>
      </Grid>

      {controller.isBusy ? <Loader size="sm" /> : null}
    </PageLayout>
  );
}
