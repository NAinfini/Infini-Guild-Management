import type { MemberProfile, User } from "@guild/shared";
import { CLASS_NAMES, hasRoleAtLeast } from "@guild/shared";
import { DepthToggle, StaggerList } from "@infini-dev-kit/react";
import { PortalCard } from "../shared/PortalCard";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Button,
  Group,
  MultiSelect,
  Select,
  Slider,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue, useLocalStorage } from "@mantine/hooks";
import { IconSearch } from "@tabler/icons-react";
import { motion } from "motion/react";
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { useTranslation } from "react-i18next";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { queryKeys } from "../../services/PortalQueryKeys";
import { fetchUsersListWithOptions } from "../../services/UserService";
import { useAuthStore } from "../../stores/auth";
import { VolumeOutlined, VolumeMutedOutlined } from "../../utils/icons";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import { MemberCard } from "../shared/MemberCard";
import "./RosterPage.css";

const LazyProfileModal = lazy(() =>
  import("../shared/ProfileModal").then((mod) => ({ default: mod.ProfileModal })),
);

const rosterCardVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
} as const;

type RosterEntry = { user: User; profile: MemberProfile };
const ROSTER_FILTERS_KEY = "roster.filters";
const ROSTER_SORT_MODES = ["power", "username", "class"] as const;

type RosterSortMode = (typeof ROSTER_SORT_MODES)[number];
type HoverPreviewState = {
  username: string;
  source: string;
};

