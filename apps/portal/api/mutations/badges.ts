import type { MemberBadge } from "@guild/shared";
import { apiRequest } from "../client";

export type CreateBadgePayload = {
  name: string;
  label_html: string;
  color?: string;
  description?: string;
  sort_order?: number;
};

export type UpdateBadgePayload = Partial<CreateBadgePayload>;

export function createBadge(payload: CreateBadgePayload): Promise<MemberBadge> {
  return apiRequest<MemberBadge>("/api/badges", {
    method: "POST",
    bodyJson: payload,
  });
}

export function updateBadge(id: string, payload: UpdateBadgePayload): Promise<MemberBadge> {
  return apiRequest<MemberBadge>(`/api/badges/${id}`, {
    method: "PATCH",
    bodyJson: payload,
  });
}

/* 整表重排，跟 reorderClassCatalog 同一套约定：带**完整**的 id 顺序上去，
   服务端按下标重写 sort_order 并把整张表回给我们。 */
export function reorderBadges(order: string[]): Promise<MemberBadge[]> {
  return apiRequest<MemberBadge[]>("/api/badges/reorder", {
    method: "PATCH",
    bodyJson: { order },
  });
}

export function deleteBadge(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/badges/${id}`, {
    method: "DELETE",
  });
}

export function assignBadge(badgeId: string, userIds: string[]): Promise<{ assigned: number }> {
  return apiRequest<{ assigned: number }>(`/api/badges/${badgeId}/assign`, {
    method: "POST",
    bodyJson: { user_ids: userIds },
  });
}

export function unassignBadge(badgeId: string, userIds: string[]): Promise<{ removed: number }> {
  return apiRequest<{ removed: number }>(`/api/badges/${badgeId}/unassign`, {
    method: "POST",
    bodyJson: { user_ids: userIds },
  });
}
