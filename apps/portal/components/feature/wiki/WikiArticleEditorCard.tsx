import type { WikiArticle, WikiCategory } from "@guild/shared";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { ArchiveIcon, PinIcon, PlusIcon, SaveIcon, TrashIcon, XIcon } from "@portal/components/icons";
import { format } from "date-fns";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import { notifyError } from "../../../utils/notifications";
import { TipTapEditor, buildTipTapEditorLabels } from "@portal/components/shared/TipTapEditor";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

type CategoryOption = {
  value: string;
  label: string;
};

type WikiArticleEditorCardProps = {
  canEdit: boolean;
  isCreatingArticle: boolean;
  selectedArticle: WikiArticle | null;
  selectedCategory: WikiCategory | null;
  isLoading: boolean;
  isError: boolean;
  warningMessage: ReactNode;
  articleTitle: string;
  articleBody: string;
  articleCategoryId: string;
  categoryOptions: CategoryOption[];
  pinnedIntent: "none" | "pin" | "unpin";
  archiveIntent: "none" | "archive" | "unarchive";
  isSaving: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  canCreateArticle: boolean;
  onArticleTitleChange: (value: string) => void;
  onArticleBodyChange: (value: string) => void;
  onArticleCategoryChange: (value: string) => void;
  onSaveArticle: () => void;
  onTogglePinnedIntent: () => void;
  onToggleArchiveIntent: () => void;
  onCreateArticle: () => void;
  onExitEditor: () => void;
  onImageUpload: (file: File) => Promise<string>;
  onDeleteArticle: () => void;
  emptyTitle: ReactNode;
};

