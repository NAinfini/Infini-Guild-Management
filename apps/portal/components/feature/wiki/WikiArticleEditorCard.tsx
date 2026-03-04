import type { WikiArticle, WikiArticleVersion, WikiCategory } from "@guild/shared";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Alert, Badge, Button, Group, Select, Skeleton, Stack, Text, TextInput } from "@mantine/core";
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
  articleSortOrder: number;
  articleCategoryId: string;
  categoryOptions: CategoryOption[];
  isSaving: boolean;
  isArchiving: boolean;
  isCreating: boolean;
  canCreateArticle: boolean;
  onArticleTitleChange: (value: string) => void;
  onArticleBodyChange: (value: string) => void;
  onArticleSortOrderChange: (value: number) => void;
  onArticleCategoryChange: (value: string) => void;
  onSaveArticle: () => void;
  onArchiveArticle: () => void;
  onUnarchiveArticle: () => void;
  onCreateArticle: () => void;
  onImageUpload: (file: File) => Promise<string>;
  versionRows: WikiArticleVersion[];
  versionsLoading: boolean;
  versionsError: boolean;
  selectedFromVersionId: string;
  selectedToVersionId: string;
  versionCompareLoading: boolean;
  versionCompare: {
    from_version: WikiArticleVersion;
    to_version: WikiArticleVersion;
    changed_fields: string[];
  } | null;
  rollbackPending: boolean;
  onSelectFromVersionId: (value: string) => void;
  onSelectToVersionId: (value: string) => void;
  onRollbackToVersion: () => void;
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
  articleSortOrder,
  articleCategoryId,
  categoryOptions,
  isSaving,
  isArchiving,
  isCreating,
  canCreateArticle,
  onArticleTitleChange,
  onArticleBodyChange,
  onArticleSortOrderChange,
  onArticleCategoryChange,
  onSaveArticle,
  onArchiveArticle,
  onUnarchiveArticle,
  onCreateArticle,
  onImageUpload,
  versionRows,
  versionsLoading,
  versionsError,
  selectedFromVersionId,
  selectedToVersionId,
  versionCompareLoading,
  versionCompare,
  rollbackPending,
  onSelectFromVersionId,
  onSelectToVersionId,
  onRollbackToVersion,
  emptyTitle,
}: WikiArticleEditorCardProps) {
  const { t } = useTranslation("wiki");

  if (!selectedArticle && !(canEdit && isCreatingArticle)) {
    return (
      <InfiniCard className="wiki-article-editor-card">
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
    <InfiniCard className="wiki-article-editor-card">
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={12}>
          <Group justify="space-between" align="start">
            <Text fw={600}>{t("articleEditor.title")}</Text>
            {canEdit && selectedArticle ? (
              <Group gap={8} wrap="wrap">
                <MotionButton type="primary" onClick={onSaveArticle} loading={isSaving}>
                  {t("articleEditor.save")}
                </MotionButton>
                <Button
                  color="red"
                  onClick={onArchiveArticle}
                  loading={isArchiving}
                  disabled={Boolean(selectedArticle.archived_at)}
                >
                  {t("articleEditor.archive")}
                </Button>
                {selectedArticle.archived_at ? (
                  <Button onClick={onUnarchiveArticle} loading={isSaving}>
                    Unarchive
                  </Button>
                ) : null}
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
              <TextInput
                value={articleTitle}
                disabled={!canEdit}
                onChange={(event) => onArticleTitleChange(event.currentTarget.value)}
                placeholder={t("articleEditor.titleField")}
                aria-label="Wiki article title"
              />
              <Group gap={8} wrap="wrap">
                <Select
                  style={{ width: 260 }}
                  value={articleCategoryId || null}
                  disabled={!canEdit}
                  data={categoryOptions}
                  placeholder={t("articleEditor.category")}
                  aria-label="Wiki article category"
                  onChange={(value) => onArticleCategoryChange(value ?? "")}
                />
                <TextInput
                  style={{ width: 160 }}
                  type="number"
                  value={articleSortOrder}
                  disabled={!canEdit}
                  onChange={(event) => onArticleSortOrderChange(Number(event.currentTarget.value))}
                  placeholder={t("articleEditor.sortOrder")}
                  aria-label="Wiki article sort order"
                />
              </Group>
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
                    <Text size="sm">{selectedCategory?.name ?? "Category"}</Text>
                    <Text size="sm" c="dimmed">/</Text>
                    <Text size="sm">{selectedArticle.title}</Text>
                  </Group>
                  <Text c="dimmed" size="sm">
                    Last updated by {selectedArticle.created_by} on {formatDateTime(selectedArticle.updated_at)}
                  </Text>
                  {selectedArticle.archived_at ? (
                    <Text c="yellow" size="sm">
                      Archived at {formatDateTime(selectedArticle.archived_at)}
                    </Text>
                  ) : null}
                </Stack>
              ) : null}
              {selectedArticle ? (
                <InfiniCard className="wiki-version-history-card">
                  <div style={{ padding: "1.2rem" }}>
                    <Stack gap={8}>
                      <Text fw={600}>{t("version.title")}</Text>
                      {versionsLoading ? (
                        <Stack gap={6}>
                          {Array.from({ length: 4 }).map((_, index) => (
                            <Skeleton key={index} height={10} />
                          ))}
                        </Stack>
                      ) : null}
                      {versionsError ? <Alert color="yellow">{t("version.loadFailed")}</Alert> : null}
                      {!versionsLoading && !versionsError ? (
                        <>
                          <Group gap={8} wrap="wrap">
                            <Select
                              style={{ width: 220 }}
                              value={selectedFromVersionId || null}
                              data={versionRows.map((item) => ({
                                value: item.id,
                                label: `v${item.version_no} · ${item.source_action} · ${formatDateTime(item.created_at)}`,
                              }))}
                              placeholder={t("version.from")}
                              aria-label="Select wiki version A"
                              onChange={(value) => onSelectFromVersionId(value ?? "")}
                            />
                            <Select
                              style={{ width: 220 }}
                              value={selectedToVersionId || null}
                              data={versionRows.map((item) => ({
                                value: item.id,
                                label: `v${item.version_no} · ${item.source_action} · ${formatDateTime(item.created_at)}`,
                              }))}
                              placeholder={t("version.to")}
                              aria-label="Select wiki version B"
                              onChange={(value) => onSelectToVersionId(value ?? "")}
                            />
                            {canEdit ? (
                              <Button
                                color="orange"
                                onClick={onRollbackToVersion}
                                disabled={!selectedToVersionId}
                                loading={rollbackPending}
                              >
                                {t("version.rollback")}
                              </Button>
                            ) : null}
                          </Group>
                          {versionCompareLoading ? (
                            <Text c="dimmed" size="sm">
                              {t("version.comparing")}
                            </Text>
                          ) : null}
                          {versionCompare ? (
                            <Stack gap={4}>
                              <Group gap={6} wrap="wrap">
                                {versionCompare.changed_fields.length > 0 ? (
                                  versionCompare.changed_fields.map((field) => (
                                    <Badge key={field} color="blue" variant="light">
                                      {field}
                                    </Badge>
                                  ))
                                ) : (
                                  <Badge color="gray" variant="light">{t("version.noDiff")}</Badge>
                                )}
                              </Group>
                              <Text c="dimmed" size="sm">
                                v{versionCompare.from_version.version_no} → v{versionCompare.to_version.version_no}
                              </Text>
                            </Stack>
                          ) : null}
                          <Stack gap={4}>
                            {versionRows.slice(0, 8).map((row) => (
                              <Group key={row.id} justify="space-between" wrap="wrap">
                                <Group gap={6} wrap="wrap">
                                  <Badge variant="light" color="gray">v{row.version_no}</Badge>
                                  <Text size="sm">{row.source_action}</Text>
                                  <Text size="sm" c="dimmed">{formatDateTime(row.created_at)}</Text>
                                </Group>
                                <Group gap={6}>
                                  <Button size="xs" variant="light" onClick={() => onSelectFromVersionId(row.id)}>A</Button>
                                  <Button size="xs" variant="light" onClick={() => onSelectToVersionId(row.id)}>B</Button>
                                </Group>
                              </Group>
                            ))}
                          </Stack>
                        </>
                      ) : null}
                    </Stack>
                  </div>
                </InfiniCard>
              ) : null}
              {canEdit && isCreatingArticle ? (
                <MotionButton type="primary" onClick={onCreateArticle} loading={isCreating} disabled={!canCreateArticle}>
                  {t("articleEditor.create")}
                </MotionButton>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </div>
    </InfiniCard>
  );
}
