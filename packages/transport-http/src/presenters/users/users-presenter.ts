import { usersListResponseSchema, type MemberProfile, type MemberManagementStats } from "@guild/shared";
import { buildMemberWire, type MemberView } from "@guild/server/modules/members";

export function presentUserDetail(view: MemberView) {
  return buildMemberWire(view);
}

export function presentUsersPage(page: Readonly<{
  data: readonly MemberView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  stats?: MemberManagementStats;
}>) {
  return usersListResponseSchema.parse({
    data: page.data.map(presentUserDetail),
    total: page.total,
    page: page.page,
    limit: page.limit,
    total_pages: page.totalPages,
    ...(page.stats ? { stats: page.stats } : {}),
  });
}

export function presentMemberProfile(profile: MemberProfile): MemberProfile {
  return profile;
}
