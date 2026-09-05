import type { MemberAvailabilitySummary, MemberDirectoryEntry, MemberPlanningEntry } from "@guild/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { queryKeys } from "../../api/query-keys";
import { viewerIdentity } from "../../session-storage";
import {
  fetchMemberAvailabilitySummary,
  fetchMemberDirectory,
  fetchMemberIdentities,
  fetchMemberPlanning,
} from "../../services/UserService";

const DIRECTORY_PAGE_LIMIT = 50;

type MemberProjectionOptions = {
  currentUserId?: string;
  publicMemberProjection?: boolean;
  enabled?: boolean;
};

type UseMemberDirectoryOptions = MemberProjectionOptions & {
  search?: string;
  selectedIds?: readonly string[];
};

export type MemberDirectoryLoadError = {
  kind: "directory" | "next-page" | "identities";
  retry: () => Promise<unknown>;
  retrying: boolean;
};

function stableMemberIds(ids: readonly string[]) {
  return [...new Set(ids)].sort();
}

export function useMemberDirectory({
  currentUserId,
  publicMemberProjection = false,
  enabled = true,
  search = "",
  selectedIds = [],
}: UseMemberDirectoryOptions) {
  const viewerKey = viewerIdentity(currentUserId);
  const projection = publicMemberProjection ? "public" : "internal";
  const normalizedSearch = search.trim();
  const ids = stableMemberIds(selectedIds);
  const idsKey = JSON.stringify(ids);
  const directoryQuery = useInfiniteQuery({
    queryKey: queryKeys.users.directory(viewerKey, projection, normalizedSearch),
    queryFn: ({ pageParam, signal }) => fetchMemberDirectory({
      search: normalizedSearch || undefined,
      cursor: pageParam,
      limit: DIRECTORY_PAGE_LIMIT,
      externalView: publicMemberProjection,
      signal,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled,
    staleTime: 10 * 60_000,
  });
  const selectedQuery = useQuery({
    queryKey: queryKeys.users.identities(viewerKey, projection, idsKey),
    queryFn: ({ signal }) => fetchMemberIdentities(ids, {
      externalView: publicMemberProjection,
      signal,
    }),
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
  });
  const entries = useMemo(() => {
    const byId = new Map<string, MemberDirectoryEntry>();
    for (const entry of selectedQuery.data?.data ?? []) byId.set(entry.user.id, entry);
    for (const page of directoryQuery.data?.pages ?? []) {
      for (const entry of page.data) byId.set(entry.user.id, entry);
    }
    return [...byId.values()];
  }, [directoryQuery.data, selectedQuery.data]);
  const loadError: MemberDirectoryLoadError | null = selectedQuery.isError
    ? {
        kind: "identities",
        retry: () => selectedQuery.refetch(),
        retrying: selectedQuery.isFetching,
      }
    : directoryQuery.isFetchNextPageError
      ? {
          kind: "next-page",
          retry: () => directoryQuery.fetchNextPage(),
          retrying: directoryQuery.isFetchingNextPage,
        }
      : directoryQuery.isError
        ? {
            kind: "directory",
            retry: () => directoryQuery.refetch(),
            retrying: directoryQuery.isFetching,
          }
        : null;

  return {
    entries,
    directoryQuery,
    selectedQuery,
    hasMore: directoryQuery.hasNextPage ?? false,
    isLoadingMore: directoryQuery.isFetchingNextPage,
    loadMore: () => directoryQuery.fetchNextPage(),
    loadError,
    isError: loadError !== null,
    isDirectoryUnavailable: directoryQuery.isError && directoryQuery.data === undefined,
  };
}

export function useMemberPlanning(
  memberIds: readonly string[],
  { currentUserId, publicMemberProjection = false, enabled = true }: MemberProjectionOptions = {},
) {
  const viewerKey = viewerIdentity(currentUserId);
  const projection = publicMemberProjection ? "public" : "internal";
  const ids = stableMemberIds(memberIds);
  const idsKey = JSON.stringify(ids);
  return useQuery<{ data: MemberPlanningEntry[] }>({
    queryKey: queryKeys.users.planning(viewerKey, projection, idsKey),
    queryFn: ({ signal }) => fetchMemberPlanning(ids, {
      externalView: publicMemberProjection,
      signal,
    }),
    enabled: enabled && ids.length > 0,
    staleTime: 10 * 60_000,
  });
}

export function useMemberAvailabilitySummary({
  currentUserId,
  enabled = true,
}: Pick<MemberProjectionOptions, "currentUserId" | "enabled"> = {}) {
  return useQuery<MemberAvailabilitySummary>({
    queryKey: queryKeys.users.availabilitySummary(viewerIdentity(currentUserId)),
    queryFn: ({ signal }) => fetchMemberAvailabilitySummary({ signal }),
    enabled,
    staleTime: 10 * 60_000,
  });
}
