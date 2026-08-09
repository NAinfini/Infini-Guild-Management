import { z } from "zod";
import { LIMITS } from "../config/limits";
import { PERMISSIONS } from "../constants/roles";
import { isAllowedVideoUrl } from "../utils/video";
import { classIdSchema } from "./class-catalog";
import { roleMetadataSchema } from "./role";
import { mediaIdSchema } from "./media";

const L = LIMITS.content;
const permissionKeySchema = z.enum(PERMISSIONS);

export const AVAILABILITY_DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const availabilityStartTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const availabilityEndTimeSchema = z.string().regex(
  /^(?:00:(?:0[1-9]|[1-5]\d)|(?:0[1-9]|1\d|2[0-3]):[0-5]\d|24:00)$/,
);

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const availabilityRangeSchema = z.object({
  start_utc: availabilityStartTimeSchema,
  end_utc: availabilityEndTimeSchema,
}).strict();

const availabilityDaysSchema = z.object({
  sunday: z.array(availabilityRangeSchema),
  monday: z.array(availabilityRangeSchema),
  tuesday: z.array(availabilityRangeSchema),
  wednesday: z.array(availabilityRangeSchema),
  thursday: z.array(availabilityRangeSchema),
  friday: z.array(availabilityRangeSchema),
  saturday: z.array(availabilityRangeSchema),
}).strict();

const memberAvailabilityBaseSchema = z.object({
  timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, "Invalid IANA timezone"),
  days: availabilityDaysSchema,
}).strict();

function timeToMinutes(value: string): number {
  if (value === "24:00") return 24 * 60;
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
}

function expandAvailabilityWindows(value: z.infer<typeof memberAvailabilityBaseSchema>): AvailabilityWindow[] {
  const windows: AvailabilityWindow[] = [];
  AVAILABILITY_DAY_KEYS.forEach((day, weekday) => {
    value.days[day].forEach((range) => {
      const startMinute = timeToMinutes(range.start_utc);
      const endMinute = timeToMinutes(range.end_utc);
      if (endMinute > startMinute) {
        windows.push({ weekday, startMinute, endMinute });
        return;
      }
      windows.push({ weekday, startMinute, endMinute: 24 * 60 });
      if (endMinute > 0) {
        windows.push({ weekday: (weekday + 1) % 7, startMinute: 0, endMinute });
      }
    });
  });
  return windows;
}

export const memberAvailabilitySchema = memberAvailabilityBaseSchema.superRefine((value, ctx) => {
  AVAILABILITY_DAY_KEYS.forEach((day) => {
    value.days[day].forEach((range, index) => {
      if (timeToMinutes(range.start_utc) === timeToMinutes(range.end_utc)) {
        ctx.addIssue({
          code: "custom",
          path: ["days", day, index, "end_utc"],
          message: "Availability range must have a non-zero duration",
        });
      }
    });
  });

  const previousByDay = new Map<number, AvailabilityWindow>();
  for (const window of expandAvailabilityWindows(value).sort(
    (left, right) => left.weekday - right.weekday || left.startMinute - right.startMinute || left.endMinute - right.endMinute,
  )) {
    const previous = previousByDay.get(window.weekday);
    if (previous && window.startMinute < previous.endMinute) {
      ctx.addIssue({
        code: "custom",
        path: ["days", AVAILABILITY_DAY_KEYS[window.weekday]!],
        message: "Availability ranges must not overlap",
      });
    }
    if (!previous || window.endMinute > previous.endMinute) previousByDay.set(window.weekday, window);
  }
});

export type AvailabilityDayKey = (typeof AVAILABILITY_DAY_KEYS)[number];
export type MemberAvailability = z.infer<typeof memberAvailabilitySchema>;
export type AvailabilityWindow = { weekday: number; startMinute: number; endMinute: number };

