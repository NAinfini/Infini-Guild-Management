export const IMAGE_QUOTAS = {
  profile: 10,
  announcement: 10,
  gallery: 20,
  wiki: 10,
} as const;

export const VIDEO_URL_QUOTAS = {
  profile: 10,
  gallery: 10,
} as const;

export const FILE_SIZE_LIMITS = {
  profileImage: 5 * 1024 * 1024,
  profileAudio: 20 * 1024 * 1024,
  announcementImage: 5 * 1024 * 1024,
  wikiImage: 5 * 1024 * 1024,
  galleryImage: 10 * 1024 * 1024,
} as const;

export const ALLOWED_VIDEO_HOSTS = [
  "youtube.com",
  "youtu.be",
  "bilibili.com",
  "vimeo.com",
  "tiktok.com",
  "douyin.com",
] as const;

export const AUDIO_TARGET = {
  codec: "opus",
  container: "ogg",
  bitrateKbps: 48,
  sampleRateHz: 16_000,
  channels: 1,
} as const;
