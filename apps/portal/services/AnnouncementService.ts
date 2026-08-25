export {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  uploadAnnouncementAttachment,
  uploadPendingAnnouncementImages,
  updateAnnouncement,
  uploadAnnouncementImages,
} from "../api/mutations/announcements";
export type {
  CreateAnnouncementPayload,
  UpdateAnnouncementPayload,
} from "../api/mutations/announcements";
export type {
  AnnouncementAttachmentUploadResponse,
  AnnouncementImageUploadResponse,
} from "@guild/shared";
import { queryKeys } from "../api/query-keys";

export {
  fetchAnnouncement,
  fetchAnnouncements,
} from "../api/queries/announcements";

export const announcementQueryKeys = queryKeys.announcements;
