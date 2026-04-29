import type { Announcement } from "@guild/shared";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { DepthToggle } from "@portal/components/shared/DepthToggle";
import { PortalCard } from "../../shared/PortalCard";
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Skeleton,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useDisclosure } from "@mantine/hooks";
import { format } from "date-fns";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { IconArchive, IconPin, IconCalendarTime, IconBrandDiscord, IconBrandWechat, IconTrash, IconX, IconNote } from "@tabler/icons-react";
import { PencilOutlined } from "@portal/utils/icons";
import { EmptyState } from "../../shared/EmptyState";
import { TipTapEditor } from "@portal/components/shared/TipTapEditor";

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

function toDateTimeLocalValue(value: string): string {
  return value ? value.replace(" ", "T") : "";
}

function fromDateTimeLocalValue(value: string): string {
  return value ? value.replace("T", " ") : "";
}

type StatusMode = "none" | "draft" | "archived" | "scheduled";

type AnnouncementDetailCardProps = {
  title: ReactNode;
  canEdit: boolean;
  selectedId: string | null;
  selected: Announcement | null;
  isLoading: boolean;
  isError: boolean;
  warningMessage: ReactNode;
  savePending: boolean;
  titleValue: string;
  onTitleChange: (value: string) => void;
  bodyJson: string;
  onBodyJsonChange: (value: string) => void;
  pinned: boolean;
  onPinnedChange: (value: boolean) => void;
  scheduleEnabled: boolean;
  onScheduleEnabledChange: (value: boolean) => void;
  notifyDiscord: boolean;
  onNotifyDiscordChange: (value: boolean) => void;
  notifyWechat: boolean;
  onNotifyWechatChange: (value: boolean) => void;
  publishAt: string;
  onPublishAtChange: (value: string) => void;
  expiresAt: string;
  onExpiresAtChange: (value: string) => void;
  onFinish: (mode: StatusMode) => void;
  onDelete: () => void;
  onCloseEditor: () => void;
  deletePending: boolean;
  draftEnabled: boolean;
  onDraftEnabledChange: (value: boolean) => void;
  archived: boolean;
  onArchivedChange: (value: boolean) => void;
  onImageUpload: (file: File) => Promise<string>;
  isDirty: boolean;
  emptyTitle: ReactNode;
};

function deriveStatusMode(archived: boolean, scheduleEnabled: boolean, draftEnabled: boolean): StatusMode {
  if (archived) return "archived";
  if (scheduleEnabled) return "scheduled";
  if (draftEnabled) return "draft";
  return "none";
}

