import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Highlight,
  Kbd,
  Modal,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useDisclosure, useHotkeys, useLocalStorage } from "@mantine/hooks";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../api/query-keys";
import { searchGlobal, type SearchResult, type SearchResultType } from "../../services/SearchService";
import { buildEventWorkbenchSearch } from "../../utils/event-navigation";
import styles from "./CmdKSearch.module.css";
import { userScopedStorageKey } from "../../session-storage";
import { useAuthStore } from "../../stores/auth";
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
  roleName?: string;
  roleColor?: string | null;
  roleLevel?: number;
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

export function CmdKSearch({ asIcon = false }: { asIcon?: boolean }) {
  const navigate = useNavigate();
  const { t } = useTranslation("common");
  const [open, openHandlers] = useDisclosure(false);
  const { search: query, setSearch: setQuery, debouncedSearch: debouncedQuery } = useDebouncedSearch();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [recentSearches, setRecentSearches] = useLocalStorage<string[]>({
    key: userScopedStorageKey(RECENT_SEARCHES_KEY, currentUserId),
    defaultValue: [],
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const [suppressInitialFocusRing, setSuppressInitialFocusRing] = useState(true);
  const resultsId = useId();

  const openSearch = () => {
    setSuppressInitialFocusRing(true);
    openHandlers.open();
  };

  const closeSearch = () => {
    setSuppressInitialFocusRing(true);
    openHandlers.close();
  };

  const toggleSearch = () => {
    setSuppressInitialFocusRing(true);
    openHandlers.toggle();
  };

  useHotkeys([["mod+k", toggleSearch]]);

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
        roleName: entry.role_name,
        roleColor: entry.role_color,
        roleLevel: entry.role_level,
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
  const orderedItems = useMemo(
    () => Array.from(groupedItems.values()).flat(),
    [groupedItems],
  );

  const queryIsDebouncing = query !== debouncedQuery;
  const showingRecent = query.length === 0 && recentSearches.length > 0;
  const optionCount = showingRecent ? recentSearches.length : orderedItems.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, optionCount]);

  const onSelectItem = (item: SearchItem) => {
    const normalized = normalizeSearchText(query);
    if (normalized) {
      setRecentSearches((previous) => {
        return [normalized, ...previous.filter((value) => value !== normalized)].slice(0, RECENT_LIMIT);
      });
    }
    closeSearch();
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

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (optionCount === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % optionCount);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + optionCount) % optionCount);
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    if (showingRecent) {
      const recent = recentSearches[activeIndex];
      if (recent) {
        setQuery(recent);
      }
      return;
    }

    const item = orderedItems[activeIndex];
    if (item) {
      onSelectItem(item);
    }
  };

  return (
    <>
      {asIcon ? (
        <ActionIcon
          variant="subtle"
          className="app-header-icon-btn"
          onClick={openSearch}
          aria-label={t("cmdk.aria.openSearch")}
        >
          <SearchOutlined />
        </ActionIcon>
      ) : (
        /* Search is a utility, not the page's primary action — a gold fill here
           competed with the real primary button on every single page. */
        <Button variant="default" onClick={openSearch} size="xs" aria-label={t("cmdk.searchButton")} rightSection={
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
        onClose={closeSearch}
        size="640px"
        withCloseButton
        classNames={{ body: styles.modalBody, title: styles.modalTitle }}
      >
        <Stack gap="sm">
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t("cmdk.searchPlaceholder")}
            aria-label={t("cmdk.aria.searchInput")}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={resultsId}
            aria-expanded={open}
            aria-activedescendant={optionCount > 0 ? `${resultsId}-option-${activeIndex}` : undefined}
            leftSection={<SearchOutlined />}
            data-autofocus
            data-silent-autofocus={suppressInitialFocusRing ? "true" : undefined}
            onBlur={() => setSuppressInitialFocusRing(false)}
            classNames={{ input: styles.searchInput }}
          />

          <ScrollArea.Autosize mah={360} id={resultsId} role="listbox">
            <Stack gap={4}>
              {loading || queryIsDebouncing ? <Text c="dimmed" px="sm" py="xs">{t("message.loading")}</Text> : null}
              {!loading && normalizedQuery.length >= 2 && visibleItems.length === 0
                ? <Text c="dimmed" px="sm" py="xs">{t("cmdk.noResults")}</Text>
                : null}

              {showingRecent ? (
                <Stack gap={4}>
                  <Text size="xs" fw={600} c="dimmed" px="sm">
                    {t("cmdk.recent")}
                  </Text>
                  {recentSearches.map((recent, index) => (
                    <NavLink
                      key={recent}
                      id={`${resultsId}-option-${index}`}
                      role="option"
                      aria-selected={activeIndex === index}
                      active={activeIndex === index}
                      label={recent}
                      leftSection={<SearchOutlined />}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => setQuery(recent)}
                    />
                  ))}
                </Stack>
              ) : null}

              {Array.from(groupedItems.entries()).map(([category, group]) => (
                <Stack key={category} gap={4}>
                  <Text size="xs" fw={600} c="dimmed" px="sm" pt="xs">
                    {categoryLabel(category)}
                  </Text>
                  {group.map((item) => {
                    const itemIndex = orderedItems.indexOf(item);
                    return (
                      <NavLink
                        key={item.id}
                        id={`${resultsId}-option-${itemIndex}`}
                        role="option"
                        aria-selected={activeIndex === itemIndex}
                        active={activeIndex === itemIndex}
                        label={<Highlight highlight={query} fw={600}>{item.title}</Highlight>}
                        description={<Highlight highlight={query}>{item.subtitle}</Highlight>}
                        leftSection={categoryIcon(item.category)}
                        rightSection={(
                          <Badge color={item.category === "user" ? item.roleColor ?? "gray" : undefined}>
                            {item.category === "user" ? item.roleName ?? categoryLabel(item.category) : categoryLabel(item.category)}
                          </Badge>
                        )}
                        onMouseEnter={() => setActiveIndex(itemIndex)}
                        onClick={() => onSelectItem(item)}
                      />
                    );
                  })}
                </Stack>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Modal>
    </>
  );
}
