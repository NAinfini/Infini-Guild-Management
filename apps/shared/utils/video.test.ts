import { describe, expect, it } from "vitest";
import {
  isAllowedVideoUrl,
  isEmbeddableVideoUrl,
  toEmbedVideoUrl,
} from "./video";

describe("video URL host validation", () => {
  it("allows exact provider hosts and their subdomains", () => {
    expect(isAllowedVideoUrl("https://youtube.com/watch?v=abc")).toBe(true);
    expect(isAllowedVideoUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isEmbeddableVideoUrl("https://player.vimeo.com/video/123")).toBe(true);
  });

  it("rejects lookalike hosts and non-HTTP protocols", () => {
    expect(isAllowedVideoUrl("https://youtube.com.evil.example/watch?v=abc")).toBe(false);
    expect(isEmbeddableVideoUrl("https://notyoutube.com/watch?v=abc")).toBe(false);
    expect(isAllowedVideoUrl("ftp://youtube.com/video.mp4")).toBe(false);
  });

  it("does not transform lookalike provider hosts", () => {
    const lookalike = "https://youtube.com.evil.example/watch?v=abc";
    expect(toEmbedVideoUrl(lookalike)).toBe(lookalike);
  });

  it("uses the CSP-approved privacy-enhanced host for YouTube embeds", () => {
    expect(toEmbedVideoUrl("https://youtube.com/watch?v=abc")).toBe(
      "https://www.youtube-nocookie.com/embed/abc",
    );
    expect(toEmbedVideoUrl("https://youtu.be/abc")).toBe(
      "https://www.youtube-nocookie.com/embed/abc",
    );
  });

  it("leaves direct video URLs and other provider conversions unchanged", () => {
    const directUrl = "https://cdn.example.com/raid.mp4";
    expect(toEmbedVideoUrl(directUrl)).toBe(directUrl);
    expect(toEmbedVideoUrl("https://vimeo.com/123")).toBe(
      "https://player.vimeo.com/video/123",
    );
  });
});
