import type { WikiArticle } from "@guild/shared";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { PortalCard } from "../../shared/PortalCard";
import { Alert, Button, Group, HoverCard, MultiSelect, Skeleton, Stack, Text, ThemeIcon, VisuallyHidden } from "@mantine/core";
import { ArchiveIcon, PencilIcon, PinIcon, PlusIcon } from "@portal/components/icons";
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
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
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
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
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
                <DepthButton type="primary" size="sm" onClick={onCreateArticle} tooltip={{ label: createLabel, withArrow: true }}>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <PlusIcon size={16} />
                    </span>
                    <VisuallyHidden>{createLabel}</VisuallyHidden>
                  </DepthButton>
                <DepthButton type="secondary" size="sm" onClick={onOpenCategoryEditor} tooltip={{ label: t("editor.editCategories"), withArrow: true }}>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <PencilIcon size={16} />
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
          {isError ? <Alert color="yellow" title={warningMessage} /> : null}
          {!isLoading && !isError ? (
            <Stack gap={6}>
              {articles.length === 0 ? <EmptyState title={emptyTitle} /> : null}
              {articles.map((item) => (
                <button
                  key={item.slug}
                  type="button"
                  className={`wiki-article-item ${item.slug === selectedSlug ? "wiki-article-item--active" : ""}`}
                  onClick={() => onSelectArticle(item.slug)}
                  aria-label={t("aria.openArticle", { title: item.title })}
                  aria-pressed={item.slug === selectedSlug}
                >
                  <Stack gap={0}>
                    <Group gap={6}>
                      <Text fw={600}>{item.title}</Text>
                      {item.pinned ? (
                        <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                          <HoverCard.Target>
                            <ThemeIcon variant="transparent" color="orange" size="sm" style={{ cursor: "default" }} data-animate-icon-trigger>
                              <PinIcon size={14} aria-hidden />
                            </ThemeIcon>
                          </HoverCard.Target>
                          <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                            <Group gap={10} wrap="nowrap" align="flex-start">
                              <ThemeIcon variant="light" color="orange" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                                <PinIcon size={16} />
                              </ThemeIcon>
                              <div style={{ minWidth: 0 }}>
                                <Text size="sm" fw={700} lh={1.3} mb={4}>{t("hovercard.pinned.title")}</Text>
                                <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.pinned.desc")}</Text>
                              </div>
                            </Group>
                          </HoverCard.Dropdown>
                        </HoverCard>
                      ) : null}
                      {item.archived_at ? (
                        <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                          <HoverCard.Target>
                            <ThemeIcon variant="transparent" color="gray" size="sm" style={{ cursor: "default" }} data-animate-icon-trigger>
                              <ArchiveIcon size={14} aria-hidden />
                            </ThemeIcon>
                          </HoverCard.Target>
                          <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                            <Group gap={10} wrap="nowrap" align="flex-start">
                              <ThemeIcon variant="light" color="gray" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                                <ArchiveIcon size={16} />
                              </ThemeIcon>
                              <div style={{ minWidth: 0 }}>
                                <Text size="sm" fw={700} lh={1.3} mb={4}>{t("hovercard.archived.title")}</Text>
                                <Text size="xs" c="dimmed" lh={1.5}>{t("hovercard.archived.desc")}</Text>
                              </div>
                            </Group>
                          </HoverCard.Dropdown>
                        </HoverCard>
                      ) : null}
                    </Group>
                    <Text c="dimmed" size="xs">
                      {formatDateTime(item.updated_at)}
                      {item.updated_by_username ? ` · ${item.updated_by_username}` : null}
                    </Text>
                  </Stack>
                </button>
              ))}
              {hasMore && onLoadMore ? (
                <Button
                  variant="subtle"
                  size="xs"
                  loading={isLoadingMore}
                  onClick={onLoadMore}
                  style={{ alignSelf: "center" }}
                >
                  {t("action.loadMore")}
                </Button>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </div>
    </PortalCard>
  );
}
