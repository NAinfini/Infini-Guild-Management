import { LIMITS } from "../config/limits";

/** 允许**落库**的图片类型。上传前浏览器已经转过一轮，服务端按这份名单验字节头。 */
export const ALLOWED_IMAGE_TYPES = LIMITS.media.allowedImageTypes;

/*
 * 允许用户在文件选择器里**挑**的图片类型。
 *
 * 和 ALLOWED_IMAGE_TYPES 不是一回事，这两者必须分开：用户手里的是相机出的 JPEG、
 * 截图出的 PNG，上传前由 shared/utils/media.ts 转成 WebP。选择器按落库名单去卡，
 * 用户会发现自己的照片根本选不了。
 *
 * 两个刻意排除的类型：
 * - SVG：服务端不收（能内嵌 <script>，是 XSS 面）。放进来只会让人选完才被拒。
 * - HEIC/HEIF：createImageBitmap 解不了，转码那一步会直接抛。Mantine 的
 *   IMAGE_MIME_TYPE 里带着这两个，所以图库和存储那两个 Dropzone 不能直接用它。
 */
export const SELECTABLE_IMAGE_TYPES = [
  "image/webp",
  "image/jpeg",
  "image/png",
  "image/avif",
  "image/gif",
] as const;

/** `<input accept>` 用的形式。 */
export const IMAGE_FILE_ACCEPT = SELECTABLE_IMAGE_TYPES.join(",");

/*
 * 职业图标另算：服务端只收 WebP，连 GIF 例外都没有（图标不需要动画，
 * 而 GIF 走不到转码那一步，选了必然失败）。
 */
export const CLASS_ICON_SELECTABLE_TYPES = SELECTABLE_IMAGE_TYPES.filter(
  (type) => type !== "image/gif",
);

export const CLASS_ICON_FILE_ACCEPT = CLASS_ICON_SELECTABLE_TYPES.join(",");

export const IMAGE_QUOTAS = LIMITS.media.quotas;

export const FILE_SIZE_LIMITS = LIMITS.media.maxFileSize;
