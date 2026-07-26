import type { Announcement } from "@guild/shared";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { DepthToggle } from "@portal/components/shared/DepthToggle";
import { PortalCard } from "../../shared/PortalCard";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
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
import { type ReactNode, lazy, Suspense, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArchiveIcon, CalendarTimeIcon, ChevronDownIcon, NoteIcon, PinIcon, SendIcon, TrashIcon, XIcon } from "@portal/components/icons";
import { notifyError } from "../../../utils/notifications";
import { PencilOutlined } from "@portal/utils/icons";
import { EmptyState } from "../../shared/EmptyState";
import { buildTipTapEditorLabels } from "@portal/components/shared/tiptap-meta";

const LazyTipTapEditor = lazy(() =>
  import("@portal/components/shared/TipTapEditor").then((m) => ({ default: m.TipTapEditor })),
);

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
                  {isDirty ? <Badge color="portal-copper">{t("status.unsaved")}</Badge> : <Badge color="green">{t("status.saved")}</Badge>}
                  <Button.Group>
                    <Button
                      size="sm"
                      color="portal-gold"
                      onClick={() => validateAndFinish("none")}
                      disabled={savePending}
                      leftSection={<SendIcon size={14} />}
                    >
                      {t("action.publish")}
                    </Button>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <Button
                          size="sm"
                          color="portal-gold"
                          disabled={savePending}
                          px={8}
                        >
                          <ChevronDownIcon size={14} />
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<NoteIcon size={16} />}
                          onClick={() => validateAndFinish("draft")}
                        >
                          {t("action.saveAsDraft")}
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<CalendarTimeIcon size={16} />}
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
                    before={<XIcon size={14} />}
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
          {isError ? <Alert color="portal-copper" title={warningMessage} /> : null}

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
                  <Badge color="portal-bronze">{t("meta.scheduled", { datetime: formatDateTime(selected.publish_at) })}</Badge>
                ) : null}
              </Group>

              {/* Rendered body (read-only TipTap) */}
              <Suspense fallback={<Card><Stack gap={8} p="md"><Skeleton height={200} radius={8} /></Stack></Card>}>
                <LazyTipTapEditor
                  value={bodyJson}
                  onChange={() => {}}
                  placeholder=""
                  editable={false}
                  onImageUpload={onImageUpload}
                  labels={editorLabels}
                />
              </Suspense>

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
                  <Suspense fallback={<Card><Stack gap={8} p="md"><Skeleton height={200} radius={8} /></Stack></Card>}>
                    <LazyTipTapEditor
                      value={bodyJson}
                      onChange={onBodyJsonChange}
                      placeholder={t("field.body")}
                      editable={true}
                      onImageUpload={onImageUpload}
                      labels={editorLabels}
                    />
                  </Suspense>
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
                        <PinIcon size={16} />
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
                        <ArchiveIcon size={16} />
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
                          <TrashIcon size={16} />
                        </ActionIcon>
                    ) : null}
                  </Group>

                  <Divider />

                  {/* Schedule */}
                  <Stack gap={8}>
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
            <Button variant="default" onClick={deleteConfirmHandlers.close} leftSection={<XIcon size={16} />}>
              {t("action.cancel")}
            </Button>
            <Button
              color="red"
              onClick={handleDeleteConfirm}
              loading={deletePending}
              leftSection={<TrashIcon size={16} />}
            >
              {t("action.delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PortalCard>
  );
}
