import type { Announcement } from "@guild/shared";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Menu,
  Paper,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { format } from "date-fns";
import { type ReactNode, lazy, Suspense, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArchiveIcon, CalendarTimeIcon, ChevronDownIcon, NoteIcon, PinIcon, SendIcon, TrashIcon, XIcon } from "@portal/components/icons";
import { notifyError } from "../../../utils/notifications";
import { PencilOutlined } from "@portal/utils/icons";
import { EmptyState } from "../../shared/EmptyState";
import { NativeDateTimeInput } from "../../shared/NativeDateTimeInput";
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
  isPublishReady: boolean;
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
  isPublishReady,
  emptyTitle,
}: AnnouncementDetailCardProps) {
  const { t } = useTranslation("announcements");
  const { t: te } = useTranslation("editor");
  const confirm = useConfirmDialog();
  const editorLabels = useMemo(() => buildTipTapEditorLabels(te), [te]);
  const isCreateMode = selectedId === "new" && !selected;
  const [editing, editingHandlers] = useDisclosure(isCreateMode);

  // Auto-open editor when entering create mode, close when leaving
  useEffect(() => {
    if (isCreateMode) {
      editingHandlers.open();
    } else {
      editingHandlers.close();
    }
  }, [isCreateMode]);

  const validateAndFinish = (mode: StatusMode) => {
    if (!isPublishReady) return;

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

  const handleDeleteConfirm = async () => {
    const confirmed = await confirm({
      title: t("modal.deleteAnnouncement"),
      description: t("confirm.delete"),
      confirmLabel: t("action.delete"),
      cancelLabel: t("action.cancel"),
      intent: "danger",
    });
    if (confirmed) {
      onDelete();
      editingHandlers.close();
    }
  };

  const handleCloseEditor = () => {
    editingHandlers.close();
    onCloseEditor();
  };

  return (
    <Paper withBorder className="announcements-detail-card">
      {/* 正文卡整块内滚：标题、徽标和正文是一篇东西，一起滚才对
          （和 wiki-article-reader-card 同一处理）。 */}
      <div className="announcements-card-body" style={{ padding: "var(--card-padding)" }}>
        <Stack gap={12} className="announcements-card-scroll">
          {/* ── Header ── */}
          <Group
            component="header"
            justify="space-between"
            align="center"
            className={!editing && selected ? "announcement-reader-header" : undefined}
          >
            {!editing && selected ? (
              <Title order={2} className="announcement-reader-title">
                {selected.title}
              </Title>
            ) : (
              <Text fw={600}>{title}</Text>
            )}
            {canEdit && (selectedId && selected || isCreateMode) ? (
              editing ? (
                <Group gap={8}>
                  {!isPublishReady ? (
                    <Badge color="gray">{t("status.notReady")}</Badge>
                  ) : isDirty ? (
                    <Badge color="orange">{t("status.unsaved")}</Badge>
                  ) : (
                    <Badge color="green">{t("status.saved")}</Badge>
                  )}
                  <Button.Group>
                    <Button
                      size="sm"
                      color="portal-brand"
                      onClick={() => validateAndFinish("none")}
                      disabled={savePending || !isPublishReady}
                      leftSection={<SendIcon size={14} />}
                    >
                      {t("action.publish")}
                    </Button>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <Button
                          size="sm"
                          color="portal-brand"
                          disabled={savePending || !isPublishReady}
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
                  <Button
                    onClick={handleCloseEditor}
                    variant="default"
                    size="sm"
                    leftSection={<XIcon size={14} />}
                  >
                    {t("action.cancel")}
                  </Button>
                </Group>
              ) : (
                <Button
                  onClick={editingHandlers.open}
                  variant="default"
                  size="sm"
                  leftSection={<PencilOutlined size={14} />}
                >
                  {t("action.edit")}
                </Button>
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
          {isError ? <Alert color="red" title={warningMessage} /> : null}

          {/* ── Reader View (default for everyone) ── */}
          {!isLoading && !isError && selected && !editing ? (
            <Stack gap={12}>
              {/* Meta badges */}
              <Group gap={8} wrap="wrap">
                {canEdit && selected.status === "scheduled" && selected.publish_at ? (
                  <Badge color="blue">{t("meta.scheduled", { datetime: formatDateTime(selected.publish_at) })}</Badge>
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
                      /* 正文是 contenteditable 的 role="textbox"，不给名字读屏只会念「文本框」。 */
                      ariaLabel={t("field.body")}
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
                    <Tooltip label={pinned ? t("action.unpin") : t("action.pin")} withArrow>
                      <ActionIcon
                        aria-pressed={pinned}
                        onClick={() => onPinnedChange(!pinned)}
                        color="portal-brand"
                        variant={pinned ? "light" : "default"}
                        size="sm"
                        aria-label={pinned ? t("action.unpin") : t("action.pin")}
                      >
                        <PinIcon size={16} />
                      </ActionIcon>
                    </Tooltip>
                    {!isCreateMode ? (
                      <Tooltip label={t("action.archive")} withArrow>
                        <ActionIcon
                          aria-pressed={archived}
                          onClick={() => onArchivedChange(!archived)}
                          color="portal-brand"
                          variant={archived ? "light" : "default"}
                          size="sm"
                          aria-label={t("action.archive")}
                        >
                          <ArchiveIcon size={16} />
                        </ActionIcon>
                      </Tooltip>
                    ) : null}
                    {!isCreateMode ? (
                        <ActionIcon
                          color="red"
                          variant="filled"
                          size="sm"
                          onClick={() => void handleDeleteConfirm()}
                          loading={deletePending}
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
                      <NativeDateTimeInput
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

    </Paper>
  );
}
