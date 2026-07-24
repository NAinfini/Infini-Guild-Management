import { ActionIcon, Badge, Button, Group, Highlight, Kbd, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure, useHotkeys, useLocalStorage } from "@mantine/hooks";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../api/query-keys";
import { searchGlobal, type SearchResult, type SearchResultType } from "../../services/SearchService";
import { buildEventWorkbenchSearch } from "../../utils/event-navigation";
import {
  CalendarOutlined,
  FileSearchOutlined,
  NotificationOutlined,
  PictureOutlined,
  SearchOutlined,
  TeamOutlined,
  UserOutlined,
} from "../../utils/icons";

type SearchItem = {
  id: string;
  title: string;
  subtitle: string;
  category: SearchResult["type"];
  role?: string;
  to: string;
  entityId?: string;
};

const RECENT_SEARCHES_KEY = "cmdk.recent.searches";
const RECENT_LIMIT = 8;
const RESULT_LIMIT = 24;

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

const CATEGORY_LABEL_KEY = {
  user: "cmdk.category.members",
  event: "cmdk.category.events",
  announcement: "cmdk.category.announcements",
  wiki: "cmdk.category.wiki",
  gallery: "cmdk.category.gallery",
  war: "cmdk.category.guildWar",
} as const satisfies Record<SearchResultType, string>;

const CATEGORY_ICON = {
  user: <UserOutlined />,
  event: <CalendarOutlined />,
  announcement: <NotificationOutlined />,
  wiki: <FileSearchOutlined />,
  gallery: <PictureOutlined />,
  war: <TeamOutlined />,
} satisfies Record<SearchResultType, ReactNode>;

const ROLE_BADGE_COLOR: Record<string, string> = { admin: "red", moderator: "orange" };

export function CmdKSearch({ asIcon = false }: { asIcon?: boolean }) {
  const navigate = useNavigate();
  const { t } = useTranslation("common");
  const [open, openHandlers] = useDisclosure(false);
  const { search: query, setSearch: setQuery, debouncedSearch: debouncedQuery } = useDebouncedSearch();
  const [recentSearches, setRecentSearches] = useLocalStorage<string[]>({
    key: RECENT_SEARCHES_KEY,
    defaultValue: [],
  });

  useHotkeys([["mod+k", openHandlers.toggle]]);

  const normalizedQuery = normalizeSearchText(debouncedQuery);
  const searchDataQuery = useQuery({
    queryKey: queryKeys.cmdk.search(normalizedQuery),
    enabled: open && normalizedQuery.length >= 2,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const response = await searchGlobal(normalizedQuery, RESULT_LIMIT);
      return response.data.map((entry): SearchItem => ({
        id: `${entry.type}-${entry.id}`,
        title: entry.title,
        subtitle: entry.subtitle,
        category: entry.type,
        role: entry.role,
        to: entry.to,
        entityId: entry.entity_id,
      }));
    },
  });

  const items = searchDataQuery.data ?? [];
  const loading = searchDataQuery.isLoading;

  const visibleItems = useMemo(() => {
    return items.slice(0, RESULT_LIMIT);
  }, [items]);

  const groupedItems = useMemo(() => {
    const groups = new Map<SearchItem["category"], SearchItem[]>();
    for (const item of visibleItems) {
      const list = groups.get(item.category) ?? [];
      list.push(item);
      groups.set(item.category, list);
    }
    return groups;
  }, [visibleItems]);

  const queryIsDebouncing = query !== debouncedQuery;

  const onSelectItem = (item: SearchItem) => {
    const normalized = normalizeSearchText(query);
    if (normalized) {
      setRecentSearches((previous) => {
        return [normalized, ...previous.filter((value) => value !== normalized)].slice(0, RECENT_LIMIT);
      });
    }
    openHandlers.close();
    setQuery("");
    if (item.category === "event" && item.entityId) {
      void navigate({
        to: "/events",
        search: buildEventWorkbenchSearch({
          id: item.entityId,
          title: item.title,
        }),
      });
      return;
    }
    void navigate({ to: item.to });
  };

  const categoryLabel = (category: SearchItem["category"]) => t(CATEGORY_LABEL_KEY[category]);

  const categoryIcon = (category: SearchItem["category"]) => CATEGORY_ICON[category];

  const roleBadgeColor = (role: string | undefined): string => ROLE_BADGE_COLOR[role ?? ""] ?? "blue";

  return (
    <>
      {asIcon ? (
        <ActionIcon variant="subtle" onClick={openHandlers.open} aria-label={t("cmdk.aria.openSearch")}>
          <SearchOutlined />
        </ActionIcon>
      ) : (
        <Button onClick={openHandlers.open} size="xs" aria-label={t("cmdk.aria.openSearch")} rightSection={
          <Group gap={2} wrap="nowrap">
            <Kbd size="xs">{isMac ? "Cmd" : "Ctrl"}</Kbd>
            <Kbd size="xs">K</Kbd>
          </Group>
        }>
          {t("cmdk.searchButton")}
        </Button>
      )}

      <Modal
        title={t("cmdk.searchTitle")}
        opened={open}
        onClose={openHandlers.close}
        size="640px"
        withCloseButton
      >
        <Command shouldFilter={false}>
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder={t("cmdk.searchPlaceholder")}
            aria-label={t("cmdk.aria.searchInput")}
            style={{
              width: "100%",
              border: "1px solid color-mix(in srgb, var(--color-text, #1A1815) 20%, transparent)",
              borderRadius: 8,
              padding: "10px 12px",
              marginTop: 4,
              marginBottom: 12,
            }}
          />

          <Command.List style={{ maxHeight: 360, overflow: "auto" }}>
            {loading || queryIsDebouncing ? <Text c="dimmed">{t("message.loading")}</Text> : null}
            {!loading && normalizedQuery.length >= 2 && visibleItems.length === 0 ? <Command.Empty>{t("cmdk.noResults")}</Command.Empty> : null}

            {query.length === 0 && recentSearches.length > 0 ? (
              <Command.Group heading={t("cmdk.recent")}>
                {recentSearches.map((recent) => (
                  <Command.Item
                    key={recent}
                    value={recent}
                    onSelect={() => setQuery(recent)}
                    style={{ borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}
                  >
                    <Group gap={8}>
                      <SearchOutlined />
                      <Text>{recent}</Text>
                    </Group>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            {Array.from(groupedItems.entries()).map(([category, group]) => (
              <Command.Group key={category} heading={categoryLabel(category)}>
                {group.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={`${item.category} ${item.title} ${item.subtitle}`}
                    onSelect={() => onSelectItem(item)}
                    style={{
                      borderRadius: 8,
                      padding: "8px 10px",
                      cursor: "pointer",
                    }}
                  >
                    <Stack gap={2} style={{ width: "100%" }}>
                      <Group align="center">
                        {categoryIcon(item.category)}
                        <Highlight highlight={query} fw={600}>{item.title}</Highlight>
                        <Badge color={item.category === "user" ? roleBadgeColor(item.role) : undefined}>
                          {item.category === "user" && item.role ? item.role : categoryLabel(item.category)}
                        </Badge>
                      </Group>
                      <Highlight highlight={query} c="dimmed" size="sm">
                        {item.subtitle}
                      </Highlight>
                    </Stack>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </Modal>
    </>
  );
}
