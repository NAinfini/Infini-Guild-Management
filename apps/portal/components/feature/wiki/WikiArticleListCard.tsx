import type { WikiArticle } from "@guild/shared";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Alert, Button, Group, Skeleton, Stack, Text } from "@mantine/core";
import { format } from "date-fns";
import type { ReactNode } from "react";
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
  isLoading,
  isError,
  warningMessage,
  articles,
  selectedSlug,
  emptyTitle,
  onSelectArticle,
}: WikiArticleListCardProps) {
  return (
    <InfiniCard className="wiki-article-list-card">
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={10}>
          <Group justify="space-between">
            <Text fw={600}>{title}</Text>
            {canEdit ? <Button onClick={onCreateArticle}>{createLabel}</Button> : null}
          </Group>
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
                  aria-label={`Open wiki article ${item.title}`}
                  aria-pressed={item.slug === selectedSlug}
                >
                  <Stack gap={0}>
                    <Group gap={6}>
                      <Text fw={600}>{item.title}</Text>
                      {item.archived_at ? (
                        <Text c="dimmed" size="sm">
                          ARCHIVED
                        </Text>
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
    </InfiniCard>
  );
}

