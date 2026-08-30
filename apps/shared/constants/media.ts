import { LIMITS } from "../config/limits";

type MediaContractDefinition = readonly {
  purpose: string;
  mediaType: "image" | "audio" | "file";
  targets: readonly {
    entityType: string;
    slot: string;
    singular: boolean;
  }[];
}[];

export const MEDIA_CONTRACT = [
  { purpose: "member_avatar", mediaType: "image", targets: [
    { entityType: "member_profile", slot: "avatar", singular: true },
  ] },
  { purpose: "member_image", mediaType: "image", targets: [
    { entityType: "member_profile", slot: "image", singular: false },
  ] },
  { purpose: "member_audio", mediaType: "audio", targets: [
    { entityType: "member_profile", slot: "audio", singular: true },
  ] },
  { purpose: "gallery_image", mediaType: "image", targets: [
    { entityType: "gallery_item", slot: "image", singular: true },
  ] },
  { purpose: "event_image", mediaType: "image", targets: [
    { entityType: "event", slot: "attachment", singular: false },
    { entityType: "recurring_template", slot: "attachment", singular: false },
  ] },
  { purpose: "announcement_image", mediaType: "image", targets: [
    { entityType: "announcement", slot: "body", singular: false },
  ] },
  { purpose: "announcement_attachment", mediaType: "file", targets: [
    { entityType: "announcement", slot: "attachment", singular: false },
  ] },
  { purpose: "wiki_image", mediaType: "image", targets: [
    { entityType: "wiki_article", slot: "body", singular: false },
  ] },
  { purpose: "storage_image", mediaType: "image", targets: [
    { entityType: "storage_item", slot: "image", singular: false },
  ] },
  { purpose: "class_icon", mediaType: "image", targets: [
    { entityType: "class_catalog", slot: "icon", singular: true },
  ] },
  { purpose: "site_logo", mediaType: "image", targets: [
    { entityType: "site_config", slot: "logo", singular: true },
  ] },
] as const satisfies MediaContractDefinition;

type MediaContractEntry = (typeof MEDIA_CONTRACT)[number];
export type MediaPurpose = MediaContractEntry["purpose"];
export type MediaType = MediaContractEntry["mediaType"];
export type MediaLinkTarget = MediaContractEntry["targets"][number];
export type MediaEntityType = MediaLinkTarget["entityType"];
export type MediaSlot = MediaLinkTarget["slot"];

function uniqueTuple<T extends string>(values: readonly T[]): readonly [T, ...T[]] {
  const unique = [...new Set(values)];
  if (unique.length === 0) throw new Error("Media contract values cannot be empty");
  return unique as [T, ...T[]];
}

const MEDIA_TARGETS = MEDIA_CONTRACT.flatMap<MediaLinkTarget>(({ targets }) => targets);

export const MEDIA_PURPOSES = uniqueTuple(MEDIA_CONTRACT.map(({ purpose }) => purpose));
export const MEDIA_TYPES = uniqueTuple(MEDIA_CONTRACT.map(({ mediaType }) => mediaType));
export const MEDIA_ENTITY_TYPES = uniqueTuple(MEDIA_TARGETS.map(({ entityType }) => entityType));
export const MEDIA_SLOTS = uniqueTuple(MEDIA_TARGETS.map(({ slot }) => slot));
export const MEDIA_VARIANTS = ["full", "view"] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

/** 允许**落库**的图片类型。上传前浏览器已经转过一轮，服务端按这份名单验字节头。 */
export const ALLOWED_IMAGE_TYPES = LIMITS.media.allowedImageTypes;

/*
 * 允许用户在文件选择器里**挑**的图片类型。
 *
 * 和 ALLOWED_IMAGE_TYPES 不是一回事，这两者必须分开：用户手里的是相机出的 JPEG、
 * 截图出的 PNG，上传前由 Portal 上传管线转成 WebP。选择器按落库名单去卡，
 * 用户会发现自己的照片根本选不了。
 *
 * 三个刻意排除的类型：
 * - SVG：服务端不收（能内嵌 <script>，是 XSS 面）。放进来只会让人选完才被拒。
 * - HEIC/HEIF：createImageBitmap 解不了，转码那一步会直接抛，因此文件选择器不能
 *   直接沿用浏览器或第三方组件的宽泛图片类型集合。
 * - GIF：统一图片必须有 full/view；动画媒体应以视频上传，不能在缩略图转换时丢帧。
 */
export const SELECTABLE_IMAGE_TYPES = [
  "image/webp",
  "image/jpeg",
  "image/png",
  "image/avif",
] as const;

/** `<input accept>` 用的形式。 */
export const IMAGE_FILE_ACCEPT = SELECTABLE_IMAGE_TYPES.join(",");

export const CLASS_ICON_SELECTABLE_TYPES = SELECTABLE_IMAGE_TYPES;

export const CLASS_ICON_FILE_ACCEPT = CLASS_ICON_SELECTABLE_TYPES.join(",");

/*
 * 语音只落 Ogg/Opus，但可选范围放到整个 audio/*：convertAudioToOpus 靠
 * mediabunny 读实际音轨，不挑容器。列举容器只会把浏览器报成 audio/x-m4a、
 * audio/aac 之类的同一批文件挡在选择器外面，而它们本来转得动。
 */
export const AUDIO_FILE_ACCEPT = "audio/*";

export const ANNOUNCEMENT_ATTACHMENT_CONTENT_TYPES = [
  "application/octet-stream",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type AnnouncementAttachmentContentType = (typeof ANNOUNCEMENT_ATTACHMENT_CONTENT_TYPES)[number];

export type MediaImageDimensions = { width: number; height: number };

/** Exact contain size for the mandatory `view` variant. */
export function getMediaViewDimensions(width: number, height: number): MediaImageDimensions {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error("Image dimensions must be positive integers");
  }
  const bounds = width > height
    ? LIMITS.media.viewImageBounds.landscape
    : height > width
      ? LIMITS.media.viewImageBounds.portrait
      : LIMITS.media.viewImageBounds.square;
  const scale = Math.min(1, bounds.width / width, bounds.height / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
