// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const profileResponse = {
  user_id: "u-1",
  power: 0,
  classes: [],
  title_html: null,
  bio: null,
  avatar_media_id: null,
  images: [],
  audio_media_id: null,
  audio_name: null,
  video_urls: [],
  availability: null,
  vacation_start: null,
  vacation_end: null,
  notes: null,
  created_at: "2026-08-30T00:00:00.000Z",
  updated_at: "2026-08-30T00:00:00.000Z",
};

import {
  updateMyProfile,
  updateOwnProfile,
  deleteProfileImage,
  deleteProfileImages,
  deleteProfileAudio,
  uploadProfileAudio,
  fetchAllUsersListWithOptions,
} from "../UserService";

describe("UserService mutations", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("uses the committed JSON profile revision when a success response has no ETag", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      ...profileResponse,
      profile_revision_token: "profile-v2",
    }));
    const result = await updateMyProfile(
      "u-1",
      { classes: ["鸣金虹"], power: 5000, display_name: "Member_2" },
      "profile-v1",
    );
    expect(result.profileRevisionToken).toBe("profile-v2");
    expect(result.profile).not.toHaveProperty("profile_revision_token");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/users/u-1/profile");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body);
    expect(body.classes).toEqual(["鸣金虹"]);
    expect(body.power).toBe(5000);
    expect(body.display_name).toBe("Member_2");
    expect(new Headers(init.headers).get("If-Match")).toBe('"member-profile-profile-v1"');
  });

  it("updateOwnProfile sends the frozen profile revision and retains the response revision", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      ...profileResponse,
      bio: "Saved",
      profile_revision_token: "profile-v2",
    }));

    await expect(updateOwnProfile("u-1", { bio: "Saved" }, "profile-v1")).resolves.toMatchObject({
      profile: { user_id: "u-1" },
      profileRevisionToken: "profile-v2",
    });
    const [, init] = mockFetch.mock.calls[0]!;
    expect(new Headers(init.headers).get("If-Match")).toBe('"member-profile-profile-v1"');
  });

  it("deleteProfileImage sends one-media-id delete request", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, deleted: 1, profile_revision_token: "profile-v2" }));
    await deleteProfileImage("u-1", "image1234567890abcdef", "profile-v1");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/users/u-1/media/images");
    expect(url).not.toContain("batch");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({
      media_ids: ["image1234567890abcdef"],
    });
    expect(new Headers(init.headers).get("If-Match")).toBe('"member-profile-profile-v1"');
  });

  it("deleteProfileImages sends one delete request", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, deleted: 2, profile_revision_token: "profile-v2" }));
    await deleteProfileImages("u-1", ["image1234567890abcdef", "second1234567890abcde"], "profile-v1");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/users/u-1/media/images");
    expect(url).not.toContain("batch");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({
      media_ids: ["image1234567890abcdef", "second1234567890abcde"],
    });
    expect(new Headers(init.headers).get("If-Match")).toBe('"member-profile-profile-v1"');
  });

  it("deleteProfileAudio sends DELETE to audio endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, profile_revision_token: "profile-v2" }));
    await deleteProfileAudio("u-1", "profile-v1");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/users/u-1/media/audio");
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("If-Match")).toBe('"member-profile-profile-v1"');
  });

  it("uploadProfileAudio sends the canonical Ogg/Opus file without converting it again", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      media_id: "audio1234567890abcdef",
      profile_revision_token: "profile-v2",
    }));
    const canonicalAudioFile = new File(["opus"], "voice.ogg", { type: "audio/ogg; codecs=opus" });

    await uploadProfileAudio("u-1", canonicalAudioFile, "profile-v1");

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/api/users/u-1/media/audio");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const uploaded = (init.body as FormData).get("file");
    expect(uploaded).toBe(canonicalAudioFile);
    expect(new Headers(init.headers).get("If-Match")).toBe('"member-profile-profile-v1"');
  });

  it("fetchAllUsersListWithOptions follows pages until the final partial page", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      user: { id: `u-${index}`, display_name: `user-${index}` },
      profile: {},
      badges: [],
    }));
    const secondPage = [
      { user: { id: "u-50", display_name: "user-50" }, profile: {}, badges: [] },
    ];
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ data: firstPage, page: 1, limit: 50 }))
      .mockResolvedValueOnce(mockJsonResponse({ data: secondPage, page: 2, limit: 50 }));

    const result = await fetchAllUsersListWithOptions({ externalView: true });

    expect(result.data).toHaveLength(51);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[0]![0])).toContain("page=1");
    expect(String(mockFetch.mock.calls[0]![0])).toContain("limit=50");
    expect(String(mockFetch.mock.calls[0]![0])).toContain("include_total=false");
    expect(String(mockFetch.mock.calls[0]![0])).toContain("external_view=true");
    expect(String(mockFetch.mock.calls[1]![0])).toContain("page=2");
    expect(String(mockFetch.mock.calls[1]![0])).toContain("limit=50");
  });
});
