import type { Announcement } from "@guild/shared";
import { DepthToggle } from "@infini-dev-kit/frontend/components";
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
import { IconArchive, IconPin, IconCalendarTime, IconBrandDiscord, IconBrandWechat } from "@tabler/icons-react";
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
  onSaveDraft: () => void;
  onPublish: () => void;
  archived: boolean;
  onArchivedChange: (value: boolean) => void;
  onImageUpload: (file: File) => Promise<string>;
  isDirty: boolean;
  emptyTitle: ReactNode;
};

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
  onSaveDraft,
  onPublish,
  archived,
  onArchivedChange,
  onImageUpload,
  isDirty,
  emptyTitle,
}: AnnouncementDetailCardProps) {
  const { t } = useTranslation("announcements");
  const [editing, setEditing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"publish" | "publishNow" | null>(null);

  const handleConfirm = () => {
    if (confirmAction === "publish" || confirmAction === "publishNow") {
      onPublish();
    }
    setConfirmAction(null);
  };

  const handlePublishClick = () => {
    const hasTime = publishAt.trim().length > 0;
    if (scheduleEnabled && hasTime) {
      // Publish on time — schedule it
      setConfirmAction("publish");
    } else if (scheduleEnabled && !hasTime) {
      // Toggle checked but no time set — ask user
      setConfirmAction("publishNow");
    } else if (!scheduleEnabled && hasTime) {
      // Time set but toggle unchecked — ask user
      setConfirmAction("publishNow");
    } else {
      // No schedule, no time — publish now
      setConfirmAction("publish");
    }
  };

  const confirmTitle = confirmAction === "publishNow"
    ? t("modal.publishDecision")
    : t("modal.publishAnnouncement");

  const confirmText = confirmAction === "publishNow"
    ? t("confirm.publishDecision")
    : scheduleEnabled && publishAt.trim()
      ? t("confirm.schedule")
      : t("confirm.publish");

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
                  <Button
                    variant="default"
                    size="compact-sm"
                    onClick={() => setEditing(false)}
                  >
                    {t("action.done")}
                  </Button>
                </Group>
              ) : (
                <Button
                  variant="light"
                  size="compact-sm"
                  leftSection={<PencilOutlined size={14} />}
                  onClick={() => setEditing(true)}
                >
                  {t("action.edit")}
                </Button>
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
                  {/* Top row: Pin, Archive, Publish On Time — icon-only DepthToggles */}
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
                    <Tooltip label={t("action.archive")} withArrow>
                      <DepthToggle
                        pressed={archived}
                        onToggle={onArchivedChange}
                        type="secondary"
                        iconOnly
                        size="sm"
                        before={<IconArchive size={16} />}
                        aria-label={t("action.archive")}
                      />
                    </Tooltip>
                    <Tooltip label={t("action.publishOnTime")} withArrow>
                      <DepthToggle
                        pressed={scheduleEnabled}
                        onToggle={onScheduleEnabledChange}
                        type="secondary"
                        iconOnly
                        size="sm"
                        before={<IconCalendarTime size={16} />}
                        aria-label={t("action.publishOnTime")}
                      />
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

                  {/* Actions */}
                  <Stack gap={8}>
                    <Button fullWidth onClick={onSaveDraft} loading={savePending}>
                      {t("action.saveDraft")}
                    </Button>
                    <Button fullWidth color="infini-primary" onClick={handlePublishClick} loading={savePending}>
                      {t("action.publish")}
                    </Button>
                  </Stack>

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

      {/* ── Confirmation Modal ── */}
      <Modal
        opened={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title={confirmTitle}
        centered
        size="sm"
      >
        <Stack gap={16}>
          <Text>{confirmText}</Text>
          <Group justify="flex-end" gap={8}>
            <Button variant="default" onClick={() => setConfirmAction(null)}>
              {t("action.cancel")}
            </Button>
            {confirmAction === "publishNow" ? (
              <>
                <Button
                  variant="light"
                  onClick={() => {
                    onScheduleEnabledChange(true);
                    setConfirmAction(null);
                  }}
                  disabled={!publishAt.trim()}
                >
                  {t("action.scheduleLater")}
                </Button>
                <Button
                  onClick={() => {
                    onScheduleEnabledChange(false);
                    handleConfirm();
                  }}
                  loading={savePending}
                >
                  {t("action.publishImmediately")}
                </Button>
              </>
            ) : (
              <Button
                onClick={handleConfirm}
                loading={savePending}
              >
                {scheduleEnabled && publishAt.trim()
                  ? t("action.schedule")
                  : t("action.publish")}
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </InfiniCard>
  );
}
