import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../constants/roles";
import {
  adminUpdateProfileSchema,
  availabilityFromWindows,
  availabilityToWindows,
  memberAvailabilitySchema,
  memberProfileSchema,
  type MemberAvailability,
  updateProfileSchema,
  userSchema,
} from "./user";

function emptyAvailability(timezone = "UTC"): MemberAvailability {
  return {
    timezone,
    days: {
      sunday: [],
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
    },
  };
}

describe("memberProfileSchema", () => {
  it("uses user_id as the sole profile identity", () => {
    expect(memberProfileSchema.partial().parse({
      id: "legacy-profile-id",
      user_id: "user-1",
    })).toEqual({ user_id: "user-1" });
  });

  it("accepts a nullable audio display name up to 255 characters", () => {
    expect(memberProfileSchema.partial().safeParse({ audio_name: null }).success).toBe(true);
    expect(memberProfileSchema.partial().safeParse({ audio_name: "a".repeat(255) }).success).toBe(true);
    expect(memberProfileSchema.partial().safeParse({ audio_name: "a".repeat(256) }).success).toBe(false);
  });
});

describe("memberAvailabilitySchema", () => {
  it("requires a strict seven-day UTC schedule and a real IANA timezone", () => {
    const availability = emptyAvailability("UTC");
    availability.days.monday.push({ start_utc: "09:00", end_utc: "17:00" });

    expect(memberAvailabilitySchema.parse(availability)).toEqual(availability);
    expect(memberAvailabilitySchema.safeParse({
      ...availability,
      timezone: "Mars/Olympus",
    }).success).toBe(false);
    expect(memberAvailabilitySchema.safeParse({
      timezone: "UTC",
      days: { ...availability.days, saturday: undefined },
    }).success).toBe(false);
    expect(memberAvailabilitySchema.safeParse({
      ...availability,
      extra: true,
    }).success).toBe(false);
    expect(memberAvailabilitySchema.safeParse({
      ...availability,
      days: { ...availability.days, extra: [] },
    }).success).toBe(false);
  });

  it("enforces exact UTC time bounds and rejects zero-length or overlapping ranges", () => {
    const availability = emptyAvailability();
    availability.days.tuesday.push(
      { start_utc: "09:00", end_utc: "12:00" },
      { start_utc: "12:00", end_utc: "24:00" },
    );
    expect(memberAvailabilitySchema.safeParse(availability).success).toBe(true);

    for (const range of [
      { start_utc: "24:00", end_utc: "24:00" },
      { start_utc: "09:00", end_utc: "00:00" },
      { start_utc: "9:00", end_utc: "10:00" },
      { start_utc: "09:00", end_utc: "09:00" },
    ]) {
      const candidate = emptyAvailability();
      candidate.days.tuesday.push(range);
      expect(memberAvailabilitySchema.safeParse(candidate).success).toBe(false);
    }

    const overlap = emptyAvailability();
    overlap.days.friday.push(
      { start_utc: "08:00", end_utc: "12:00" },
      { start_utc: "11:59", end_utc: "13:00" },
    );
    expect(memberAvailabilitySchema.safeParse(overlap).success).toBe(false);
  });

  it("maps the strict API contract to normalized UTC window rows and back", () => {
    const availability = emptyAvailability("America/New_York");
    availability.days.saturday.push({ start_utc: "23:00", end_utc: "02:00" });

    expect(availabilityToWindows(availability)).toEqual([
      { weekday: 0, startMinute: 0, endMinute: 120 },
      { weekday: 6, startMinute: 1380, endMinute: 1440 },
    ]);
    expect(availabilityFromWindows("UTC", [
      { weekday: 1, startMinute: 60, endMinute: 120 },
    ])).toEqual({
      ...emptyAvailability("UTC"),
      days: {
        ...emptyAvailability("UTC").days,
        monday: [{ start_utc: "01:00", end_utc: "02:00" }],
      },
    });
  });
});

describe("updateProfileSchema", () => {
  it("accepts catalog and persisted class IDs while rejecting duplicates", () => {
    expect(updateProfileSchema.safeParse({
      classes: ["new-catalog-id", "历史职业"],
    }).success).toBe(true);

    expect(updateProfileSchema.safeParse({
      classes: ["same", "same"],
    }).success).toBe(false);
  });

  it("does not accept media IDs owned by the upload endpoints", () => {
    const parsed = updateProfileSchema.parse({
      bio: "hi",
      avatar_media_id: "media1234567890abcdef",
      audio_media_id: "audio1234567890abcdef",
    });

    expect(parsed).toEqual({ bio: "hi" });
    expect(parsed).not.toHaveProperty("avatar_media_id");
    expect(parsed).not.toHaveProperty("audio_media_id");
  });

  it("rejects video URLs whose host is not on the allowlist", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "https://evil.example.com/clip.mp4",
    ]) {
      expect(updateProfileSchema.safeParse({ video_urls: [url] }).success).toBe(false);
    }
  });

  it("accepts video URLs from allowed hosts", () => {
    const parsed = updateProfileSchema.safeParse({
      video_urls: [
        "https://www.youtube.com/watch?v=abc123",
        "https://youtu.be/abc123",
        "https://www.bilibili.com/video/BV1xx411c7mD",
        "https://vimeo.com/12345",
        "https://www.douyin.com/video/12345",
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("keeps read-side parsing independent from the write allowlist", () => {
    // Stored URLs remain readable if the write allowlist changes; validation is
    // enforced only when a profile submits a new value.
    const parsed = memberProfileSchema.partial().safeParse({
      video_urls: ["https://evil.example.com/clip.mp4"],
    });

    expect(parsed.success).toBe(true);
  });
});

describe("adminUpdateProfileSchema", () => {
  it("accepts notes but not role or activation state", () => {
    const parsed = adminUpdateProfileSchema.parse({
      notes: "trial member",
      role: "admin",
      is_active: false,
    });

    expect(parsed).toEqual({ notes: "trial member" });
  });
});

describe("userSchema role metadata", () => {
  it("requires the D1 role name, color, and level", () => {
    const base = {
      id: "user-1",
      username: "Member",
      role: "raider",
      permissions: Object.fromEntries(PERMISSIONS.map((permission) => [permission, false])),
      is_active: true,
      deleted_at: null,
      created_at: "2026-08-05T00:00:00.000Z",
      updated_at: "2026-08-05T00:00:00.000Z",
    };

    expect(userSchema.safeParse(base).success).toBe(false);
    expect(userSchema.safeParse({
      ...base,
      role_name: "Raider",
      role_color: "#123456",
      role_level: 200,
    }).success).toBe(true);
  });
});
