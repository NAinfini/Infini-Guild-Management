import { z } from "zod";
import {
  MEDIA_ENTITY_TYPES,
  MEDIA_PURPOSES,
  MEDIA_SLOTS,
  MEDIA_TYPES,
  MEDIA_VARIANTS,
} from "../constants/media";

export const mediaIdSchema = z.string().regex(/^[A-Za-z0-9_-]{21}$/);
export const mediaPurposeSchema = z.enum(MEDIA_PURPOSES);
export const mediaTypeSchema = z.enum(MEDIA_TYPES);
export const mediaEntityTypeSchema = z.enum(MEDIA_ENTITY_TYPES);
export const mediaSlotSchema = z.enum(MEDIA_SLOTS);
export const mediaVariantSchema = z.enum(MEDIA_VARIANTS);

export const mediaIdsResponseSchema = z.object({
  media_ids: z.array(mediaIdSchema),
});

export const mediaIdResponseSchema = z.object({
  media_id: mediaIdSchema,
});

export type {
  MediaEntityType,
  MediaPurpose,
  MediaSlot,
  MediaType,
  MediaVariant,
} from "../constants/media";
