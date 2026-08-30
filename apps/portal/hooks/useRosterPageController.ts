import type { MemberProfile, User, UserBadge } from "@guild/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useExternalView } from "./useExternalView";
import { useEffectivePermissions } from "./useEffectivePermissions";
import { queryKeys } from "../api/query-keys";
import { fetchAllUsersListWithOptions } from "../services/UserService";
import { useAuthStore } from "../stores/auth";
import { viewerIdentity } from "../session-storage";
import { useClassCatalog } from "./data/useClassData";
import { resolveClassCatalogItem } from "../utils/class-catalog";
import { resolveMediaUrl } from "../utils/media";
import { playAudio, stopAudio, setAudioVolume, setAudioMuted, isAudioPlaying, getAudioSrc } from "../utils/audio-player";

export type RosterEntry = { user: User; profile: MemberProfile; badges?: UserBadge[] };

const ROSTER_FILTERS_KEY = "roster.filters";
const ROSTER_AUDIO_MUTED_KEY = "roster.audio.muted";
const ROSTER_AUDIO_VOLUME_KEY = "roster.audio.volume";
const ROSTER_PAGE_SIZE = 24;

const ROSTER_SORT_MODES = ["power", "display_name", "class"] as const;

export type RosterSortMode = (typeof ROSTER_SORT_MODES)[number];

function readStoredClassFilter(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ROSTER_FILTERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const list = (parsed as { classFilter?: unknown }).classFilter;
    if (!Array.isArray(list)) return [];
    return list
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value.length <= 128);
  } catch {
    return [];
  }
}

function readStoredSortMode(): RosterSortMode {
  if (typeof window === "undefined") return "power";
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

function readStoredBoolean(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    const value = JSON.parse(raw) as unknown;
    return typeof value === "boolean" ? value : defaultValue;
  } catch {
    return defaultValue;
  }
}

