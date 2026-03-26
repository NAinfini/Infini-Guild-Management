export {
  archiveAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  uploadAnnouncementImages,
} from "../api/mutations/announcements";
export type {
  CreateAnnouncementPayload,
  UpdateAnnouncementPayload,
} from "../api/mutations/announcements";
export {
  fetchAnnouncement,
  fetchAnnouncements,
} from "../api/queries/announcements";

export function buildAnnouncementImageUrl(key: string): string {
  if (/^(?:https?:)?\/\//i.test(key) || key.startsWith("data:")) return key;
  const path = `/api/announcements/image?key=${encodeURIComponent(key)}`;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}
