import type { MemberAbsence, UserDetailResponse, UsersListResponse, MemberListSort, MemberDirectoryEntry, MemberPlanningEntry } from "@guild/shared";
import { memberDirectoryResponseSchema, memberPlanningResponseSchema, memberAvailabilitySummarySchema } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { apiRequest } from "../client";

export type { UsersListResponse } from "@guild/shared";
export type UsersStatsResponse = { active_members: number; total_members: number };

export type UsersListOptions = {
  externalView?: boolean;
  page?: number;
  limit?: number;
  includeTotal?: boolean;
  search?: string;
  classIds?: string[];
  active?: boolean;
  sort?: MemberListSort;
  direction?: "asc" | "desc";
  searchScope?: "name" | "management";
  signal?: AbortSignal;
};

function buildUsersListPath(options?: UsersListOptions): string {
  const query = new URLSearchParams({
    page: String(options?.page ?? 1),
    limit: String(options?.limit ?? LIMITS.pagination.users),
  });

  query.set("include_total", String(options?.includeTotal ?? false));

  if (options?.externalView) {
    query.set("external_view", "true");
  }
  if (options?.search) query.set("search", options.search);
  if (options?.classIds?.length) query.set("classes", JSON.stringify([...options.classIds].sort()));
  if (options?.active !== undefined) query.set("active", String(options.active));
  if (options?.sort) query.set("sort", options.sort);
  if (options?.direction) query.set("direction", options.direction);
  if (options?.searchScope) query.set("search_scope", options.searchScope);

  return `/api/users?${query.toString()}`;
}

export function fetchUsersList(): Promise<UsersListResponse> {
  return apiRequest<UsersListResponse>(buildUsersListPath({ includeTotal: false }));
}

export function fetchUsersListWithOptions(options?: UsersListOptions): Promise<UsersListResponse> {
  return apiRequest<UsersListResponse>(buildUsersListPath({ includeTotal: false, ...options }), { signal: options?.signal });
}

type MemberReadOptions = { externalView?: boolean; signal?: AbortSignal };

export function fetchMemberDirectory(options: MemberReadOptions & { search?: string; cursor?: string | null; limit?: number } = {}) {
  const query = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.search) query.set("search", options.search);
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.externalView) query.set("external_view", "true");
  return apiRequest<unknown>(`/api/users/directory?${query}`, { signal: options.signal }).then((value) => memberDirectoryResponseSchema.parse(value));
}

async function readMemberIds<T>(
  ids: readonly string[], path: string, options: MemberReadOptions, parse: (value: unknown) => { data: T[] },
): Promise<{ data: T[] }> {
  const uniqueIds = [...new Set(ids)].sort();
  const chunks = Array.from({ length: Math.ceil(uniqueIds.length / 100) }, (_, index) => uniqueIds.slice(index * 100, (index + 1) * 100));
  const results: T[][] = new Array(chunks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, async () => {
    while (next < chunks.length) {
      const index = next++;
      options.signal?.throwIfAborted();
      const query = new URLSearchParams({ ids: JSON.stringify(chunks[index]) });
      if (options.externalView) query.set("external_view", "true");
      results[index] = parse(await apiRequest<unknown>(`/api/users/${path}?${query}`, { signal: options.signal })).data;
    }
  }));
  return { data: results.flat() };
}

export function fetchMemberIdentities(ids: readonly string[], options: MemberReadOptions = {}) {
  return readMemberIds<MemberDirectoryEntry>(ids, "directory", options, (value) => memberDirectoryResponseSchema.parse(value));
}

export function fetchMemberPlanning(ids: readonly string[], options: MemberReadOptions = {}) {
  return readMemberIds<MemberPlanningEntry>(ids, "planning", options, (value) => memberPlanningResponseSchema.parse(value));
}

export function fetchMemberAvailabilitySummary(options: Pick<MemberReadOptions, "signal"> = {}) {
  return apiRequest<unknown>("/api/users/availability-summary", { signal: options.signal }).then((value) => memberAvailabilitySummarySchema.parse(value));
}

export function fetchUsersStats(): Promise<UsersStatsResponse> {
  return apiRequest<UsersStatsResponse>("/api/users/stats");
}

export function fetchUserDetail(userId: string, options: MemberReadOptions = {}): Promise<UserDetailResponse> {
  return apiRequest<UserDetailResponse>(`/api/users/${encodeURIComponent(userId)}${options.externalView ? "?external_view=true" : ""}`, { signal: options.signal });
}

export function fetchAbsencesWindow(from: string, to: string): Promise<{ data: MemberAbsence[] }> {
  const query = new URLSearchParams({ from, to });
  return apiRequest<{ data: MemberAbsence[] }>(`/api/users/absences?${query.toString()}`);
}

export function fetchUserAbsences(userId: string): Promise<{ data: MemberAbsence[] }> {
  return apiRequest<{ data: MemberAbsence[] }>(`/api/users/${userId}/absences`);
}
