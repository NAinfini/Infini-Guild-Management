import type { MemberProfile, PaginatedResponse, User } from "@guild/shared";
import { apiRequest } from "../client";

type UserDetailResponse = { user: User; profile: MemberProfile };
export type UsersListResponse = PaginatedResponse<{ user: User; profile: MemberProfile }>;

function buildUsersListPath(options?: { externalView?: boolean; page?: number; limit?: number }): string {
  const query = new URLSearchParams({
    page: String(options?.page ?? 1),
    limit: String(options?.limit ?? 500),
  });

  if (options?.externalView) {
    query.set("external_view", "true");
  }

  return `/api/users?${query.toString()}`;
}

export function fetchUsersList(): Promise<UsersListResponse> {
  return apiRequest<UsersListResponse>(buildUsersListPath());
}

export function fetchUsersListWithOptions(options?: { externalView?: boolean; page?: number; limit?: number }): Promise<UsersListResponse> {
  return apiRequest<UsersListResponse>(buildUsersListPath(options));
}

export function fetchUserDetail(userId: string): Promise<UserDetailResponse> {
  return apiRequest<UserDetailResponse>(`/api/users/${userId}`);
}
