export {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  uploadAnnouncementAttachment,
  uploadPendingAnnouncementImages,
  updateAnnouncement,
} from "../api/mutations/announcements";
export type {
  CreateAnnouncementPayload,
  UpdateAnnouncementPayload,
} from "../api/mutations/announcements";
export type {
  AnnouncementAttachmentUploadResponse,
  AnnouncementImageUploadResponse,
} from "@guild/shared";
export { isApiRequestError } from "../api/client";
import { queryKeys } from "../api/query-keys";

export {
  fetchAnnouncement,
  fetchAnnouncements,
  recordAnnouncementView,
} from "../api/queries/announcements";

export const announcementQueryKeys = queryKeys.announcements;
