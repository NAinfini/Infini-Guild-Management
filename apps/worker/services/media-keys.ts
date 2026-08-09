import {
  MEDIA_CONTRACT,
  MEDIA_ENTITY_TYPES,
  MEDIA_PURPOSES,
  MEDIA_TYPES,
  MEDIA_VARIANTS,
  type MediaEntityType,
  type MediaPurpose,
  type MediaSlot,
  type MediaType,
  type MediaVariant,
} from "@guild/shared";
import { nanoid } from "nanoid";

export { MEDIA_ENTITY_TYPES, MEDIA_PURPOSES, MEDIA_TYPES, MEDIA_VARIANTS };
export type { MediaEntityType, MediaPurpose, MediaType, MediaVariant };

export type MediaLinkSlot = MediaSlot;

const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;

export function createMediaId(): string {
  return nanoid();
}

export function isMediaId(value: string): boolean {
  return MEDIA_ID_PATTERN.test(value);
}

export function mediaTypeForPurpose(purpose: MediaPurpose): MediaType {
  return MEDIA_CONTRACT.find((entry) => entry.purpose === purpose)!.mediaType;
}

export function requiredMediaVariants(mediaType: MediaType): readonly MediaVariant[] {
  return mediaType === "image" ? ["full", "view"] : ["full"];
}

export function mediaVariantContentType(mediaType: MediaType): "image/webp" | "audio/ogg" {
  return mediaType === "image" ? "image/webp" : "audio/ogg";
}

export function buildMediaKey(mediaId: string, variant: MediaVariant, mediaType: MediaType): string {
  if (!isMediaId(mediaId)) throw new Error("Media id must be a 21-character nanoid");
  if (mediaType === "audio" && variant !== "full") throw new Error("Audio media has only the full variant");
  return `media/${mediaId}/${variant}.${mediaType === "image" ? "webp" : "ogg"}`;
}
