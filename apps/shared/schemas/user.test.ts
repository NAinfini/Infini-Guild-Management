import { describe, expect, it } from "vitest";
import { adminUpdateProfileSchema, memberProfileSchema, updateProfileSchema } from "./user";

describe("updateProfileSchema", () => {
  it("accepts dynamic and legacy class IDs while rejecting duplicates", () => {
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

  it("still parses legacy rows on the read side", () => {
    // Read-side parsing must not fail on URLs stored before the allowlist
    // existed, otherwise the roster stops rendering for everyone.
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
