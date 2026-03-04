import type { Announcement } from "@guild/shared";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import {
  Button,
  Divider,
  Modal,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TipTapEditor, TIPTAP_DEFAULT_JSON } from "../../shared/TipTapEditor";

function toDateTimeLocalValue(value: string): string {
  return value ? value.replace(" ", "T") : "";
}

function fromDateTimeLocalValue(value: string): string {
  return value ? value.replace("T", " ") : "";
}

type CreateAnnouncementModalProps = {
  opened: boolean;
  onClose: () => void;
  onCreateByStatus: (payload: {
    title: string;
    body_json: string;
    pinned: boolean;
    status: Announcement["status"];
    publish_at?: string;
    expires_at?: string;
    notify_discord: boolean;
    notify_wechat: boolean;
  }) => void;
  creating: boolean;
};

export function CreateAnnouncementModal({
  opened,
  onClose,
  onCreateByStatus,
  creating,
}: CreateAnnouncementModalProps) {
  const { t } = useTranslation("announcements");
  const [title, setTitle] = useState("");
  const [bodyJson, setBodyJson] = useState(TIPTAP_DEFAULT_JSON);
  const [pinned, setPinned] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notifyDiscord, setNotifyDiscord] = useState(true);
  const [notifyWechat, setNotifyWechat] = useState(false);

  const reset = () => {
    setTitle("");
    setBodyJson(TIPTAP_DEFAULT_JSON);
    setPinned(false);
    setPublishAt("");
    setExpiresAt("");
    setNotifyDiscord(true);
    setNotifyWechat(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const toIso = (value: string): string | undefined => {
    if (!value.trim()) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toISOString();
  };

  const buildPayload = (status: Announcement["status"]) => ({
    title: title || t("draftTitle"),
    body_json: bodyJson || TIPTAP_DEFAULT_JSON,
    pinned,
    status,
    publish_at: status === "published" ? new Date().toISOString() : toIso(publishAt),
    expires_at: toIso(expiresAt),
    notify_discord: notifyDiscord,
    notify_wechat: notifyWechat,
  });

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="New Announcement"
      centered
      size="xl"
      closeOnClickOutside={false}
    >
      <div className="create-announcement-layout">
        {/* Left: Title + Editor */}
        <div className="create-announcement-main">
          <Stack gap={12}>
            <TextInput
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder={t("field.title")}
              aria-label="Announcement title"
            />
            <TipTapEditor
              value={bodyJson}
              onChange={setBodyJson}
              placeholder={t("field.body")}
              editable={true}
              onImageUpload={async () => {
                throw new Error("Save as draft first before uploading images");
              }}
            />
          </Stack>
        </div>

        {/* Right: Settings */}
        <div className="create-announcement-sidebar">
          <Stack gap={16}>
            {/* Publishing */}
            <Stack gap={8}>
              <Text fw={600} size="sm" c="dimmed" tt="uppercase" style={{ letterSpacing: "0.05em" }}>
                Publishing
              </Text>
              <label className="announcement-switch-label">
                <Switch
                  checked={pinned}
                  onChange={(event) => setPinned(event.currentTarget.checked)}
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
                  onChange={(event) => setNotifyDiscord(event.currentTarget.checked)}
                  size="sm"
                />
                <span>Discord</span>
              </label>
              <label className="announcement-switch-label">
                <Switch
                  checked={notifyWechat}
                  onChange={(event) => setNotifyWechat(event.currentTarget.checked)}
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
                  onChange={(event) => setPublishAt(fromDateTimeLocalValue(event.currentTarget.value))}
                  aria-label="Announcement publish time"
                  size="sm"
                />
              </div>
              <div>
                <Text size="xs" c="dimmed">{t("field.expiresAt")}</Text>
                <TextInput
                  type="datetime-local"
                  value={toDateTimeLocalValue(expiresAt)}
                  onChange={(event) => setExpiresAt(fromDateTimeLocalValue(event.currentTarget.value))}
                  aria-label="Announcement expire time"
                  size="sm"
                />
              </div>
            </Stack>

            <Divider />

            {/* Actions */}
            <Stack gap={8}>
              <Button
                fullWidth
                variant="default"
                onClick={() => onCreateByStatus(buildPayload("draft"))}
                loading={creating}
              >
                Save as Draft
              </Button>
              <MotionButton
                type="primary"
                fullWidth
                onClick={() => onCreateByStatus(buildPayload("published"))}
                loading={creating}
              >
                Publish Now
              </MotionButton>
              <Button
                fullWidth
                variant="default"
                onClick={() => onCreateByStatus(buildPayload("scheduled"))}
                loading={creating}
                disabled={!publishAt.trim()}
              >
                Schedule
              </Button>
            </Stack>
          </Stack>
        </div>
      </div>
    </Modal>
  );
}