function readStoredVolume(key: string, defaultValue: number): number {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    const value = JSON.parse(raw) as unknown;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
      ? value
      : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function useRosterPageController() {
  const isExternalView = useExternalView();
  const sessionUser = useAuthStore((state) => state.user);
  const usePublicRosterProjection = isExternalView || !sessionUser;
  const classCatalog = useClassCatalog();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const { search, setSearch, debouncedSearch: debouncedSearchRaw } = useDebouncedSearch();
  const debouncedSearch = debouncedSearchRaw.trim().toLowerCase();
  const [classFilter, setClassFilter] = useState<string[]>(() => readStoredClassFilter());
  const [sortMode, setSortMode] = useState<RosterSortMode>(() => readStoredSortMode());
  const [page, setPage] = useState(1);
  const [audioMuted, setAudioMutedState] = useState(() => readStoredBoolean(ROSTER_AUDIO_MUTED_KEY, false));
  const [audioVolume, setAudioVolumeState] = useState(() => readStoredVolume(ROSTER_AUDIO_VOLUME_KEY, 20));
  const hoverAudioDebounceRef = useRef<number | null>(null);
  const hoverAudioStopDebounceRef = useRef<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selectedUserIdRef = useRef(selectedUserId);
  selectedUserIdRef.current = selectedUserId;

  const usersQuery = useQuery({
    queryKey: queryKeys.users.directory(
      viewerIdentity(sessionUser?.id),
      usePublicRosterProjection ? "public" : "internal",
    ),
    queryFn: () => fetchAllUsersListWithOptions({ externalView: usePublicRosterProjection }),
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    setAudioVolume(audioVolume / 100);
    setAudioMuted(audioMuted);
  }, [audioMuted, audioVolume]);

  useEffect(() => {
    try {
      localStorage.setItem(ROSTER_AUDIO_MUTED_KEY, JSON.stringify(audioMuted));
    } catch {
      // A blocked storage area must not prevent the roster or audio preference from working for this visit.
    }
  }, [audioMuted]);

  useEffect(() => {
    try {
      localStorage.setItem(ROSTER_AUDIO_VOLUME_KEY, JSON.stringify(audioVolume));
    } catch {
      // A blocked storage area must not prevent the roster or audio preference from working for this visit.
    }
  }, [audioVolume]);

  useEffect(() => {
    return () => {
      if (hoverAudioDebounceRef.current !== null) {
        window.clearTimeout(hoverAudioDebounceRef.current);
      }
      if (hoverAudioStopDebounceRef.current !== null) {
        window.clearTimeout(hoverAudioStopDebounceRef.current);
      }
      stopAudio();
    };
  }, []);

  useEffect(() => {
    setPage(1);
    if (selectedUserIdRef.current) {
      closeMemberProfile();
    }
    // closeMemberProfile is defined in the same render scope and reads/writes
    // selectedUserIdRef (a stable ref), so it does not need to be in deps.
     
  }, [debouncedSearch, classFilter]);

  useEffect(() => {
    setPage(1);
  }, [sortMode]);

  useEffect(() => {
    try {
      localStorage.setItem(ROSTER_FILTERS_KEY, JSON.stringify({ classFilter, sortMode }));
    } catch {
      // ignore storage write errors
    }
  }, [classFilter, sortMode]);

  const rows = usersQuery.data?.data ?? [];
  const displayRows = useMemo(
    () => isExternalView
      ? rows.map((entry) => ({
          ...entry,
          profile: { ...entry.profile, notes: null },
        }))
      : rows,
    [isExternalView, rows],
  );
  const selected = selectedUserId
    ? displayRows.find((entry) => entry.user.id === selectedUserId) ?? null
    : null;
  const sortedRows = useMemo(() => {
    const filteredRows = displayRows
      .filter((entry) => {
        if (!debouncedSearch) return true;
        /* 只按用户名，和输入框自己写的「搜索用户名」一致——名册上已经看不到身份，
           再拿身份去匹配就会搜出一批看不出为什么会命中的人。 */
        return entry.user.display_name.toLowerCase().includes(debouncedSearch);
      })
      .filter((entry) => {
        if (classFilter.length === 0) return true;
        return entry.profile.classes.some((className) => classFilter.includes(className));
      });

    return [...filteredRows].sort((left, right) => {
      if (sortMode === "display_name") return left.user.display_name.localeCompare(right.user.display_name);
      if (sortMode === "class") {
        return resolveClassCatalogItem(left.profile.classes[0], classCatalog).label.localeCompare(
          resolveClassCatalogItem(right.profile.classes[0], classCatalog).label,
        );
      }
      return right.profile.power - left.profile.power;
    });
  }, [classCatalog, displayRows, debouncedSearch, classFilter, sortMode]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / ROSTER_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * ROSTER_PAGE_SIZE;
  const pageRows = sortedRows.slice(pageStart, pageStart + ROSTER_PAGE_SIZE);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  useEffect(() => {
    if (selectedUserId && usersQuery.data && !selected) {
      selectedUserIdRef.current = null;
      setSelectedUserId(null);
      stopAudio();
    }
  }, [selected, selectedUserId, usersQuery.data]);

  const playHoverAudio = (entry: { user: User; profile: MemberProfile }) => {
    if (audioMuted) return;
    const mediaId = entry.profile.audio_media_id;
    if (!mediaId) return;
    const resolvedSrc = resolveMediaUrl(mediaId, "full");
    if (hoverAudioStopDebounceRef.current !== null) {
      window.clearTimeout(hoverAudioStopDebounceRef.current);
      hoverAudioStopDebounceRef.current = null;
    }
    if (hoverAudioDebounceRef.current !== null) {
      window.clearTimeout(hoverAudioDebounceRef.current);
    }

    if (getAudioSrc() === resolvedSrc && isAudioPlaying()) {
      return;
    }

    hoverAudioDebounceRef.current = window.setTimeout(() => {
      setAudioVolume(audioVolume / 100);
      playAudio(resolvedSrc);
    }, 100);
  };

  const stopHoverAudio = () => {
    if (hoverAudioDebounceRef.current !== null) {
      window.clearTimeout(hoverAudioDebounceRef.current);
      hoverAudioDebounceRef.current = null;
    }
    if (selectedUserIdRef.current) return;
    if (hoverAudioStopDebounceRef.current !== null) {
      window.clearTimeout(hoverAudioStopDebounceRef.current);
    }
    hoverAudioStopDebounceRef.current = window.setTimeout(() => {
      if (!selectedUserIdRef.current) {
        stopAudio();
      }
      hoverAudioStopDebounceRef.current = null;
    }, 140);
  };

  const openMemberProfile = (entry: RosterEntry) => {
    selectedUserIdRef.current = entry.user.id;
    setSelectedUserId(entry.user.id);
  };

  const closeMemberProfile = () => {
    selectedUserIdRef.current = null;
    setSelectedUserId(null);
    stopAudio();
  };

  return {
    isExternalView,
    sessionUser,
    canManagePermission,
    search,
    setSearch,
    debouncedSearch,
    classFilter,
    setClassFilter,
    sortMode,
    setSortMode,
    currentPage,
    pageCount,
    pageRows,
    setPage,
    audioMuted,
    setAudioMutedState,
    audioVolume,
    setAudioVolumeState,
    selected,
    usersQuery,
    sortedRows,
    playHoverAudio,
    stopHoverAudio,
    openMemberProfile,
    closeMemberProfile,
  };
}
