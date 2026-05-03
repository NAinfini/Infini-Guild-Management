import type {
  Announcement,
  CursorResponse,
  Event,
  GalleryItem,
  MemberProfile,
  PaginatedResponse,
  User,
  WarHistory,
  WikiArticle,
} from "@guild/shared";
import { ActionIcon, Badge, Button, Group, Highlight, Kbd, Modal, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { useMemo, useState } from "react";
import { useDebouncedValue, useDisclosure, useHotkeys, useLocalStorage } from "@mantine/hooks";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { apiRequest } from "../../api/client";
import { queryKeys } from "../../api/query-keys";
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
  body?: string;
  category: "user" | "event" | "announcement" | "wiki" | "gallery" | "war";
  role?: string;
  to: string;
  entityId?: string;
};

type UsersListResponse = PaginatedResponse<{ user: User; profile: MemberProfile }>;
const RECENT_SEARCHES_KEY = "cmdk.recent.searches";
const RECENT_LIMIT = 8;
const RESULT_LIMIT = 24;

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

export function CmdKSearch({ asIcon = false }: { asIcon?: boolean }) {
  const navigate = useNavigate();
  const { t } = useTranslation("common");
  const [open, openHandlers] = useDisclosure(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 300);
  const [recentSearches, setRecentSearches] = useLocalStorage<string[]>({
    key: RECENT_SEARCHES_KEY,
    defaultValue: [],
  });

  useHotkeys([["mod+k", openHandlers.toggle]]);

  const searchDataQuery = useQuery({
    queryKey: queryKeys.cmdk.searchData(),
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [usersResponse, eventsResponse, announcementsResponse, wikiResponse, warHistoryResponse, galleryResponse] =
        await Promise.allSettled([
          apiRequest<UsersListResponse>("/api/users?page=1&limit=40"),
          apiRequest<PaginatedResponse<Event>>("/api/events?page=1&limit=40"),
          apiRequest<PaginatedResponse<Announcement>>("/api/announcements?page=1&limit=25"),
          apiRequest<PaginatedResponse<WikiArticle>>("/api/wiki/articles?page=1&limit=25"),
          apiRequest<PaginatedResponse<WarHistory>>("/api/guild-war/history?page=1&limit=25"),
          apiRequest<CursorResponse<GalleryItem>>("/api/gallery?cursor=0&limit=25"),
        ]);

      const userItems: SearchItem[] = usersResponse.status === "fulfilled"
        ? usersResponse.value.data.map((entry) => ({
            id: `user-${entry.user.id}`,
            title: entry.user.username,
            subtitle: `${entry.user.role} · ${entry.profile.classes.join(", ") || t("noClass")}`,
            category: "user",
            role: entry.user.role,
            to: "/roster",
          }))
        : [];

      const eventItems: SearchItem[] = eventsResponse.status === "fulfilled"
        ? eventsResponse.value.data.map((entry) => ({
            id: `event-${entry.id}`,
            title: entry.title,
            subtitle: entry.type,
            category: "event",
            to: "/events",
            entityId: entry.id,
          }))
        : [];

      const announcementItems: SearchItem[] = announcementsResponse.status === "fulfilled"
        ? announcementsResponse.value.data.map((entry) => ({
            id: `announcement-${entry.id}`,
            title: entry.title,
            subtitle: entry.status,
            body: entry.body_json,
            category: "announcement",
            to: "/announcements",
          }))
        : [];

      const wikiItems: SearchItem[] = wikiResponse.status === "fulfilled"
        ? wikiResponse.value.data.map((entry) => ({
            id: `wiki-${entry.id}`,
            title: entry.title,
            subtitle: entry.slug,
            body: entry.body_json,
            category: "wiki",
            to: "/wiki",
          }))
        : [];

      const warItems: SearchItem[] = warHistoryResponse.status === "fulfilled"
        ? warHistoryResponse.value.data.map((entry) => ({
            id: `war-${entry.id}`,
            title: entry.war_name,
            subtitle: `${entry.result ?? t("unknown")} · ${entry.created_at.slice(0, 10)}`,
            category: "war",
            to: "/guild-war",
          }))
        : [];

      const galleryItems: SearchItem[] = galleryResponse.status === "fulfilled"
        ? galleryResponse.value.data.map((entry) => ({
            id: `gallery-${entry.id}`,
            title: entry.caption ?? entry.url.split("/").pop() ?? entry.id,
            subtitle: entry.type,
            category: "gallery",
            to: "/gallery",
          }))
        : [];

      return [
        ...userItems,
        ...eventItems,
        ...announcementItems,
        ...wikiItems,
        ...warItems,
        ...galleryItems,
      ];
    },
  });

  const items = searchDataQuery.data ?? [];
  const loading = searchDataQuery.isLoading;

  const visibleItems = useMemo(() => {
    const normalized = normalizeSearchText(debouncedQuery);
    if (!normalized) {
      return items.slice(0, RESULT_LIMIT);
    }

    return items
      .filter((item) => {
        const haystack = `${item.title} ${item.subtitle} ${item.body ?? ""} ${item.category}`.toLowerCase();
        return haystack.includes(normalized);
      })
      .slice(0, RESULT_LIMIT);
  }, [debouncedQuery, items]);

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

  const categoryLabel = (category: SearchItem["category"]) => {
    switch (category) {
      case "user":
        return t("cmdk.category.members");
      case "event":
        return t("cmdk.category.events");
      case "announcement":
        return t("cmdk.category.announcements");
      case "wiki":
        return t("cmdk.category.wiki");
      case "gallery":
        return t("cmdk.category.gallery");
      case "war":
        return t("cmdk.category.guildWar");
      default:
        return category;
    }
  };

  const categoryIcon = (category: SearchItem["category"]) => {
    switch (category) {
      case "user":
        return <UserOutlined />;
      case "event":
        return <CalendarOutlined />;
      case "announcement":
        return <NotificationOutlined />;
      case "wiki":
        return <FileSearchOutlined />;
      case "gallery":
        return <PictureOutlined />;
      case "war":
        return <TeamOutlined />;
      default:
        return <SearchOutlined />;
    }
  };

  const roleBadgeColor = (role: string | undefined): string => {
    switch (role) {
      case "admin":
        return "red";
      case "moderator":
        return "orange";
      default:
        return "blue";
    }
  };

  return (
    <>
      {asIcon ? (
        <ActionIcon variant="subtle" onClick={openHandlers.open} aria-label={t("cmdk.aria.openSearch")}>
          <SearchOutlined />
        </ActionIcon>
      ) : (
        <Button onClick={openHandlers.open} size="xs" aria-label={t("cmdk.aria.openSearch")} rightSection={
          <Group gap={2} wrap="nowrap">
            <Kbd size="xs">{isMac ? "⌘" : "Ctrl"}</Kbd>
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
              border: "1px solid color-mix(in srgb, var(--color-text, #111827) 20%, transparent)",
              borderRadius: 8,
              padding: "10px 12px",
              marginTop: 4,
              marginBottom: 12,
            }}
          />

          <Command.List style={{ maxHeight: 360, overflow: "auto" }}>
            {loading || queryIsDebouncing ? <Text c="dimmed">{t("message.loading")}</Text> : null}
            {!loading && visibleItems.length === 0 ? <Command.Empty>{t("cmdk.noResults")}</Command.Empty> : null}

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
                    value={`${item.category} ${item.title} ${item.subtitle} ${item.body ?? ""}`}
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

