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
  fetchUsersListWithOptions,
  fetchMemberDirectory,
  fetchMemberIdentities,
  fetchUserDetail,
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

  it("fetches one requested list page with explicit filters and totals", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ data: [], total: 1000, page: 3, limit: 24, total_pages: 42 }));
    const result = await fetchUsersListWithOptions({ externalView: true, page: 3, limit: 24, includeTotal: true, classIds: ["warrior", "mage"], sort: "power", direction: "desc", search: "Alice", searchScope: "name" });
    expect(result.total).toBe(1000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const query = new URL(String(mockFetch.mock.calls[0]![0]), "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({ page: "3", limit: "24", sort: "power", direction: "desc", search: "Alice", external_view: "true", search_scope: "name" });
    expect(JSON.parse(query.get("classes")!)).toEqual(["mage", "warrior"]);
    expect(query.get("include_total")).toBe("true");
  });

  it("leaves directory pagination under caller control and keeps the external detail projection", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ data: [], next_cursor: "next-page" }));
    expect((await fetchMemberDirectory({ externalView: true, search: "Alice" })).next_cursor).toBe("next-page");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ user: { id: "u-1" }, profile: profileResponse, badges: [] }));
    await fetchUserDetail("u-1", { externalView: true });
    expect(String(mockFetch.mock.calls[1]![0])).toBe("/api/users/u-1?external_view=true");
  });

  it("deduplicates known identity IDs and keeps each request and parallel worker count bounded", async () => {
    let inFlight = 0;
    let peak = 0;
    mockFetch.mockImplementation(async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      const query = new URL(url, "http://localhost").searchParams;
      const ids = JSON.parse(query.get("ids")!) as string[];
      expect(ids.length).toBeLessThanOrEqual(100);
      expect(query.get("external_view")).toBe("true");
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return mockJsonResponse({ data: ids.map((id) => ({ user: { id, display_name: id }, profile: { classes: [], power: 0, avatar_media_id: null } })), next_cursor: null });
    });
    const ids = Array.from({ length: 305 }, (_, index) => `u-${index}`);
    const result = await fetchMemberIdentities([...ids, ids[0]!], { externalView: true });
    expect(result.data).toHaveLength(305);
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(peak).toBe(3);
  });
});
