import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../api/query-keys";
import { userScopedStorageKey } from "../../session-storage";
import { searchGlobal, type SearchResult, type SearchResultType } from "../../services/SearchService";
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
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { XIcon } from "../icons";
import styles from "./CmdKSearch.module.css";

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

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function readRecentSearches(storageKey: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map(normalizeSearchText)
      .filter(Boolean)
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function persistRecentSearches(storageKey: string, searches: readonly string[]): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(searches));
  } catch {
    // Search history is a convenience only; unavailable storage must not block navigation.
  }
}

function HighlightedText({ value, query }: { value: string; query: string }) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return value;

  const parts = value.split(new RegExp("(" + escapeRegExp(normalizedQuery) + ")", "ig"));
  return (
    <>
      {parts.map((part, index) => (
        normalizeSearchText(part) === normalizedQuery ? (
          <mark key={part + "-" + index} className={styles.highlight}>{part}</mark>
        ) : part
      ))}
    </>
  );
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
  const currentUserId = useAuthStore((state) => state.user?.id);
  const storageKey = useMemo(
    () => userScopedStorageKey(RECENT_SEARCHES_KEY, currentUserId),
    [currentUserId],
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [suppressInitialFocusRing, setSuppressInitialFocusRing] = useState(true);
  const resultsId = useId();

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const refreshRecentSearches = () => setRecentSearches(readRecentSearches(storageKey));
    refreshRecentSearches();

    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) refreshRecentSearches();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const setSearchOpen = useCallback((nextOpen: boolean) => {
    setSuppressInitialFocusRing(true);
    setOpen(nextOpen);
  }, []);

  const openSearch = useCallback(() => setSearchOpen(true), [setSearchOpen]);
  const closeSearch = useCallback(() => setSearchOpen(false), [setSearchOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      event.preventDefault();
      setSearchOpen(!open);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setSearchOpen]);

  const normalizedQuery = normalizeSearchText(debouncedQuery);
  const searchDataQuery = useQuery({
    queryKey: queryKeys.cmdk.search(normalizedQuery),
    enabled: open && normalizedQuery.length >= 2,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const response = await searchGlobal(normalizedQuery, RESULT_LIMIT);
      return response.data.map((entry): SearchItem => ({
        id: entry.type + "-" + entry.id,
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
  const visibleItems = useMemo(() => items.slice(0, RESULT_LIMIT), [items]);
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
  const showingRecent = query.length === 0 && recentSearches.length > 0;
  const hasSearchQuery = normalizeSearchText(query).length >= 2;

  const rememberSearch = useCallback((value: string) => {
    const normalized = normalizeSearchText(value);
    if (!normalized) return;
    setRecentSearches((previous) => {
      const next = [normalized, ...previous.filter((entry) => entry !== normalized)].slice(0, RECENT_LIMIT);
      persistRecentSearches(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const onSelectItem = useCallback((item: SearchItem) => {
    rememberSearch(query);
    closeSearch();
    setQuery("");
    if (item.category === "event" && item.entityId) {
      void navigate({
        to: "/events/$id",
        params: { id: item.entityId },
      });
      return;
    }
    void navigate({ to: item.to });
  }, [closeSearch, navigate, query, rememberSearch]);

  const categoryLabel = (category: SearchItem["category"]) => t(CATEGORY_LABEL_KEY[category]);

  return (
    <Dialog open={open} onOpenChange={setSearchOpen}>
      {asIcon ? (
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon-lg"
          className="app-header-icon-btn"
          onClick={openSearch}
          aria-label={t("cmdk.aria.openSearch")}
        >
          <SearchOutlined />
        </Button>
      ) : (
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          size="xs"
          className={styles.desktopTrigger}
          onClick={openSearch}
          aria-label={t("cmdk.searchButton")}
        >
          <span>{t("cmdk.searchButton")}</span>
          <span className={styles.shortcut} aria-hidden="true">
            <kbd>{isMac ? "Cmd" : "Ctrl"}</kbd>
            <kbd>K</kbd>
          </span>
        </Button>
      )}

      <DialogContent
        className={styles.dialogContent}
        initialFocus={inputRef}
        finalFocus={triggerRef}
        showCloseButton={false}
      >
        <DialogHeader className={styles.dialogHeader}>
          <DialogTitle className={styles.modalTitle}>{t("cmdk.searchTitle")}</DialogTitle>
          <DialogClose
            aria-label={t("action.close")}
            render={<Button type="button" variant="ghost" size="icon-sm" className={styles.closeButton} />}
          >
            <XIcon aria-hidden="true" />
          </DialogClose>
        </DialogHeader>

        <Command label={t("cmdk.aria.searchInput")} shouldFilter={false} loop className={styles.command}>
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={t("cmdk.searchPlaceholder")}
            aria-label={t("cmdk.aria.searchInput")}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={resultsId}
            aria-expanded={open}
            className={styles.searchInput}
            data-silent-autofocus={suppressInitialFocusRing ? "true" : undefined}
            onBlur={() => setSuppressInitialFocusRing(false)}
          />

          <CommandList id={resultsId} className={styles.resultList}>
            {loading || queryIsDebouncing ? (
              <p className={styles.statusMessage}>{t("message.loading")}</p>
            ) : null}
            {!loading && hasSearchQuery && visibleItems.length === 0 ? (
              <p className={styles.statusMessage}>{t("cmdk.noResults")}</p>
            ) : null}

            {showingRecent ? (
              <CommandGroup heading={t("cmdk.recent")} className={styles.resultGroup}>
                {recentSearches.map((recent) => (
                  <CommandItem
                    key={recent}
                    value={"recent:" + recent}
                    className={styles.resultOption}
                    onSelect={() => setQuery(recent)}
                  >
                    <span className={styles.resultIcon} aria-hidden="true"><SearchOutlined /></span>
                    <span className={styles.resultCopy}>{recent}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {hasSearchQuery ? Array.from(groupedItems.entries()).map(([category, group]) => (
              <CommandGroup key={category} heading={categoryLabel(category)} className={styles.resultGroup}>
                {group.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    className={styles.resultOption}
                    onSelect={() => onSelectItem(item)}
                  >
                    <span className={styles.resultIcon} aria-hidden="true">{CATEGORY_ICON[item.category]}</span>
                    <span className={styles.resultCopy}>
                      <span className={styles.resultTitle}>
                        <HighlightedText value={item.title} query={query} />
                      </span>
                      <span className={styles.resultSubtitle}>
                        <HighlightedText value={item.subtitle} query={query} />
                      </span>
                    </span>
                    <Badge
                      variant="outline"
                      className={styles.categoryBadge}
                      style={item.category === "user" && item.roleColor
                        ? { borderColor: item.roleColor, color: item.roleColor }
                        : undefined}
                    >
                      {item.category === "user" ? item.roleName ?? categoryLabel(item.category) : categoryLabel(item.category)}
                    </Badge>
                  </CommandItem>
                ))}
              </CommandGroup>
            )) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
