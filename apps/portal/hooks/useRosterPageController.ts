import type { MemberProfile, User, UserBadge } from "@guild/shared";
import { activeGame } from "@guild/shared/games";
import { useQuery } from "@tanstack/react-query";
import { useLocalStorage } from "@mantine/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useExternalView } from "./useExternalView";
import { useEffectivePermissions } from "./useEffectivePermissions";
import { queryKeys } from "../api/query-keys";
import { fetchAllUsersListWithOptions } from "../services/UserService";
import { useAuthStore } from "../stores/auth";
import { resolveClassCatalogItem, useClassCatalogStore } from "../stores/class-catalog";
import { resolveProfileMediaUrl } from "../utils/media";
import { playAudio, stopAudio, setAudioVolume, setAudioMuted, isAudioPlaying, getAudioSrc } from "../utils/audio-player";

export type RosterEntry = { user: User; profile: MemberProfile; badges?: UserBadge[] };

const ROSTER_FILTERS_KEY = "roster.filters";

const ROSTER_SORT_MODES = [
  ...activeGame.profileStats.filter((s) => s.sortable).map((s) => s.key),
  "username",
  "class",
] as const;

export type RosterSortMode = (typeof ROSTER_SORT_MODES)[number];

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
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value.length <= 128);
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

export function useRosterPageController() {
  const isExternalView = useExternalView();
  const sessionUser = useAuthStore((state) => state.user);
  const classCatalog = useClassCatalogStore((state) => state.items);
  const { canManage: canManagePermission } = useEffectivePermissions();
  const { search, setSearch, debouncedSearch: debouncedSearchRaw } = useDebouncedSearch();
  const debouncedSearch = debouncedSearchRaw.trim().toLowerCase();
  const [classFilter, setClassFilter] = useState<string[]>(() => readStoredClassFilter());
  const [sortMode, setSortMode] = useState<RosterSortMode>(() => readStoredSortMode());
  const [visibleCount, setVisibleCount] = useState(20);
  const [audioMuted, setAudioMutedState] = useLocalStorage<boolean>({ key: "roster.audio.muted", defaultValue: false });
  const [audioVolume, setAudioVolumeState] = useLocalStorage<number>({ key: "roster.audio.volume", defaultValue: 20 });
  const hoverAudioDebounceRef = useRef<number | null>(null);
  const hoverAudioStopDebounceRef = useRef<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selectedUserIdRef = useRef(selectedUserId);
  selectedUserIdRef.current = selectedUserId;

  const usersQuery = useQuery({
    queryKey: queryKeys.users.roster(isExternalView ? "external" : "default"),
    queryFn: () => fetchAllUsersListWithOptions({ externalView: isExternalView }),
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    setAudioVolume(audioVolume / 100);
    setAudioMuted(audioMuted);
  }, [audioMuted, audioVolume]);

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
    setVisibleCount(20);
    if (selectedUserIdRef.current) {
      closeMemberProfile();
    }
    // closeMemberProfile is defined in the same render scope and reads/writes
    // selectedUserIdRef (a stable ref), so it does not need to be in deps.
     
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
  const loadedClassIds = useMemo(
    () => [...new Set(
      rows.flatMap((entry) => entry.profile.classes)
        .map((id) => id.trim())
        .filter(Boolean),
    )],
    [rows],
  );

  const sortedRows = useMemo(() => {
    const filteredRows = displayRows
      .filter((entry) => {
        if (!debouncedSearch) return true;
        return entry.user.username.toLowerCase().includes(debouncedSearch);
      })
      .filter((entry) => {
        if (classFilter.length === 0) return true;
        return entry.profile.classes.some((className) => classFilter.includes(className));
      });

    return [...filteredRows].sort((left, right) => {
      if (sortMode === "username") return left.user.username.localeCompare(right.user.username);
      if (sortMode === "class") {
        return resolveClassCatalogItem(left.profile.classes[0], classCatalog).label.localeCompare(
          resolveClassCatalogItem(right.profile.classes[0], classCatalog).label,
        );
      }
      return right.profile.power - left.profile.power;
    });
  }, [classCatalog, displayRows, debouncedSearch, classFilter, sortMode]);

  useEffect(() => {
    if (selectedUserId && usersQuery.data && !selected) {
      selectedUserIdRef.current = null;
      setSelectedUserId(null);
      stopAudio();
    }
  }, [selected, selectedUserId, usersQuery.data]);

  const playHoverAudio = (entry: { user: User; profile: MemberProfile }) => {
    if (audioMuted) return;
    const key = entry.profile.audio_key;
    if (!key) return;
    const resolvedSrc = resolveProfileMediaUrl(key);
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
    visibleCount,
    setVisibleCount,
    audioMuted,
    setAudioMutedState,
    audioVolume,
    setAudioVolumeState,
    selected,
    usersQuery,
    loadedClassIds,
    sortedRows,
    playHoverAudio,
    stopHoverAudio,
    openMemberProfile,
    closeMemberProfile,
  };
}
