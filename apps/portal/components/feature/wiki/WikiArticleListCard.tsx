import type { WikiArticle } from "@guild/shared";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { PortalCard } from "../../shared/PortalCard";
import { Alert, Group, MultiSelect, Skeleton, Stack, Text, Tooltip, VisuallyHidden } from "@mantine/core";
import { IconArchive, IconEdit, IconPinned, IconPlus } from "@tabler/icons-react";
import { format } from "date-fns";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

type WikiArticleListCardProps = {
  title: ReactNode;
  canEdit: boolean;
  createLabel: ReactNode;
  onCreateArticle: () => void;
  onOpenCategoryEditor: () => void;
  categoryOptions: Array<{ value: string; label: string }>;
  selectedCategoryIds: string[];
  onCategoryFilterChange: (values: string[]) => void;
  isLoading: boolean;
  isError: boolean;
  warningMessage: ReactNode;
  articles: WikiArticle[];
  selectedSlug: string | null;
  emptyTitle: ReactNode;
  onSelectArticle: (slug: string) => void;
};

export function WikiArticleListCard({
  title,
  canEdit,
  createLabel,
  onCreateArticle,
  onOpenCategoryEditor,
  categoryOptions,
  selectedCategoryIds,
  onCategoryFilterChange,
  isLoading,
  isError,
  warningMessage,
  articles,
  selectedSlug,
  emptyTitle,
  onSelectArticle,
}: WikiArticleListCardProps) {
  const { t } = useTranslation("wiki");

  return (
    <PortalCard className="wiki-article-list-card" interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={10}>
          <Group justify="space-between">
            <Text fw={600}>{title}</Text>
            {canEdit ? (
              <Group gap={6}>
                <DepthButton type="secondary" size="sm" onClick={onCreateArticle} tooltip={{ label: createLabel, withArrow: true }}>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <IconPlus size={16} />
                    </span>
                    <VisuallyHidden>{createLabel}</VisuallyHidden>
                  </DepthButton>
                <DepthButton type="secondary" size="sm" onClick={onOpenCategoryEditor} tooltip={{ label: t("editor.editCategories"), withArrow: true }}>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <IconEdit size={16} />
                    </span>
                    <VisuallyHidden>{t("editor.editCategories")}</VisuallyHidden>
                  </DepthButton>
              </Group>
            ) : null}
          </Group>
          <MultiSelect
            clearable
            searchable
            placeholder={t("filter.allCategories")}
            aria-label={t("filter.categories")}
            value={selectedCategoryIds}
            onChange={onCategoryFilterChange}
            data={categoryOptions}
          />
          {isLoading ? (
            <Stack gap={8}>
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} height={12} />
              ))}
            </Stack>
          ) : null}
          {isError ? <Alert color="infini-warning" title={warningMessage} /> : null}
          {!isLoading && !isError ? (
            <Stack gap={6}>
              {articles.length === 0 ? <EmptyState title={emptyTitle} /> : null}
              {articles.map((item) => (
                <button
                  key={item.slug}
                  type="button"
                  className={`wiki-article-item ${item.slug === selectedSlug ? "wiki-article-item--active" : ""}`}
                  onClick={() => onSelectArticle(item.slug)}
                  aria-label={`Open wiki article ${item.title}`}
                  aria-pressed={item.slug === selectedSlug}
                >
                  <Stack gap={0}>
                    <Group gap={6}>
                      <Text fw={600}>{item.title}</Text>
                      {item.pinned ? (
                        <Tooltip label={t("articleEditor.pinned")} withArrow>
                          <Text c="infini-primary" style={{ display: "inline-flex", alignItems: "center" }}>
                            <IconPinned size={14} aria-hidden />
                          </Text>
                        </Tooltip>
                      ) : null}
                      {item.archived_at ? (
                        <Tooltip label={t("articleEditor.archived")} withArrow>
                          <Text c="infini-warning" style={{ display: "inline-flex", alignItems: "center" }}>
                            <IconArchive size={14} aria-hidden />
                          </Text>
                        </Tooltip>
                      ) : null}
                    </Group>
                    <Text c="dimmed" size="xs">
                      {formatDateTime(item.updated_at)}
                    </Text>
                  </Stack>
                </button>
              ))}
            </Stack>
          ) : null}
        </Stack>
      </div>
    </PortalCard>
  );
}
