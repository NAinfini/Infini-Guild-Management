import type { WikiArticle } from "@guild/shared";
import { ActionIcon, Alert, Button, Group, HoverCard, Paper, Skeleton, Stack, Text, ThemeIcon, Tooltip } from "@mantine/core";
import { ArchiveIcon, PencilIcon, PinIcon, PlusIcon } from "@portal/components/icons";
import { formatDateTime } from "@portal/utils/datetime";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";

type WikiArticleListCardProps = {
  title: ReactNode;
  canCreateArticle: boolean;
  canManageCategories: boolean;
  createLabel: ReactNode;
  onCreateArticle: () => void;
  onOpenCategoryEditor: () => void;
  categoryOptions: Array<{ value: string; label: string }>;
  hasActiveFilters: boolean;
  resetFiltersLabel: ReactNode;
  onResetFilters: () => void;
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
  canCreateArticle,
  canManageCategories,
  createLabel,
  onCreateArticle,
  onOpenCategoryEditor,
  categoryOptions,
  hasActiveFilters,
  resetFiltersLabel,
  onResetFilters,
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
    <Paper withBorder radius="md" p="var(--card-padding)" className="wiki-article-list-card">
      {/* 卡头钉住、清单内滚：新建文章和编辑分类是随时要够得着的，跟着列表滚走等于没有。 */}
      <div className="wiki-card-body">
        <Group justify="space-between">
          <Text fw={600}>{title}</Text>
          {canCreateArticle || canManageCategories ? (
            <Group gap={6}>
              {canCreateArticle ? (
                <Tooltip label={createLabel} withArrow>
                  <ActionIcon size={44} onClick={onCreateArticle} aria-label={t("articleEditor.create")}>
                    <PlusIcon size={16} />
                  </ActionIcon>
                </Tooltip>
              ) : null}
              {canManageCategories ? (
                <Tooltip label={t("editor.editCategories")} withArrow>
                  <ActionIcon size={44} variant="default" onClick={onOpenCategoryEditor} aria-label={t("editor.editCategories")}>
                    <PencilIcon size={16} />
                  </ActionIcon>
                </Tooltip>
              ) : null}
            </Group>
          ) : null}
        </Group>
        <Stack gap={10} className="wiki-card-scroll">
          {isLoading ? (
            <Stack gap={8}>
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} height={12} />
              ))}
            </Stack>
          ) : null}
          {isError ? <Alert color="red" title={warningMessage} /> : null}
          {!isLoading && !isError ? (
            <Stack gap={6}>
              {articles.length === 0 ? (
                <EmptyState
                  title={emptyTitle}
                  actions={hasActiveFilters ? (
                    <Button onClick={onResetFilters}>{resetFiltersLabel}</Button>
                  ) : categoryOptions.length === 0 && canManageCategories ? (
                    <Button onClick={onOpenCategoryEditor}>
                      {t("editor.editCategories")}
                    </Button>
                  ) : canCreateArticle && categoryOptions.length > 0 ? (
                    <Button
                      onClick={onCreateArticle}
                    >
                      {createLabel}
                    </Button>
                  ) : undefined}
                />
              ) : null}
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
                            <ThemeIcon variant="transparent" color="portal-brand" size="sm" style={{ cursor: "default" }} data-animate-icon-trigger>
                              <PinIcon size={14} aria-hidden />
                            </ThemeIcon>
                          </HoverCard.Target>
                          <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                            <Group gap={10} wrap="nowrap" align="flex-start">
                              <ThemeIcon variant="light" color="portal-brand" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
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
    </Paper>
  );
}
