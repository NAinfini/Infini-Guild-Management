export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;

export const IMAGE_QUOTAS = {
  profile: 10,
  announcement: 10,
  gallery: 20,
  wiki: 10,
} as const;

export const FILE_SIZE_LIMITS = {
  profileImage: 5 * 1024 * 1024,
  profileAudio: 20 * 1024 * 1024,
  announcementImage: 5 * 1024 * 1024,
  wikiImage: 5 * 1024 * 1024,
  galleryImage: 10 * 1024 * 1024,
} as const;