export function AnnouncementDetailCard({
  title,
  canEdit,
  selectedId,
  selected,
  isLoading,
  isError,
  warningMessage,
  savePending,
  titleValue,
  onTitleChange,
  bodyJson,
  onBodyJsonChange,
  pinned,
  onPinnedChange,
  scheduleEnabled,
  onScheduleEnabledChange,
  notifyDiscord,
  onNotifyDiscordChange,
  notifyWechat,
  onNotifyWechatChange,
  publishAt,
  onPublishAtChange,
  expiresAt,
  onExpiresAtChange,
  onFinish,
  onDelete,
  onCloseEditor,
  deletePending,
  draftEnabled,
  onDraftEnabledChange,
  archived,
  onArchivedChange,
  onImageUpload,
  isDirty,
  emptyTitle,
}: AnnouncementDetailCardProps) {
  const { t } = useTranslation("announcements");
  const isCreateMode = selectedId === "new" && !selected;
  const [editing, editingHandlers] = useDisclosure(isCreateMode);
  const [deleteConfirmOpen, deleteConfirmHandlers] = useDisclosure(false);

  // Auto-open editor when entering create mode, close when leaving
  useEffect(() => {
    if (isCreateMode) {
      editingHandlers.open();
    } else {
      editingHandlers.close();
    }
  }, [isCreateMode]);  

  const statusMode = deriveStatusMode(archived, scheduleEnabled, draftEnabled);

  const setStatusMode = (mode: StatusMode) => {
    onArchivedChange(mode === "archived");
    onScheduleEnabledChange(mode === "scheduled");
    onDraftEnabledChange(mode === "draft");
  };

  const handleStatusToggle = (mode: Exclude<StatusMode, "none">, nextPressed: boolean) => {
    setStatusMode(nextPressed ? mode : "none");
  };

  const finishLabel = (() => {
    switch (statusMode) {
      case "draft": return t("action.saveAsDraft");
      case "archived": return t("action.archive");
      case "scheduled": return t("action.postScheduled");
      default:
        // No status toggle pressed — create mode: "Post Now"; draft: "Post Now"; otherwise "Save"
        return isCreateMode || selected?.status === "draft" ? t("action.postNow") : t("action.save");
    }
  })();

  const handleFinishClick = () => {
    if (statusMode === "scheduled" && publishAt) {
      const scheduledDate = new Date(publishAt.replace(" ", "T"));
      if (!Number.isNaN(scheduledDate.getTime()) && scheduledDate <= new Date()) {
        notifications.show({ color: "red", message: t("validation.schedulePast") });
        return;
      }
    }
    if (publishAt && expiresAt) {
      const publishDate = new Date(publishAt.replace(" ", "T"));
      const expiryDate = new Date(expiresAt.replace(" ", "T"));
      if (!Number.isNaN(publishDate.getTime()) && !Number.isNaN(expiryDate.getTime()) && expiryDate <= publishDate) {
        notifications.show({ color: "red", message: t("validation.expiresBeforePublish") });
        return;
      }
    }
    onFinish(statusMode);
    editingHandlers.close();
  };

  const handleDeleteConfirm = () => {
    onDelete();
    deleteConfirmHandlers.close();
    editingHandlers.close();
  };

  const handleCloseEditor = () => {
    editingHandlers.close();
    onCloseEditor();
  };

  return (
    <PortalCard className="announcements-detail-card" interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={12}>
          {/* ── Header ── */}
          <Group justify="space-between" align="center">
            <Text fw={600}>{title}</Text>
            {canEdit && (selectedId && selected || isCreateMode) ? (
              editing ? (
                <Group gap={8}>
                  {isDirty ? <Badge color="yellow">{t("status.unsaved")}</Badge> : <Badge color="green">{t("status.saved")}</Badge>}
                  <DepthButton
                    onClick={handleFinishClick}
                    type="primary"
                    size="sm"
                    disabled={!isDirty || savePending}
                  >
                    {finishLabel}
                  </DepthButton>
                  <DepthButton
                    onClick={handleCloseEditor}
                    type="secondary"
                    size="sm"
                    before={<IconX size={14} />}
                  >
                    {t("action.cancel")}
                  </DepthButton>
                </Group>
              ) : (
                <DepthButton
                  onClick={editingHandlers.open}
                  type="secondary"
                  size="sm"
                  before={<PencilOutlined size={14} />}
                >
                  {t("action.edit")}
                </DepthButton>
              )
            ) : null}
          </Group>

          {isLoading ? (
            <Stack gap={10}>
              <Skeleton height={22} width="50%" />
              <Skeleton height={14} width="30%" />
              <Skeleton height={14} />
              <Skeleton height={14} />
              <Skeleton height={14} width="70%" />
            </Stack>
          ) : null}
          {isError ? <Alert color="yellow" title={warningMessage} /> : null}

          {/* ── Reader View (default for everyone) ── */}
          {!isLoading && !isError && selected && !editing ? (
            <Stack gap={12}>
              {/* Title */}
              <Text fw={700} size="xl" className="announcement-reader-title">
                {selected.title}
              </Text>

              {/* Meta badges */}
              <Group gap={8} wrap="wrap">
                {canEdit && selected.status === "scheduled" && selected.publish_at ? (
                  <Badge color="blue">{t("meta.scheduled", { datetime: formatDateTime(selected.publish_at) })}</Badge>
                ) : null}
                {canEdit && selected.expires_at ? (
                  <Badge variant="outline">{t("meta.expires", { datetime: formatDateTime(selected.expires_at) })}</Badge>
                ) : null}
              </Group>

              {/* Rendered body (read-only TipTap) */}
              <TipTapEditor
                value={bodyJson}
                onChange={() => {}}
                placeholder=""
                editable={false}
                onImageUpload={onImageUpload}
              />

              {/* Footer metadata */}
              <Text c="dimmed" size="sm">
                {t("meta.updated", { datetime: formatDateTime(selected.updated_at) })}
              </Text>
            </Stack>
          ) : null}

          {/* ── Editor View (moderators only, after clicking Edit or in create mode) ── */}
          {!isLoading && !isError && (selected || isCreateMode) && editing ? (
            <div className="announcement-editor-layout">
              {/* Left: Title + Editor */}
              <div className="announcement-editor-main">
                <Stack gap={12}>
                  <TextInput
                    value={titleValue}
                    onChange={(event) => onTitleChange(event.currentTarget.value)}
                    placeholder={t("field.title")}
                    aria-label="Announcement title"
                  />
                  <TipTapEditor
                    value={bodyJson}
                    onChange={onBodyJsonChange}
                    placeholder={t("field.body")}
                    editable={true}
                    onImageUpload={onImageUpload}
                  />
                </Stack>
              </div>

              {/* Right: Settings Sidebar */}
              <div className="announcement-editor-sidebar">
                <Stack gap={16}>
                  {/* Top row: Pin, Draft, Archive, Schedule, Delete — icon-only DepthToggles */}
                  <Group gap={8} wrap="nowrap">
                    <DepthToggle
                        pressed={pinned}
                        onToggle={onPinnedChange}
                        type="secondary"
                        iconOnly
                        size="sm"
                        before={<IconPin size={16} />}
                        aria-label={pinned ? t("action.unpin") : t("action.pin")}
                        tooltip={{ label: pinned ? t("action.unpin") : t("action.pin"), withArrow: true }}
                      />
                    <DepthToggle
                        pressed={statusMode === "draft"}
                        onToggle={(nextPressed) => handleStatusToggle("draft", nextPressed)}
                        type="secondary"
                        iconOnly
                        size="sm"
                        before={<IconNote size={16} />}
                        aria-label={t("action.draft")}
                        tooltip={{ label: t("action.draft"), withArrow: true }}
                      />
                    {!isCreateMode ? (
                        <DepthToggle
                          pressed={statusMode === "archived"}
                          onToggle={(nextPressed) => handleStatusToggle("archived", nextPressed)}
                          type="secondary"
                          iconOnly
                          size="sm"
                          before={<IconArchive size={16} />}
                          aria-label={t("action.archive")}
                          tooltip={{ label: t("action.archive"), withArrow: true }}
                        />
                    ) : null}
                    <DepthToggle
                        pressed={statusMode === "scheduled"}
                        onToggle={(nextPressed) => handleStatusToggle("scheduled", nextPressed)}
                        type="secondary"
                        iconOnly
                        size="sm"
                        before={<IconCalendarTime size={16} />}
                        aria-label={t("action.publishOnTime")}
                        tooltip={{ label: t("action.publishOnTime"), withArrow: true }}
                      />
                    {!isCreateMode ? (
                        <DepthButton
                          onClick={deleteConfirmHandlers.open}
                          type="danger"
                          size="sm"
                          tooltip={{ label: t("action.delete"), withArrow: true }}
                        >
                          <IconTrash size={16} />
                        </DepthButton>
                    ) : null}
                  </Group>

                  <Divider />

                  {/* Notifications — DepthToggles */}
                  <Stack gap={8}>
                    <Text fw={600} size="sm" c="dimmed" tt="uppercase" style={{ letterSpacing: "0.05em" }}>
                      {t("section.notifications")}
                    </Text>
                    <Group gap={8} wrap="wrap">
                      <DepthToggle
                        pressed={notifyDiscord}
                        onToggle={onNotifyDiscordChange}
                        type="secondary"
                        size="sm"
                        before={<IconBrandDiscord size={16} />}
                      >
                        {t("notify.discord")}
                      </DepthToggle>
                      <DepthToggle
                        pressed={notifyWechat}
                        onToggle={onNotifyWechatChange}
                        type="secondary"
                        size="sm"
                        before={<IconBrandWechat size={16} />}
                      >
                        {t("notify.wechat")}
                      </DepthToggle>
                    </Group>
                  </Stack>

                  <Divider />

                  {/* Schedule */}
                  <Stack gap={8}>
                    <Text fw={600} size="sm" c="dimmed" tt="uppercase" style={{ letterSpacing: "0.05em" }}>
                      {t("section.schedule")}
                    </Text>
                    <div>
                      <Text size="xs" c="dimmed">{t("field.publishAt")}</Text>
                      <TextInput
                        type="datetime-local"
                        value={toDateTimeLocalValue(publishAt) || undefined}
                        onChange={(event) => onPublishAtChange(fromDateTimeLocalValue(event.currentTarget.value))}
                        aria-label="Announcement publish time"
                        size="sm"
                      />
                    </div>
                    <div>
                      <Text size="xs" c="dimmed">{t("field.expiresAt")}</Text>
                      <TextInput
                        type="datetime-local"
                        value={toDateTimeLocalValue(expiresAt) || undefined}
                        onChange={(event) => onExpiresAtChange(fromDateTimeLocalValue(event.currentTarget.value))}
                        aria-label="Announcement expire time"
                        size="sm"
                      />
                    </div>
                  </Stack>

                  <Divider />

                  {/* Meta */}
                  {selected ? (
                    <Text c="dimmed" size="xs">
                      {t("meta.updated", { datetime: formatDateTime(selected.updated_at) })}
                    </Text>
                  ) : null}
                </Stack>
              </div>
            </div>
          ) : null}

          {!isLoading && !isError && !selected && selectedId !== "new" ? <EmptyState title={emptyTitle} /> : null}
        </Stack>
      </div>

      {/* ── Delete Confirmation Modal ── */}
      <Modal
        opened={deleteConfirmOpen}
        onClose={deleteConfirmHandlers.close}
        title={t("modal.deleteAnnouncement")}
        centered
        size="sm"
      >
        <Stack gap={16}>
          <Text>{t("confirm.delete")}</Text>
          <Group justify="flex-end" gap={8}>
            <Button variant="default" onClick={deleteConfirmHandlers.close} leftSection={<IconX size={16} />}>
              {t("action.cancel")}
            </Button>
            <Button
              color="red"
              onClick={handleDeleteConfirm}
              loading={deletePending}
              leftSection={<IconTrash size={16} />}
            >
              {t("action.delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PortalCard>
  );
}
