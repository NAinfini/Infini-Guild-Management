import type { Announcement } from "@guild/shared";
import { DepthButton, DepthToggle } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { format } from "date-fns";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconArchive, IconPin, IconCalendarTime, IconBrandDiscord, IconBrandWechat, IconTrash, IconX, IconNote } from "@tabler/icons-react";
import { PencilOutlined } from "@portal/utils/icons";
import { EmptyState } from "../../shared/EmptyState";
import { TipTapEditor } from "../../shared/TipTapEditor";

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
  const [editing, setEditing] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const statusMode = deriveStatusMode(archived, scheduleEnabled, draftEnabled);

  const setStatusMode = (mode: StatusMode) => {
    onArchivedChange(mode === "archived");
    onScheduleEnabledChange(mode === "scheduled");
    onDraftEnabledChange(mode === "draft");
  };

  const toggleStatusMode = (mode: StatusMode) => {
    if (statusMode === mode) {
      setStatusMode("none");
    } else {
      setStatusMode(mode);
    }
  };

  const finishLabel = (() => {
    switch (statusMode) {
      case "draft": return t("action.saveAsDraft");
      case "archived": return t("action.archive");
      case "scheduled": return t("action.postScheduled");
      default:
        // No status toggle pressed — if currently draft, offer "Post Now"; otherwise "Save"
        return selected?.status === "draft" ? t("action.postNow") : t("action.save");
    }
  })();

  const handleFinishClick = () => {
    onFinish(statusMode);
    setEditing(false);
  };

  const handleDeleteConfirm = () => {
    onDelete();
    setDeleteConfirmOpen(false);
    setEditing(false);
  };

  const handleCloseEditor = () => {
    setEditing(false);
    onCloseEditor();
  };

  return (
    <InfiniCard className="announcements-detail-card" interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={12}>
          {/* ── Header ── */}
          <Group justify="space-between" align="center">
            <Text fw={600}>{title}</Text>
            {canEdit && selectedId && selected ? (
              editing ? (
                <Group gap={8}>
                  {isDirty ? <Badge color="infini-warning">{t("status.unsaved")}</Badge> : <Badge color="infini-success">{t("status.saved")}</Badge>}
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
                  onClick={() => setEditing(true)}
                  type="secondary"
                  size="sm"
                  before={<PencilOutlined size={14} />}
                >
                  {t("action.edit")}
                </DepthButton>
              )
            ) : null}
          </Group>

          {isLoading ? <Loader size="sm" /> : null}
          {isError ? <Alert color="infini-warning" title={warningMessage} /> : null}

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
                  <Badge color="infini-primary">{t("meta.scheduled", { datetime: formatDateTime(selected.publish_at) })}</Badge>
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

          {/* ── Editor View (moderators only, after clicking Edit) ── */}
          {!isLoading && !isError && selected && editing ? (
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
                    <Tooltip label={pinned ? t("action.unpin") : t("action.pin")} withArrow>
                      <DepthToggle
                        pressed={pinned}
                        onToggle={onPinnedChange}
                        type="secondary"
                        iconOnly
                        size="sm"
                        before={<IconPin size={16} />}
                        aria-label={pinned ? t("action.unpin") : t("action.pin")}
                      />
                    </Tooltip>
                    <Tooltip label={t("action.draft")} withArrow>
                      <DepthToggle
                        pressed={statusMode === "draft"}
                        onToggle={() => toggleStatusMode("draft")}
                        type="secondary"
                        iconOnly
                        size="sm"
                        before={<IconNote size={16} />}
                        aria-label={t("action.draft")}
                      />
                    </Tooltip>
                    <Tooltip label={t("action.archive")} withArrow>
                      <DepthToggle
                        pressed={statusMode === "archived"}
                        onToggle={() => toggleStatusMode("archived")}
                        type="secondary"
                        iconOnly
                        size="sm"
                        before={<IconArchive size={16} />}
                        aria-label={t("action.archive")}
                      />
                    </Tooltip>
                    <Tooltip label={t("action.publishOnTime")} withArrow>
                      <DepthToggle
                        pressed={statusMode === "scheduled"}
                        onToggle={() => toggleStatusMode("scheduled")}
                        type="secondary"
                        iconOnly
                        size="sm"
                        before={<IconCalendarTime size={16} />}
                        aria-label={t("action.publishOnTime")}
                      />
                    </Tooltip>
                    <Tooltip label={t("action.delete")} withArrow>
                      <DepthButton
                        onClick={() => setDeleteConfirmOpen(true)}
                        type="danger"
                        size="sm"
                      >
                        <IconTrash size={16} />
                      </DepthButton>
                    </Tooltip>
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
                        value={toDateTimeLocalValue(publishAt)}
                        onChange={(event) => onPublishAtChange(fromDateTimeLocalValue(event.currentTarget.value))}
                        aria-label="Announcement publish time"
                        size="sm"
                      />
                    </div>
                    <div>
                      <Text size="xs" c="dimmed">{t("field.expiresAt")}</Text>
                      <TextInput
                        type="datetime-local"
                        value={toDateTimeLocalValue(expiresAt)}
                        onChange={(event) => onExpiresAtChange(fromDateTimeLocalValue(event.currentTarget.value))}
                        aria-label="Announcement expire time"
                        size="sm"
                      />
                    </div>
                  </Stack>

                  <Divider />

                  {/* Meta */}
                  <Text c="dimmed" size="xs">
                    {t("meta.updated", { datetime: formatDateTime(selected.updated_at) })}
                  </Text>
                </Stack>
              </div>
            </div>
          ) : null}

          {!isLoading && !isError && !selected ? <EmptyState title={emptyTitle} /> : null}
        </Stack>
      </div>

      {/* ── Delete Confirmation Modal ── */}
      <Modal
        opened={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title={t("modal.deleteAnnouncement")}
        centered
        size="sm"
      >
        <Stack gap={16}>
          <Text>{t("confirm.delete")}</Text>
          <Group justify="flex-end" gap={8}>
            <Button variant="default" onClick={() => setDeleteConfirmOpen(false)} leftSection={<IconX size={16} />}>
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
    </InfiniCard>
  );
}
