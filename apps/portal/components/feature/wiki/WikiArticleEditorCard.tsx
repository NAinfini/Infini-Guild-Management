import type { WikiArticle, WikiCategory } from "@guild/shared";
import { DepthButton, DepthToggle } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Alert, Group, Select, Skeleton, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconArchive, IconDeviceFloppy, IconPinned, IconPlus, IconX } from "@tabler/icons-react";
import { format } from "date-fns";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import { TipTapEditor } from "../../shared/TipTapEditor";

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
  emptyTitle,
}: WikiArticleEditorCardProps) {
  const { t } = useTranslation("wiki");
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
      <InfiniCard className="wiki-article-editor-card" interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Stack gap={10}>
            <Text fw={600}>{t("articleEditor.title")}</Text>
            <EmptyState title={emptyTitle} />
          </Stack>
        </div>
      </InfiniCard>
    );
  }

  return (
    <InfiniCard className="wiki-article-editor-card" interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={12}>
          <Group justify="space-between" align="start">
            <Text fw={600}>{t("articleEditor.title")}</Text>
            {canEdit ? (
              <Group gap={8} wrap="wrap">
                {selectedArticle ? (
                  <>
                    <Tooltip label={pinLabel} withArrow>
                      <DepthToggle
                        pressed={pinnedPressed}
                        onToggle={() => onTogglePinnedIntent()}
                        type="primary"
                        size="sm"
                        iconOnly
                        before={<IconPinned size={16} />}
                        disabled={isSaving}
                        aria-label={pinLabel}
                      />
                    </Tooltip>
                    <DepthButton
                      type={archiveIntent === "none" ? "danger" : "secondary"}
                      size="sm"
                      before={<IconArchive size={16} />}
                      onClick={onToggleArchiveIntent}
                      disabled={isSaving}
                    >
                      {archiveLabel}
                    </DepthButton>
                    <DepthButton
                      type="primary"
                      size="sm"
                      before={<IconDeviceFloppy size={16} />}
                      onClick={onSaveArticle}
                      disabled={isSaving}
                    >
                      {t("articleEditor.save")}
                    </DepthButton>
                  </>
                ) : null}
                <DepthButton
                  type="secondary"
                  size="sm"
                  before={<IconX size={16} />}
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
          {isError ? <Alert color="infini-warning" title={warningMessage} /> : null}

          {!isLoading && !isError ? (
            <Stack gap={12}>
              <TextInput
                label={t("articleEditor.titleField")}
                value={articleTitle}
                disabled={!canEdit}
                onChange={(event) => onArticleTitleChange(event.currentTarget.value)}
                placeholder={t("articleEditor.titleField")}
                aria-label="Wiki article title"
              />
              <Group gap={8} wrap="wrap">
                <Select
                  style={{ width: 260 }}
                  label={t("articleEditor.category")}
                  value={articleCategoryId || null}
                  disabled={!canEdit}
                  data={categoryOptions}
                  placeholder={t("articleEditor.category")}
                  aria-label="Wiki article category"
                  onChange={(value) => onArticleCategoryChange(value ?? "")}
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
              />
              {selectedArticle ? (
                <Stack gap={2}>
                  <Group gap={6}>
                    <Text size="sm">Wiki</Text>
                    <Text size="sm" c="dimmed">/</Text>
                    <Text size="sm">{selectedCategory?.name ?? t("articleEditor.categoryFallback")}</Text>
                    <Text size="sm" c="dimmed">/</Text>
                    <Text size="sm">{selectedArticle.title}</Text>
                  </Group>
                  <Text c="dimmed" size="sm">
                    {t("articleEditor.lastUpdatedBy", { user: selectedArticle.created_by, date: formatDateTime(selectedArticle.updated_at) })}
                  </Text>
                  {selectedArticle.archived_at ? (
                    <Text c="infini-warning" size="sm">
                      {t("articleEditor.archivedAt", { date: formatDateTime(selectedArticle.archived_at) })}
                    </Text>
                  ) : null}
                </Stack>
              ) : null}
              {canEdit && isCreatingArticle ? (
                <DepthButton
                  type="primary"
                  size="sm"
                  before={<IconPlus size={16} />}
                  onClick={onCreateArticle}
                  disabled={!canCreateArticle || isCreating}
                >
                  {t("articleEditor.create")}
                </DepthButton>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </div>
    </InfiniCard>
  );
}
