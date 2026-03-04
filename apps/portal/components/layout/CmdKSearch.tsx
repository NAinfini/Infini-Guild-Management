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
import { Badge, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { Command } from "cmdk";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { apiRequest } from "../../api/client";
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
  to: string;
};

type UsersListResponse = PaginatedResponse<{ user: User; profile: MemberProfile }>;
const RECENT_SEARCHES_KEY = "cmdk.recent.searches";
const RECENT_LIMIT = 8;
const RESULT_LIMIT = 24;

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function writeRecentSearches(items: string[]): void {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(items.slice(0, RECENT_LIMIT)));
  } catch {
    // Ignore storage errors and keep in-memory state.
  }
}

export function CmdKSearch() {
  const navigate = useNavigate();
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };

    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!open || items.length > 0 || loading) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [usersResponse, eventsResponse, announcementsResponse, wikiResponse, warHistoryResponse, galleryResponse] = await Promise.all([
          apiRequest<UsersListResponse>("/api/users?page=1&limit=40"),
          apiRequest<PaginatedResponse<Event>>("/api/events?page=1&limit=40"),
          apiRequest<PaginatedResponse<Announcement>>("/api/announcements?page=1&limit=25"),
          apiRequest<PaginatedResponse<WikiArticle>>("/api/wiki/articles?page=1&limit=25"),
          apiRequest<PaginatedResponse<WarHistory>>("/api/guild-war/history?page=1&limit=25"),
          apiRequest<CursorResponse<GalleryItem>>("/api/gallery?cursor=0&limit=25"),
        ]);

        if (cancelled) {
          return;
        }

        const userItems: SearchItem[] = usersResponse.data.map((entry) => ({
          id: `user-${entry.user.id}`,
          title: entry.user.username,
          subtitle: `${entry.user.role} · ${entry.profile.classes.join(", ") || "no class"} · ${
            entry.profile.wechat_name ?? "-"
          }`,
          category: "user",
          to: "/roster",
        }));

        const eventItems: SearchItem[] = eventsResponse.data.map((entry) => ({
          id: `event-${entry.id}`,
          title: entry.title,
          subtitle: entry.type,
          category: "event",
          to: `/events/${entry.id}`,
        }));

        const announcementItems: SearchItem[] = announcementsResponse.data.map((entry) => ({
          id: `announcement-${entry.id}`,
          title: entry.title,
          subtitle: entry.status,
          body: entry.body_json,
          category: "announcement",
          to: "/announcements",
        }));

        const wikiItems: SearchItem[] = wikiResponse.data.map((entry) => ({
          id: `wiki-${entry.id}`,
          title: entry.title,
          subtitle: entry.slug,
          body: entry.body_json,
          category: "wiki",
          to: "/wiki",
        }));

        const warItems: SearchItem[] = warHistoryResponse.data.map((entry) => ({
          id: `war-${entry.id}`,
          title: entry.war_name,
          subtitle: `${entry.result ?? "unknown"} · ${entry.created_at.slice(0, 10)}`,
          category: "war",
          to: "/guild-war",
        }));

        const galleryItems: SearchItem[] = galleryResponse.data.map((entry) => ({
          id: `gallery-${entry.id}`,
          title: entry.caption ?? entry.url.split("/").pop() ?? entry.id,
          subtitle: entry.type,
          category: "gallery",
          to: "/gallery",
        }));

        setItems([
          ...userItems,
          ...eventItems,
          ...announcementItems,
          ...wikiItems,
          ...warItems,
          ...galleryItems,
        ]);
      } catch {
        if (!cancelled) {
          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [items.length, loading, open]);

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
        const next = [normalized, ...previous.filter((value) => value !== normalized)].slice(0, RECENT_LIMIT);
        writeRecentSearches(next);
        return next;
      });
    }
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
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

  return (
    <>
      <Button onClick={() => setOpen(true)} size="xs" aria-label="Open global search">
        Search (Ctrl+K)
      </Button>

      <Modal
        title="Search"
        opened={open}
        onClose={() => setOpen(false)}
        size="640px"
        withCloseButton
      >
        <Command>
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search users, events, announcements, wiki, gallery..."
            aria-label="Search guild content"
            style={{
              width: "100%",
              border: "1px solid color-mix(in srgb, var(--infini-color-text, #111827) 20%, transparent)",
              borderRadius: 8,
              padding: "10px 12px",
              marginTop: 4,
              marginBottom: 12,
            }}
          />

          <Command.List style={{ maxHeight: 360, overflow: "auto" }}>
            {loading || queryIsDebouncing ? <Text c="dimmed">Loading...</Text> : null}
            {!loading && visibleItems.length === 0 ? <Command.Empty>No results</Command.Empty> : null}

            {query.length === 0 && recentSearches.length > 0 ? (
              <Command.Group heading="Recent">
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
                        <Text fw={600}>{item.title}</Text>
                        <Badge>{categoryLabel(item.category)}</Badge>
                      </Group>
                      <Text c="dimmed" size="sm">
                        {item.subtitle}
                      </Text>
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

