import type { MemberProfile, PaginatedResponse, User, UserBadge } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { apiRequest } from "../client";

type UserDetailResponse = { user: User; profile: MemberProfile; badges: UserBadge[] };
export type UsersListResponse = PaginatedResponse<{ user: User; profile: MemberProfile; badges: UserBadge[] }>;
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
    limit: String(options?.limit ?? LIMITS.pagination.users),
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

export async function fetchAllUsersListWithOptions(options?: Omit<UsersListOptions, "page" | "limit" | "includeTotal">): Promise<UsersListResponse> {
  const limit = LIMITS.pagination.users;
  const pages: UsersListResponse[] = [];
  let page = 1;

  while (true) {
    const response = await fetchUsersListWithOptions({
      ...options,
      page,
      limit,
      includeTotal: false,
    });
    pages.push(response);
    if (response.data.length < limit) {
      return {
        ...response,
        data: pages.flatMap((item) => item.data),
        page: 1,
        limit,
      };
    }
    page += 1;
  }
}

export function fetchUsersStats(): Promise<UsersStatsResponse> {
  return apiRequest<UsersStatsResponse>("/api/users/stats");
}

export function fetchUserDetail(userId: string): Promise<UserDetailResponse> {
  return apiRequest<UserDetailResponse>(`/api/users/${userId}`);
}
