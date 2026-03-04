import type { Announcement } from "@guild/shared";
import { apiRequest } from "../client";

export function createAnnouncement(payload: {
  title: string;
  body_json: string;
  pinned: boolean;
  status: "draft" | "scheduled" | "published" | "archived";
  publish_at?: string;
  expires_at?: string;
  notify_discord?: boolean;
  notify_wechat?: boolean;
}): Promise<Announcement> {
  return apiRequest<Announcement>("/api/announcements", {
    method: "POST",
    bodyJson: payload,
  });
}

export function updateAnnouncement(id: string, payload: Record<string, unknown>): Promise<Announcement> {
  return apiRequest<Announcement>(`/api/announcements/${id}`, {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function archiveAnnouncement(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/announcements/${id}`, {
    method: "DELETE",
  });
}

export function uploadAnnouncementImages(
  announcementId: string,
  files: File[],
): Promise<{ keys: string[] }> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  return apiRequest<{ keys: string[] }>(`/api/announcements/${announcementId}/images`, {
    method: "POST",
    body: formData,
  });
}