export function availabilityToWindows(value: MemberAvailability): AvailabilityWindow[] {
  const parsed = memberAvailabilitySchema.parse(value);
  const merged: AvailabilityWindow[] = [];
  for (const window of expandAvailabilityWindows(parsed).sort(
    (left, right) => left.weekday - right.weekday || left.startMinute - right.startMinute || left.endMinute - right.endMinute,
  )) {
    const previous = merged[merged.length - 1];
    if (previous && previous.weekday === window.weekday && window.startMinute === previous.endMinute) {
      previous.endMinute = window.endMinute;
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

function minutesToTime(value: number): string {
  if (value === 24 * 60) return "24:00";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function availabilityFromWindows(timezone: string, windows: readonly AvailabilityWindow[]): MemberAvailability {
  const days: MemberAvailability["days"] = {
    sunday: [],
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
  };
  for (const window of windows) {
    if (
      !Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6 ||
      !Number.isInteger(window.startMinute) || window.startMinute < 0 || window.startMinute > 1439 ||
      !Number.isInteger(window.endMinute) || window.endMinute < 1 || window.endMinute > 1440 ||
      window.startMinute >= window.endMinute
    ) {
      throw new Error("Invalid member availability window row");
    }
    days[AVAILABILITY_DAY_KEYS[window.weekday]!].push({
      start_utc: minutesToTime(window.startMinute),
      end_utc: minutesToTime(window.endMinute),
    });
  }
  return memberAvailabilitySchema.parse({ timezone, days });
}

// Write-side only. `z.string().url()` accepts `javascript:` and `data:`, so the
// host allowlist has to be enforced here and not just in the profile form —
// these URLs are later rendered as anchor hrefs and video embeds.
const writableVideoUrlSchema = z
  .string()
  .url()
  .refine(isAllowedVideoUrl, {
    message: "Video URL must be from an allowed host (YouTube, Bilibili, Vimeo, TikTok, Douyin)",
  });

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.string().min(1),
  permissions: z.record(permissionKeySchema, z.boolean()),
  is_active: z.boolean(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).extend(roleMetadataSchema.shape);

export const memberProfileSchema = z.object({
  user_id: z.string(),
  power: z.number().min(0),
  classes: z
    .array(classIdSchema)
    .max(20)
    .refine((values) => new Set(values).size === values.length, {
      message: "Classes must be unique",
    }),
  title_html: z.string().max(L.profileTitleHtml.max).nullable(),
  bio: z.string().max(L.profileBio.max).nullable(),
  avatar_media_id: mediaIdSchema.nullable(),
  images: z.array(mediaIdSchema).max(L.profileImages.max),
  audio_media_id: mediaIdSchema.nullable(),
  audio_name: z.string().max(255).nullable(),
  video_urls: z.array(z.string().url()).max(L.profileVideoUrls.max),
  availability: memberAvailabilitySchema.nullable(),
  vacation_start: z.string().nullable(),
  vacation_end: z.string().nullable(),
  notes: z.string().max(L.profileNotes.max).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Avatar and audio media IDs are deliberately absent: they are owned by the
// dedicated upload/delete endpoints. Accepting them here would let a member
// attach an arbitrary media asset to a protected single-value slot.
// `images` stays writable for reorder/remove, but UserService.updateProfile
// rejects media IDs that are not already linked to the target profile.
export const updateProfileSchema = memberProfileSchema
  .pick({
    power: true,
    classes: true,
    title_html: true,
    bio: true,
    images: true,
    availability: true,
  })
  .partial()
  .extend({
    video_urls: z.array(writableVideoUrlSchema).max(L.profileVideoUrls.max).optional(),
  });

// `role` and `is_active` are not accepted here: they live in
// PATCH /api/admin/users/:id/role and the activate/deactivate endpoints.
// Declaring them made the request look successful while the values were dropped.
export const adminUpdateProfileSchema = updateProfileSchema.extend({
  notes: z.string().max(L.profileNotes.max).nullable().optional(),
});

export const deleteProfileImagesSchema = z.object({
  media_ids: z.array(mediaIdSchema).min(L.profileImagesDeleteBatch.min).max(L.profileImagesDeleteBatch.max),
});
