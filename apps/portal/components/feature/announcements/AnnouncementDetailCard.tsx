import type { Announcement } from "@guild/shared";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { format } from "date-fns";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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

function statusBadgeColor(status: Announcement["status"]): string {
  switch (status) {
    case "draft":
      return "gray";
    case "scheduled":
      return "blue";
    case "published":
      return "green";
    case "archived":
      return "red";
    default:
      return "gray";
  }
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
  archivePending: boolean;
  draftStatus: Announcement["status"];
  onDraftStatusChange: (value: Announcement["status"]) => void;
  titleValue: string;
  onTitleChange: (value: string) => void;
  bodyJson: string;
  onBodyJsonChange: (value: string) => void;
  pinned: boolean;
  onPinnedChange: (value: boolean) => void;
  notifyDiscord: boolean;
  onNotifyDiscordChange: (value: boolean) => void;
  notifyWechat: boolean;
  onNotifyWechatChange: (value: boolean) => void;
  publishAt: string;
  onPublishAtChange: (value: string) => void;
  expiresAt: string;
  onExpiresAtChange: (value: string) => void;
  onSaveDraft: () => void;
  onPublishNow: () => void;
  onSchedule: () => void;
  onArchive: () => void;
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
  archivePending,
  draftStatus,
  onDraftStatusChange,
  titleValue,
  onTitleChange,
  bodyJson,
  onBodyJsonChange,
  pinned,
  onPinnedChange,
  notifyDiscord,
  onNotifyDiscordChange,
  notifyWechat,
  onNotifyWechatChange,
  publishAt,
  onPublishAtChange,
  expiresAt,
  onExpiresAtChange,
  onSaveDraft,
  onPublishNow,
  onSchedule,
  onArchive,
  onImageUpload,
  isDirty,
  emptyTitle,
}: AnnouncementDetailCardProps) {
  const { t } = useTranslation("announcements");
  const [editing, setEditing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"publish" | "archive" | null>(null);

  const handleConfirm = () => {
    if (confirmAction === "publish") {
      onPublishNow();
    } else if (confirmAction === "archive") {
      onArchive();
    }
    setConfirmAction(null);
  };

  return (
    <InfiniCard className="announcements-detail-card">
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={12}>
          {/* ── Header ── */}
          <Group justify="space-between" align="center">
            <Text fw={600}>{title}</Text>
            {canEdit && selectedId && selected ? (
              editing ? (
                <Group gap={8}>
                  {isDirty ? <Badge color="yellow">Unsaved</Badge> : <Badge color="green">Saved</Badge>}
                  <Button
                    variant="default"
                    size="compact-sm"
                    onClick={() => setEditing(false)}
                  >
                    Done
                  </Button>
                </Group>
              ) : (
                <Button
                  variant="light"
                  size="compact-sm"
                  leftSection={<PencilOutlined size={14} />}
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              )
            ) : null}
          </Group>

          {isLoading ? <Loader size="sm" /> : null}
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
                {canEdit ? (
                  <Badge color={statusBadgeColor(selected.status)}>
                    {selected.status.toUpperCase()}
                  </Badge>
                ) : null}
                {canEdit && selected.status === "scheduled" && selected.publish_at ? (
                  <Badge color="blue">Scheduled: {formatDateTime(selected.publish_at)}</Badge>
                ) : null}
                {canEdit && selected.expires_at ? (
                  <Badge variant="outline">Expires: {formatDateTime(selected.expires_at)}</Badge>
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
                Updated: {formatDateTime(selected.updated_at)}
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
                  {/* Publishing */}
                  <Stack gap={8}>
                    <Text fw={600} size="sm" c="dimmed" tt="uppercase" style={{ letterSpacing: "0.05em" }}>
                      Publishing
                    </Text>
                    <Select
                      value={draftStatus}
                      onChange={(value) => value && onDraftStatusChange(value as Announcement["status"])}
                      aria-label="Announcement status"
                      data={[
                        { value: "draft", label: "Draft" },
                        { value: "scheduled", label: "Scheduled" },
                        { value: "published", label: "Published" },
                        { value: "archived", label: "Archived" },
                      ]}
                      size="sm"
                    />
                    <label className="announcement-switch-label">
                      <Switch
                        checked={pinned}
                        onChange={(event) => onPinnedChange(event.currentTarget.checked)}
                        size="sm"
                      />
                      <span>{t("field.pinned")}</span>
                    </label>
                  </Stack>

                  <Divider />

                  {/* Notifications */}
                  <Stack gap={8}>
                    <Text fw={600} size="sm" c="dimmed" tt="uppercase" style={{ letterSpacing: "0.05em" }}>
                      Notifications
                    </Text>
                    <label className="announcement-switch-label">
                      <Switch
                        checked={notifyDiscord}
                        onChange={(event) => onNotifyDiscordChange(event.currentTarget.checked)}
                        size="sm"
                      />
                      <span>Discord</span>
                    </label>
                    <label className="announcement-switch-label">
                      <Switch
                        checked={notifyWechat}
                        onChange={(event) => onNotifyWechatChange(event.currentTarget.checked)}
                        size="sm"
                      />
                      <span>WeChat</span>
                    </label>
                  </Stack>

                  <Divider />

                  {/* Schedule */}
                  <Stack gap={8}>
                    <Text fw={600} size="sm" c="dimmed" tt="uppercase" style={{ letterSpacing: "0.05em" }}>
                      Schedule
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
                    <Text fw={600} size="sm" c="dimmed" tt="uppercase" style={{ letterSpacing: "0.05em" }}>
                      Actions
                    </Text>
                    <Button fullWidth onClick={onSaveDraft} loading={savePending}>
                      Save Draft
                    </Button>
                    <MotionButton type="primary" fullWidth onClick={() => setConfirmAction("publish")} loading={savePending}>
                      Publish Now
                    </MotionButton>
                    <Button
                      fullWidth
                      variant="default"
                      onClick={onSchedule}
                      loading={savePending}
                      disabled={!publishAt.trim()}
                    >
                      Schedule
                    </Button>
                    <Button
                      fullWidth
                      color="red"
                      variant="light"
                      onClick={() => setConfirmAction("archive")}
                      loading={archivePending}
                    >
                      {t("action.archive")}
                    </Button>
                  </Stack>

                  {/* Meta */}
                  <Text c="dimmed" size="xs">
                    Updated: {formatDateTime(selected.updated_at)}
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
        title={confirmAction === "publish" ? "Publish Announcement" : "Archive Announcement"}
        centered
        size="sm"
      >
        <Stack gap={16}>
          <Text>
            {confirmAction === "publish"
              ? "This will make the announcement visible to all members immediately. Continue?"
              : "This will archive the announcement and hide it from the main list. Continue?"}
          </Text>
          <Group justify="flex-end" gap={8}>
            <Button variant="default" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              color={confirmAction === "archive" ? "red" : undefined}
              onClick={handleConfirm}
              loading={confirmAction === "publish" ? savePending : archivePending}
            >
              {confirmAction === "publish" ? "Publish" : "Archive"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </InfiniCard>
  );
}
