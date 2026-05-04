import type { MemberProfile, PaginatedResponse, User } from "@guild/shared";
import { apiRequest } from "../client";

type UserDetailResponse = { user: User; profile: MemberProfile };
export type UsersListResponse = PaginatedResponse<{ user: User; profile: MemberProfile }>;
export type UsersStatsResponse = { active_members: number; total_members: number };

type UsersListOptions = {
  externalView?: boolean;
  page?: number;
  limit?: number;
  includeTotal?: boolean;
};

function buildUsersListPath(options?: UsersListOptions): string {
  const query = new URLSearchParams({
    page: String(options?.page ?? 1),
    limit: String(options?.limit ?? 500),
  });

  if (options?.includeTotal === false) {
    query.set("include_total", "false");
  }

  if (options?.externalView) {
    query.set("external_view", "true");
  }

  return `/api/users?${query.toString()}`;
}

export function fetchUsersList(): Promise<UsersListResponse> {
  return apiRequest<UsersListResponse>(buildUsersListPath({ includeTotal: false }));
}

export function fetchUsersListWithOptions(options?: UsersListOptions): Promise<UsersListResponse> {
  return apiRequest<UsersListResponse>(buildUsersListPath({ includeTotal: false, ...options }));
}

export function fetchUsersStats(): Promise<UsersStatsResponse> {
  return apiRequest<UsersStatsResponse>("/api/users/stats");
}

export function fetchUserDetail(userId: string): Promise<UserDetailResponse> {
  return apiRequest<UserDetailResponse>(`/api/users/${userId}`);
}
