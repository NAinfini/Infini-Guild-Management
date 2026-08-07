import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../constants/roles";
import { adminUpdateProfileSchema, memberProfileSchema, updateProfileSchema, userSchema } from "./user";

describe("updateProfileSchema", () => {
  it("accepts catalog and persisted class IDs while rejecting duplicates", () => {
    expect(updateProfileSchema.safeParse({
      classes: ["new-catalog-id", "历史职业"],
    }).success).toBe(true);

    expect(updateProfileSchema.safeParse({
      classes: ["same", "same"],
    }).success).toBe(false);
  });

  it("does not accept media keys owned by the upload endpoints", () => {
    const parsed = updateProfileSchema.parse({
      bio: "hi",
      avatar_key: "members/victim/avatar.webp",
      audio_key: "members/victim/theme.opus",
    });

    expect(parsed).toEqual({ bio: "hi" });
    expect(parsed).not.toHaveProperty("avatar_key");
    expect(parsed).not.toHaveProperty("audio_key");
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