export function WikiArticleEditorCard({
  canEdit,
  isCreatingArticle,
  selectedArticle,
  selectedCategory,
  isLoading,
  isError,
  warningMessage,
  articleTitle,
  articleBody,
  articleCategoryId,
  categoryOptions,
  pinnedIntent,
  archiveIntent,
  isSaving,
  isCreating,
  isDeleting,
  canCreateArticle,
  onArticleTitleChange,
  onArticleBodyChange,
  onArticleCategoryChange,
  onSaveArticle,
  onTogglePinnedIntent,
  onToggleArchiveIntent,
  onCreateArticle,
  onExitEditor,
  onImageUpload,
  onDeleteArticle,
  emptyTitle,
}: WikiArticleEditorCardProps) {
  const { t } = useTranslation("wiki");
  const { t: te } = useTranslation("editor");
  const editorLabels = useMemo(() => buildTipTapEditorLabels(te), [te]);
  const pinLabel = selectedArticle?.pinned
    ? (pinnedIntent === "unpin" ? t("articleEditor.unpinQueued") : t("articleEditor.unpin"))
    : (pinnedIntent === "pin" ? t("articleEditor.pinQueued") : t("articleEditor.pin"));
  const archiveLabel = selectedArticle?.archived_at
    ? (archiveIntent === "unarchive" ? t("articleEditor.unarchiveQueued") : t("articleEditor.unarchive"))
    : (archiveIntent === "archive" ? t("articleEditor.archiveQueued") : t("articleEditor.archive"));
  const pinnedPressed = selectedArticle
    ? (selectedArticle.pinned ? pinnedIntent !== "unpin" : pinnedIntent === "pin")
    : false;
  const editorBusy = isSaving || isDeleting;
  if (!selectedArticle && !(canEdit && isCreatingArticle)) {
    return (
      <Paper withBorder className="wiki-article-editor-card">
        <div className="wiki-card-body" style={{ padding: "var(--card-padding)" }}>
          <Text component="h2" fw={600} className="wiki-article-editor-title">
            {t("articleEditor.title")}
          </Text>
          <EmptyState title={emptyTitle} />
        </div>
      </Paper>
    );
  }

  return (
    <Paper withBorder className="wiki-article-editor-card">
      {/* 标题行钉住：保存、退出、删除这几个按钮不能跟着正文滚出视口。 */}
      <div className="wiki-card-body" style={{ padding: "var(--card-padding)" }}>
          <Group justify="space-between" align="start">
            <Text component="h2" fw={600} className="wiki-article-editor-title">
              {t("articleEditor.title")}
            </Text>
            {canEdit ? (
              <Group gap={8} wrap="wrap" className="wiki-article-editor-actions">
                {selectedArticle ? (
                  <>
                    <Tooltip label={pinLabel} withArrow>
                      <ActionIcon
                        aria-pressed={pinnedPressed}
                        onClick={onTogglePinnedIntent}
                        color="portal-brand"
                        variant={pinnedPressed ? "light" : "default"}
                        size="lg"
                        disabled={editorBusy}
                        aria-label={pinLabel}
                      >
                        <PinIcon size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label={archiveLabel} withArrow>
                      <ActionIcon
                        aria-pressed={selectedArticle?.archived_at ? archiveIntent !== "unarchive" : archiveIntent === "archive"}
                        onClick={() => onToggleArchiveIntent()}
                        color="portal-brand"
                        variant={(selectedArticle?.archived_at ? archiveIntent !== "unarchive" : archiveIntent === "archive") ? "light" : "default"}
                        size="lg"
                        disabled={editorBusy}
                        aria-label={archiveLabel}
                      >
                        <ArchiveIcon size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Button
                      size="md"
                      leftSection={<SaveIcon size={16} />}
                      onClick={() => {
                        if (!articleTitle.trim()) {
                          notifyError(t("validation.titleRequired"));
                          return;
                        }
                        onSaveArticle();
                      }}
                      disabled={editorBusy}
                    >
                      {t("articleEditor.save")}
                    </Button>
                  </>
                ) : null}
                {canEdit && isCreatingArticle ? (
                  <Button
                    size="md"
                    leftSection={<PlusIcon size={16} />}
                    onClick={onCreateArticle}
                    disabled={!canCreateArticle || isCreating}
                  >
                    {t("articleEditor.create")}
                  </Button>
                ) : null}
                <Button
                  variant="default"
                  size="md"
                  leftSection={<XIcon size={16} />}
                  onClick={onExitEditor}
                  disabled={editorBusy}
                >
                  {t("editor.exit")}
                </Button>
                {selectedArticle ? (
                  <Tooltip label={t("common:action.delete")} withArrow>
                    <ActionIcon
                      color="red"
                      variant="light"
                      size="lg"
                      className="wiki-article-editor-actions__danger"
                      onClick={onDeleteArticle}
                      loading={isDeleting}
                      disabled={editorBusy}
                      aria-label={t("common:action.delete")}
                    >
                      <TrashIcon size={16} />
                    </ActionIcon>
                  </Tooltip>
                ) : null}
              </Group>
            ) : null}
          </Group>

          <Stack gap={12} className="wiki-card-scroll">
          {isLoading ? (
            <Stack gap={8}>
              {Array.from({ length: 7 }).map((_, index) => (
                <Skeleton key={index} height={12} />
              ))}
            </Stack>
          ) : null}
          {isError ? <Alert color="red" title={warningMessage} /> : null}

          {!isLoading && !isError ? (
            <Stack gap={12}>
              <Group gap={12} wrap="wrap" align="flex-end" grow>
                <TextInput
                  label={t("articleEditor.titleField")}
                  value={articleTitle}
                  disabled={!canEdit || isDeleting}
                  onChange={(event) => onArticleTitleChange(event.currentTarget.value)}
                  placeholder={t("articleEditor.titleField")}
                  aria-label={t("aria.articleTitle")}
                  style={{ flex: "1 1 16rem", minWidth: 0 }}
                />
                <Select
                  w={200}
                  label={t("articleEditor.category")}
                  value={articleCategoryId || null}
                  disabled={!canEdit || isDeleting}
                  data={categoryOptions}
                  placeholder={t("articleEditor.category")}
                  aria-label={t("aria.articleCategory")}
                  onChange={(value) => onArticleCategoryChange(value ?? "")}
                  style={{ flex: "0 1 12.5rem", minWidth: 0, maxWidth: "100%" }}
                />
              </Group>
              <Text fw={600} size="sm">
                {t("articleEditor.body")}
              </Text>
              <TipTapEditor
                value={articleBody}
                onChange={onArticleBodyChange}
                placeholder={t("articleEditor.body")}
                editable={canEdit && !isDeleting}
                ariaLabel={t("articleEditor.body")}
                onImageUpload={onImageUpload}
                labels={editorLabels}
              />
              {selectedArticle ? (
                <Stack gap={2}>
                  <Group gap={6}>
                    <Text size="sm">{t("articleEditor.title")}</Text>
                    <Text size="sm" c="dimmed">/</Text>
                    <Text size="sm">{selectedCategory?.name ?? t("articleEditor.categoryFallback")}</Text>
                    <Text size="sm" c="dimmed">/</Text>
                    <Text size="sm">{selectedArticle.title}</Text>
                  </Group>
                  <Text c="dimmed" size="sm">
                    {t("articleEditor.lastUpdatedBy", { user: selectedArticle.created_by.slice(0, 8), date: formatDateTime(selectedArticle.updated_at) })}
                  </Text>
                  {selectedArticle.archived_at ? (
                    <Text c="gray" size="sm">
                      {t("articleEditor.archivedAt", { date: formatDateTime(selectedArticle.archived_at) })}
                    </Text>
                  ) : null}
                </Stack>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </div>
    </Paper>
  );
}
