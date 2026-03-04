import type { MemberProfile, PaginatedResponse, User } from "@guild/shared";
import { apiRequest } from "../client";

export type UserDetailResponse = { user: User; profile: MemberProfile };
export type UsersListResponse = PaginatedResponse<{ user: User; profile: MemberProfile }>;

function buildUsersListPath(options?: { externalView?: boolean }): string {
  const query = new URLSearchParams({
    page: "1",
    limit: "100",
  });

  if (options?.externalView) {
    query.set("external_view", "true");
  }

  return `/api/users?${query.toString()}`;
}

export function fetchUsersList(): Promise<UsersListResponse> {
  return apiRequest<UsersListResponse>(buildUsersListPath());
}

export function fetchUsersListWithOptions(options?: { externalView?: boolean }): Promise<UsersListResponse> {
  return apiRequest<UsersListResponse>(buildUsersListPath(options));
}

export function fetchUserDetail(userId: string): Promise<UserDetailResponse> {
  return apiRequest<UserDetailResponse>(`/api/users/${userId}`);
}
