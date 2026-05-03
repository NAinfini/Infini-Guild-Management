import type { Announcement } from "@guild/shared";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { DepthToggle } from "@portal/components/shared/DepthToggle";
import { PortalCard } from "../../shared/PortalCard";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Menu,
  Skeleton,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { format } from "date-fns";
import { type ReactNode, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { IconArchive, IconPin, IconCalendarTime, IconTrash, IconX, IconNote, IconChevronDown, IconSend } from "@tabler/icons-react";
import { notifyError } from "../../../utils/notifications";
import { PencilOutlined } from "@portal/utils/icons";
import { EmptyState } from "../../shared/EmptyState";
import { TipTapEditor, buildTipTapEditorLabels } from "@portal/components/shared/TipTapEditor";

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
  onScheduleEnabledChange,
  publishAt,
  onPublishAtChange,
  expiresAt,
  onExpiresAtChange,
  onFinish,
  onDelete,
  onCloseEditor,
  deletePending,
  onDraftEnabledChange,
  archived,
  onArchivedChange,
  onImageUpload,
  isDirty,
  emptyTitle,
}: AnnouncementDetailCardProps) {
  const { t } = useTranslation("announcements");
  const { t: te } = useTranslation("editor");
  const editorLabels = useMemo(() => buildTipTapEditorLabels(te), [te]);
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

  const validateAndFinish = (mode: StatusMode) => {
    if (mode === "scheduled" && publishAt) {
      const scheduledDate = new Date(publishAt.replace(" ", "T"));
      if (!Number.isNaN(scheduledDate.getTime()) && scheduledDate <= new Date()) {
        notifyError(t("validation.schedulePast"));
        return;
      }
    }
    if (publishAt && expiresAt) {
      const publishDate = new Date(publishAt.replace(" ", "T"));
      const expiryDate = new Date(expiresAt.replace(" ", "T"));
      if (!Number.isNaN(publishDate.getTime()) && !Number.isNaN(expiryDate.getTime()) && expiryDate <= publishDate) {
        notifyError(t("validation.expiresBeforePublish"));
        return;
      }
    }
    onDraftEnabledChange(mode === "draft");
    onScheduleEnabledChange(mode === "scheduled");
    onArchivedChange(mode === "archived");
    onFinish(mode);
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
                  <Button.Group>
                    <Button
                      size="sm"
                      color="blue"
                      onClick={() => validateAndFinish("none")}
                      disabled={savePending}
                      leftSection={<IconSend size={14} />}
                    >
                      {t("action.publish")}
                    </Button>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <Button
                          size="sm"
                          color="blue"
                          disabled={savePending}
                          px={8}
                        >
                          <IconChevronDown size={14} />
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconNote size={16} />}
                          onClick={() => validateAndFinish("draft")}
                        >
                          {t("action.saveAsDraft")}
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconCalendarTime size={16} />}
                          onClick={() => validateAndFinish("scheduled")}
                        >
                          {t("action.postScheduled")}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Button.Group>
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
                labels={editorLabels}
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
                    aria-label={t("aria.title")}
                  />
                  <TipTapEditor
                    value={bodyJson}
                    onChange={onBodyJsonChange}
                    placeholder={t("field.body")}
                    editable={true}
                    onImageUpload={onImageUpload}
                    labels={editorLabels}
                  />
                </Stack>
              </div>

              {/* Right: Settings Sidebar */}
              <div className="announcement-editor-sidebar">
                <Stack gap={16}>
                  {/* Pin | Archive | Delete */}
                  <Group gap={8} wrap="nowrap">
                    <DepthToggle
                        pressed={pinned}
                        onToggle={onPinnedChange}
                        type="primary"
                        iconOnly
                        size="sm"
                        aria-label={pinned ? t("action.unpin") : t("action.pin")}
                        tooltip={{ label: pinned ? t("action.unpin") : t("action.pin"), withArrow: true }}
                      >
                        <IconPin size={16} />
                      </DepthToggle>
                    {!isCreateMode ? (
                      <DepthToggle
                        pressed={archived}
                        onToggle={onArchivedChange}
                        type="primary"
                        iconOnly
                        size="sm"
                        aria-label={t("action.archive")}
                        tooltip={{ label: t("action.archive"), withArrow: true }}
                      >
                        <IconArchive size={16} />
                      </DepthToggle>
                    ) : null}
                    {!isCreateMode ? (
                        <ActionIcon
                          color="red"
                          variant="filled"
                          size="sm"
                          onClick={deleteConfirmHandlers.open}
                          aria-label={t("action.delete")}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                    ) : null}
                  </Group>

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
                        aria-label={t("aria.publishTime")}
                        size="sm"
                      />
                    </div>
                    <div>
                      <Text size="xs" c="dimmed">{t("field.expiresAt")}</Text>
                      <TextInput
                        type="datetime-local"
                        value={toDateTimeLocalValue(expiresAt) || undefined}
                        onChange={(event) => onExpiresAtChange(fromDateTimeLocalValue(event.currentTarget.value))}
                        aria-label={t("aria.expireTime")}
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