function readStoredClassFilter(): string[] {
  try {
    const raw = localStorage.getItem(ROSTER_FILTERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const list = (parsed as { classFilter?: unknown }).classFilter;
    if (!Array.isArray(list)) return [];
    return list
      .filter((value): value is string => typeof value === "string")
      .filter((value) => CLASS_NAMES.includes(value as (typeof CLASS_NAMES)[number]));
  } catch {
    return [];
  }
}

function readStoredSortMode(): RosterSortMode {
  try {
    const raw = localStorage.getItem(ROSTER_FILTERS_KEY);
    if (!raw) return "power";
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return "power";
    const sortMode = (parsed as { sortMode?: unknown }).sortMode;
    if (ROSTER_SORT_MODES.includes(sortMode as RosterSortMode)) return sortMode as RosterSortMode;
    return "power";
  } catch {
    return "power";
  }
}

function resolveColumnCount(width: number): number {
  if (width >= 1600) return 8;
  if (width >= 1200) return 6;
  if (width >= 992) return 4;
  if (width >= 768) return 3;
  if (width >= 576) return 2;
  return 1;
}

function chunkEntries(entries: RosterEntry[], columns: number): RosterEntry[][] {
  if (columns <= 1) return entries.map((entry) => [entry]);
  const rows: RosterEntry[][] = [];
  for (let index = 0; index < entries.length; index += columns) {
    rows.push(entries.slice(index, index + columns));
  }
  return rows;
}

export function RosterPage() {
  const { t } = useTranslation("roster");
  const navigate = useNavigate();
  const isExternalView = useExternalView();
  const sessionUser = useAuthStore((state) => state.user);
  const [search, setSearch] = useState("");
  const [debouncedSearchRaw] = useDebouncedValue(search, 300);
  const debouncedSearch = debouncedSearchRaw.trim().toLowerCase();
  const [classFilter, setClassFilter] = useState<string[]>(() => readStoredClassFilter());
  const [sortMode, setSortMode] = useState<RosterSortMode>(() => readStoredSortMode());
  const [visibleCount, setVisibleCount] = useState(20);
  const [audioMuted, setAudioMuted] = useLocalStorage<boolean>({ key: "roster.audio.muted", defaultValue: false });
  const [audioVolume, setAudioVolume] = useLocalStorage<number>({ key: "roster.audio.volume", defaultValue: 70 });
  const hoverAudioRef = useRef<HTMLAudioElement | null>(null);
  const hoverAudioDebounceRef = useRef<number | null>(null);
  const hoverAudioStopDebounceRef = useRef<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null);
  const [selected, setSelected] = useState<{ user: User; profile: MemberProfile } | null>(null);
  const [windowWidth, setWindowWidth] = useState(() => typeof window === "undefined" ? 1920 : window.innerWidth);
  const virtualScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const usersQuery = useQuery({
    queryKey: queryKeys.users.roster(isExternalView ? "external" : "default"),
    queryFn: () => fetchUsersListWithOptions({ externalView: isExternalView }),
  });
  useLoadWarningToast(usersQuery.isError, t("common:loadErrorRetry"));

  useEffect(() => {
    if (hoverAudioRef.current) {
      hoverAudioRef.current.volume = audioVolume / 100;
      hoverAudioRef.current.muted = audioMuted;
      if (audioMuted && !hoverAudioRef.current.paused) {
        hoverAudioRef.current.pause();
      }
    }
  }, [audioMuted, audioVolume]);

  useEffect(() => {
    return () => {
      if (hoverAudioDebounceRef.current !== null) {
        window.clearTimeout(hoverAudioDebounceRef.current);
      }
      if (hoverAudioStopDebounceRef.current !== null) {
        window.clearTimeout(hoverAudioStopDebounceRef.current);
      }
      if (hoverAudioRef.current) {
        hoverAudioRef.current.pause();
        hoverAudioRef.current.src = "";
      }
    };
  }, []);

  useEffect(() => {
    setVisibleCount(20);
    if (selected) {
      setSelected(null);
    }
  }, [debouncedSearch, classFilter]);

  useEffect(() => {
    setVisibleCount(20);
  }, [sortMode]);

  useEffect(() => {
    try {
      localStorage.setItem(ROSTER_FILTERS_KEY, JSON.stringify({ classFilter, sortMode }));
    } catch {
      // ignore storage write errors
    }
  }, [classFilter, sortMode]);

  const rows = usersQuery.data?.data ?? [];
  const displayRows = isExternalView
    ? rows.map((entry) => ({
        ...entry,
        profile: { ...entry.profile, wechat_name: null, notes: null, discord_id: null },
      }))
    : rows;

  const filteredRows = displayRows
    .filter((entry) => {
      const q = debouncedSearch;
      if (!q) return true;
      const wechatKeyword = isExternalView ? "" : entry.profile.wechat_name ?? "";
      return entry.user.username.toLowerCase().includes(q) || wechatKeyword.toLowerCase().includes(q);
    })
    .filter((entry) => {
      if (classFilter.length === 0) return true;
      return entry.profile.classes.some((className) => classFilter.includes(className));
    });

  const sortedRows = [...filteredRows].sort((left, right) => {
    if (sortMode === "username") return left.user.username.localeCompare(right.user.username);
    if (sortMode === "class") return (left.profile.classes[0] ?? "").localeCompare(right.profile.classes[0] ?? "");
    return right.profile.power - left.profile.power;
  });

  const shouldVirtualize = sortedRows.length > 50;
  const renderedRows = shouldVirtualize ? sortedRows : sortedRows.slice(0, visibleCount);
  const columnCount = resolveColumnCount(windowWidth);
  const rowChunks = useMemo(() => chunkEntries(renderedRows, columnCount), [renderedRows, columnCount]);
  const rowVirtualizer = useVirtualizer({
    count: rowChunks.length,
    getScrollElement: () => virtualScrollRef.current,
    estimateSize: () => 320,
    overscan: 6,
    gap: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  const ensureHoverAudio = () => {
    if (!hoverAudioRef.current) {
      hoverAudioRef.current = new Audio();
    }
    return hoverAudioRef.current;
  };

  const playHoverAudio = (entry: { user: User; profile: MemberProfile }) => {
    if (audioMuted) return;
    const key = entry.profile.audio_key;
    if (!key || !/^https?:\/\//i.test(key)) return;
    if (hoverAudioStopDebounceRef.current !== null) {
      window.clearTimeout(hoverAudioStopDebounceRef.current);
      hoverAudioStopDebounceRef.current = null;
    }
    if (hoverAudioDebounceRef.current !== null) {
      window.clearTimeout(hoverAudioDebounceRef.current);
    }

    const currentAudio = hoverAudioRef.current;
    if (
      hoverPreview?.source === key &&
      currentAudio &&
      !currentAudio.paused
    ) {
      return;
    }

    hoverAudioDebounceRef.current = window.setTimeout(() => {
      const audio = ensureHoverAudio();
      setHoverPreview({ username: entry.user.username, source: key });
      if (audio.src !== key) {
        audio.pause();
        audio.src = key;
      }
      audio.currentTime = 0;
      audio.volume = audioVolume / 100;
      audio.muted = audioMuted;
      void audio.play().catch(() => {});
    }, 100);
  };

  const stopHoverAudio = () => {
    if (hoverAudioDebounceRef.current !== null) {
      window.clearTimeout(hoverAudioDebounceRef.current);
      hoverAudioDebounceRef.current = null;
    }
    if (hoverAudioStopDebounceRef.current !== null) {
      window.clearTimeout(hoverAudioStopDebounceRef.current);
    }
    hoverAudioStopDebounceRef.current = window.setTimeout(() => {
      if (hoverAudioRef.current) {
        hoverAudioRef.current.pause();
      }
      hoverAudioStopDebounceRef.current = null;
    }, 140);
  };

  const handleCardFocus = (entry: { user: User; profile: MemberProfile }) => {
    playHoverAudio(entry);
  };

  const handleCardBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    stopHoverAudio();
  };

  const audioControlContent = (
    <Group gap={8} align="center" wrap="nowrap" className="roster-audio-popover">
      <DepthToggle
        pressed={audioMuted}
        onToggle={(nextPressed) => {
          if (nextPressed && hoverAudioRef.current && !hoverAudioRef.current.paused) {
            hoverAudioRef.current.pause();
          }
          setAudioMuted(nextPressed);
        }}
        type="secondary"
        size="sm"
        iconOnly
        aria-label={audioMuted ? t("audio.aria.unmute") : t("audio.aria.mute")}
      >
        {audioMuted ? <VolumeMutedOutlined size={18} /> : <VolumeOutlined size={18} />}
      </DepthToggle>
      <div className="roster-volume-control">
        <Text size="xs" c="dimmed" className="roster-volume-label">{t("audio.volume")}</Text>
        <Slider min={0} max={100} value={audioVolume} onChange={setAudioVolume} aria-label={t("audio.aria.volumeSlider")} />
      </div>
    </Group>
  );

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} className="roster-page">
      <PortalCard className="roster-filter-card" interactive={false}>
        <div style={{ padding: "1.2rem" }}>
        <Group wrap="wrap" gap="md" className="roster-filter-controls">
          <TextInput
            className="roster-search-input"
            value={search}
            placeholder={isExternalView ? t("search.placeholder.usernameOnly") : t("search.placeholder.usernameWechat")}
            aria-label={isExternalView ? t("search.aria.usernameOnly") : t("search.aria.usernameWechat")}
            onChange={(event) => setSearch(event.currentTarget.value)}
            leftSection={<IconSearch size={14} />}
          />
          <MultiSelect
            className="roster-class-select"
            value={classFilter}
            onChange={setClassFilter}
            data={CLASS_NAMES.map((className) => ({ value: className, label: className }))}
            placeholder={t("filter.class.placeholder")}
            aria-label={t("filter.class.aria")}
            clearable
            searchable
          />
          <Select
            className="roster-sort-select"
            value={sortMode}
            aria-label={t("sort.aria")}
            onChange={(value) => { if (value) setSortMode(value as RosterSortMode); }}
            data={[
              { value: "power", label: t("sort.powerDesc") },
              { value: "username", label: t("sort.usernameAsc") },
              { value: "class", label: t("sort.class") },
            ]}
          />
          {audioControlContent}
          <Text size="sm" c="dimmed" className="roster-count-text">
            {t("count.showing", { visible: renderedRows.length, total: sortedRows.length })}
          </Text>
        </Group>
        </div>
      </PortalCard>

      {sortedRows.length === 0 ? (
        <PortalCard className="roster-empty-card" interactive={false}>
          <EmptyState
            title={debouncedSearch || classFilter.length > 0 ? t("empty.filtered") : t("empty.default")}
            actions={
              <Button
                variant="default"
                onClick={() => { setSearch(""); setClassFilter([]); }}
                disabled={!debouncedSearch && classFilter.length === 0}
              >
                {t("action.resetFilters")}
              </Button>
            }
          />
        </PortalCard>
      ) : null}

      {sortedRows.length > 0 ? (
        shouldVirtualize ? (
          <div ref={virtualScrollRef} className="roster-virtual-scroll" role="grid" aria-label={t("grid.aria")}>
            <div className="roster-virtual-inner" style={{ height: rowVirtualizer.getTotalSize() }}>
              {virtualRows.map((virtualRow) => {
                const members = rowChunks[virtualRow.index] ?? [];
                return (
                  <div
                    key={virtualRow.key}
                    className="roster-virtual-row"
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                    }}
                  >
                    {members.map((entry) => (
                      <div key={entry.user.id} role="gridcell" className="roster-virtual-cell">
                        <div
                          onMouseEnter={() => playHoverAudio(entry)}
                          onMouseLeave={stopHoverAudio}
                          onFocus={() => handleCardFocus(entry)}
                          onBlur={handleCardBlur}
                        >
                          <MemberCard user={entry.user} profile={entry.profile} onClick={() => setSelected(entry)} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div role="grid" aria-label={t("grid.aria")}>
            <StaggerList className="roster-card-grid" staggerMs={30} key={`${debouncedSearch}|${classFilter.join(",")}|${sortMode}`}>
              {renderedRows.map((entry) => (
                <motion.div key={entry.user.id} role="gridcell" variants={rosterCardVariants} className="roster-card-cell">
                  <div
                    onMouseEnter={() => playHoverAudio(entry)}
                    onMouseLeave={stopHoverAudio}
                    onFocus={() => handleCardFocus(entry)}
                    onBlur={handleCardBlur}
                  >
                    <MemberCard user={entry.user} profile={entry.profile} onClick={() => setSelected(entry)} />
                  </div>
                </motion.div>
              ))}
            </StaggerList>
          </div>
        )
      ) : null}

      {!shouldVirtualize && sortedRows.length > renderedRows.length ? (
        <div className="roster-load-more">
          <Button variant="default" onClick={() => setVisibleCount((count) => count + 20)}>{t("action.loadMore")}</Button>
        </div>
      ) : null}

      <Suspense fallback={null}>
        <LazyProfileModal
          open={selected !== null}
          user={selected?.user ?? null}
          profile={selected?.profile ?? null}
          onClose={() => setSelected(null)}
          canEdit={Boolean(
            selected && sessionUser && (
              hasRoleAtLeast(sessionUser.role, "moderator") ||
              selected.user.id === sessionUser.id
            ),
          )}
          editLabel={
            selected && sessionUser && selected.user.id === sessionUser.id
              ? t("common:profile.editMyProfile")
              : t("common:profile.editInAdmin")
          }
          onEdit={() => {
            if (!selected || !sessionUser) return;
            if (selected.user.id === sessionUser.id) {
              void navigate({ to: "/profile" });
            } else {
              void navigate({ to: "/admin", search: { member: selected.user.username } });
            }
          }}
        />
      </Suspense>
    </PageLayout>
  );
}
