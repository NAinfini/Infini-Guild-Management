import type { WikiArticle, WikiCategory } from "@guild/shared";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { DepthToggle } from "@portal/components/shared/DepthToggle";
import { PortalCard } from "../../shared/PortalCard";
import { ActionIcon, Alert, Group, Select, Skeleton, Stack, Text, TextInput } from "@mantine/core";
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
  if (!selectedArticle && !(canEdit && isCreatingArticle)) {
    return (
      <PortalCard className="wiki-article-editor-card" interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Stack gap={10}>
            <Text fw={600}>{t("articleEditor.title")}</Text>
            <EmptyState title={emptyTitle} />
          </Stack>
        </div>
      </PortalCard>
    );
  }

  return (
    <PortalCard className="wiki-article-editor-card" interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={12}>
          <Group justify="space-between" align="start">
            <Text fw={600}>{t("articleEditor.title")}</Text>
            {canEdit ? (
              <Group gap={8} wrap="wrap">
                {selectedArticle ? (
                  <>
                    <DepthToggle
                        pressed={pinnedPressed}
                        onToggle={() => onTogglePinnedIntent()}
                        type="primary"
                        size="sm"
                        iconOnly
                        disabled={isSaving}
                        aria-label={pinLabel}
                        tooltip={{ label: pinLabel, withArrow: true }}
                      >
                        <PinIcon size={16} />
                      </DepthToggle>
                    <DepthToggle
                      pressed={selectedArticle?.archived_at ? archiveIntent !== "unarchive" : archiveIntent === "archive"}
                      onToggle={onToggleArchiveIntent}
                      type="primary"
                      iconOnly
                      size="sm"
                      disabled={isSaving}
                      aria-label={archiveLabel}
                      tooltip={{ label: archiveLabel, withArrow: true }}
                    >
                      <ArchiveIcon size={16} />
                    </DepthToggle>
                    <ActionIcon
                      color="red"
                      variant="filled"
                      size="sm"
                      onClick={onDeleteArticle}
                      disabled={isSaving}
                      aria-label={t("common:action.delete")}
                    >
                      <TrashIcon size={16} />
                    </ActionIcon>
                    <DepthButton
                      type="primary"
                      size="sm"
                      before={<SaveIcon size={16} />}
                      onClick={() => {
                        if (!articleTitle.trim()) {
                          notifyError(t("validation.titleRequired"));
                          return;
                        }
                        onSaveArticle();
                      }}
                      disabled={isSaving}
                    >
                      {t("articleEditor.save")}
                    </DepthButton>
                  </>
                ) : null}
                {canEdit && isCreatingArticle ? (
                  <DepthButton
                    type="primary"
                    size="sm"
                    before={<PlusIcon size={16} />}
                    onClick={onCreateArticle}
                    disabled={!canCreateArticle || isCreating}
                  >
                    {t("articleEditor.create")}
                  </DepthButton>
                ) : null}
                <DepthButton
                  type="secondary"
                  size="sm"
                  before={<XIcon size={16} />}
                  onClick={onExitEditor}
                  disabled={isSaving}
                >
                  {t("editor.exit")}
                </DepthButton>
              </Group>
            ) : null}
          </Group>

          {isLoading ? (
            <Stack gap={8}>
              {Array.from({ length: 7 }).map((_, index) => (
                <Skeleton key={index} height={12} />
              ))}
            </Stack>
          ) : null}
          {isError ? <Alert color="yellow" title={warningMessage} /> : null}

          {!isLoading && !isError ? (
            <Stack gap={12}>
              <Group gap={12} wrap="nowrap" align="flex-end" grow>
                <TextInput
                  label={t("articleEditor.titleField")}
                  value={articleTitle}
                  disabled={!canEdit}
                  onChange={(event) => onArticleTitleChange(event.currentTarget.value)}
                  placeholder={t("articleEditor.titleField")}
                  aria-label={t("aria.articleTitle")}
                  style={{ flex: 1 }}
                />
                <Select
                  w={200}
                  label={t("articleEditor.category")}
                  value={articleCategoryId || null}
                  disabled={!canEdit}
                  data={categoryOptions}
                  placeholder={t("articleEditor.category")}
                  aria-label={t("aria.articleCategory")}
                  onChange={(value) => onArticleCategoryChange(value ?? "")}
                  style={{ flex: 0, minWidth: 200 }}
                />
              </Group>
              <Text fw={600} size="sm">
                {t("articleEditor.body")}
              </Text>
              <TipTapEditor
                value={articleBody}
                onChange={onArticleBodyChange}
                placeholder={t("articleEditor.body")}
                editable={canEdit}
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
                    <Text c="yellow" size="sm">
                      {t("articleEditor.archivedAt", { date: formatDateTime(selectedArticle.archived_at) })}
                    </Text>
                  ) : null}
                </Stack>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </div>
    </PortalCard>
  );
}
