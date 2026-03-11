import type { Announcement } from "@guild/shared";
import { DepthToggle } from "@infini-dev-kit/frontend/components";
import {
  Button,
  Divider,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconPin, IconCalendarTime, IconBrandDiscord, IconBrandWechat, IconDeviceFloppy, IconX } from "@tabler/icons-react";
import { TipTapEditor, TIPTAP_DEFAULT_JSON } from "@infini-dev-kit/frontend/components";

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
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notifyDiscord, setNotifyDiscord] = useState(true);
  const [notifyWechat, setNotifyWechat] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"publish" | "publishNow" | null>(null);

  const reset = () => {
    setTitle("");
    setBodyJson(TIPTAP_DEFAULT_JSON);
    setPinned(false);
    setScheduleEnabled(false);
    setPublishAt("");
    setExpiresAt("");
    setNotifyDiscord(true);
    setNotifyWechat(false);
    setConfirmAction(null);
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

  const handlePublishClick = () => {
    const hasTime = publishAt.trim().length > 0;
    if (scheduleEnabled && hasTime) {
      setConfirmAction("publish");
    } else {
      setConfirmAction("publishNow");
    }
  };

  const handlePublishConfirm = (asScheduled: boolean) => {
    if (asScheduled) {
      onCreateByStatus(buildPayload("scheduled"));
    } else {
      onCreateByStatus(buildPayload("published"));
    }
    setConfirmAction(null);
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t("modal.newAnnouncement")}
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
                throw new Error(t("error.uploadImageDraft"));
              }}
            />
          </Stack>
        </div>

        {/* Right: Settings */}
        <div className="create-announcement-sidebar">
          <Stack gap={16}>
            {/* Top row: Pin, Publish On Time — icon-only DepthToggles */}
            <Group gap={8} wrap="nowrap">
              <Tooltip label={pinned ? t("action.unpin") : t("action.pin")} withArrow>
                <DepthToggle
                  pressed={pinned}
                  onToggle={setPinned}
                  type="secondary"
                  iconOnly
                  size="sm"
                  before={<IconPin size={16} />}
                  aria-label={pinned ? t("action.unpin") : t("action.pin")}
                />
              </Tooltip>
              <Tooltip label={t("action.publishOnTime")} withArrow>
                <DepthToggle
                  pressed={scheduleEnabled}
                  onToggle={setScheduleEnabled}
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
                  onToggle={setNotifyDiscord}
                  type="secondary"
                  size="sm"
                  before={<IconBrandDiscord size={16} />}
                >
                  {t("notify.discord")}
                </DepthToggle>
                <DepthToggle
                  pressed={notifyWechat}
                  onToggle={setNotifyWechat}
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
                  onChange={(event) => setPublishAt(fromDateTimeLocalValue(event.currentTarget.value))}
                  aria-label="Announcement publish time"
                  size="sm"
                />
              </div>
              <div>
                <Text size="xs" c="dimmed">{t("field.expiresAt")}</Text>
                <TextInput
                  type="datetime-local"
                  value={toDateTimeLocalValue(expiresAt) || undefined}
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
                leftSection={<IconDeviceFloppy size={16} />}
              >
                {t("action.saveAsDraft")}
              </Button>
              <Button
                fullWidth
                color="infini-primary"
                onClick={handlePublishClick}
                loading={creating}
              >
                {t("action.publish")}
              </Button>
            </Stack>
          </Stack>
        </div>
      </div>

      {/* Publish decision modal */}
      <Modal
        opened={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title={t("modal.publishAnnouncement")}
        centered
        size="sm"
      >
        <Stack gap={16}>
          <Text>
            {confirmAction === "publishNow"
              ? t("confirm.publishDecision")
              : scheduleEnabled && publishAt.trim()
                ? t("confirm.schedule")
                : t("confirm.publish")}
          </Text>
          <Group justify="flex-end" gap={8}>
            <Button variant="default" onClick={() => setConfirmAction(null)} leftSection={<IconX size={16} />}>
              {t("action.cancel")}
            </Button>
            {confirmAction === "publishNow" ? (
              <>
                <Button
                  variant="light"
                  onClick={() => {
                    setScheduleEnabled(true);
                    setConfirmAction(null);
                  }}
                  disabled={!publishAt.trim()}
                >
                  {t("action.scheduleLater")}
                </Button>
                <Button
                  onClick={() => handlePublishConfirm(false)}
                  loading={creating}
                >
                  {t("action.publishImmediately")}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => handlePublishConfirm(scheduleEnabled && !!publishAt.trim())}
                loading={creating}
              >
                {scheduleEnabled && publishAt.trim() ? t("action.schedule") : t("action.publish")}
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </Modal>
  );
}
