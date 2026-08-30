import type { MemberAvailability, MemberProfile } from "@guild/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryHarness } from "@portal/tests/query-harness";
import { describe, expect, it, vi } from "vitest";
import { useProfileFormState } from "./useProfileFormState";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("./useAppError", () => ({
  useAppError: () => ({
    showError: vi.fn(),
  }),
}));

function createProfile(overrides: Partial<MemberProfile> = {}): MemberProfile {
  return {
    user_id: "user-1",
    power: 100,
    classes: ["Berserker"],
    title_html: null,
    bio: "Server bio",
    avatar_media_id: null,
    images: ["image1234567890abcdef"],
    audio_media_id: null,
    audio_name: null,
    video_urls: [],
    availability: null,
    vacation_start: null,
    vacation_end: null,
    notes: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function availability(
  days: Partial<MemberAvailability["days"]>,
  timezone = "Asia/Shanghai",
): MemberAvailability {
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
      ...days,
    },
  };
}

describe("useProfileFormState", () => {
  it("freezes a dirty form until a same-profile refresh can be adopted atomically", async () => {
    const initialProfile = createProfile();
    const { result, rerender } = renderHook(
      ({ profile, displayName }) => useProfileFormState({ profile, displayName }),
      { initialProps: { profile: initialProfile, displayName: "Member" }, wrapper: QueryHarness },
    );

    act(() => {
      result.current.setBio("Unsaved bio");
      result.current.setAvailabilityData(availability({
        monday: [{ start_utc: "09:00", end_utc: "10:00" }],
      }));
    });

    rerender({
      profile: createProfile({
        avatar_media_id: "avatar1234567890abcde",
        images: ["image1234567890abcdef", "second1234567890abcde"],
        updated_at: "2026-07-02T00:00:00.000Z",
      }),
      displayName: "Member",
    });

    await waitFor(() => {
      expect(result.current.imageList).toEqual(["image1234567890abcdef"]);
    });
    expect(result.current.bio).toBe("Unsaved bio");
    expect(result.current.availabilityData).toEqual({
      timezone: "Asia/Shanghai",
      days: {
        sunday: [],
        monday: [{ start_utc: "09:00", end_utc: "10:00" }],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
      },
    });
    expect(result.current.isDirty).toBe(true);
  });

  it("keeps the editor-open profile revision when a dirty draft receives a background refresh", async () => {
    const initialProfile = createProfile();
    const { result, rerender } = renderHook(
      ({ profile, profileRevisionToken }) => useProfileFormState({
        profile,
        displayName: "Member",
        profileRevisionToken,
      }),
      {
        initialProps: {
          profile: initialProfile,
          profileRevisionToken: "profile-v1",
        },
        wrapper: QueryHarness,
      },
    );

    act(() => {
      result.current.setBio("Unsaved bio");
    });
    rerender({
      profile: createProfile({ bio: "Remote bio", updated_at: "2026-07-02T00:00:00.000Z" }),
      profileRevisionToken: "profile-v2",
    });

    await waitFor(() => {
      expect(result.current.profileRevisionToken).toBe("profile-v1");
    });
    expect(result.current.bio).toBe("Unsaved bio");
    expect(result.current.isDirty).toBe(true);
  });

  it("adopts the newest deferred profile snapshot and revision together when a draft is reverted", async () => {
    const initialProfile = createProfile();
    const refreshedProfile = createProfile({
      bio: "Server C bio",
      video_urls: ["https://vimeo.com/server-c"],
      images: ["c-image1234567890abcdef"],
      updated_at: "2026-07-03T00:00:00.000Z",
    });
    const { result, rerender } = renderHook(
      ({ profile, displayName, profileRevisionToken }) => useProfileFormState({
        profile,
        displayName,
        profileRevisionToken,
      }),
      {
        initialProps: {
          profile: initialProfile,
          displayName: "Member A",
          profileRevisionToken: "profile-v1",
        },
        wrapper: QueryHarness,
      },
    );

    act(() => result.current.setBio("Local B draft"));
    rerender({
      profile: refreshedProfile,
      displayName: "Member C",
      profileRevisionToken: "profile-v2",
    });
    // A delayed GET for the editor-open revision must not replace the newer deferred snapshot.
    rerender({
      profile: initialProfile,
      displayName: "Member A",
      profileRevisionToken: "profile-v1",
    });

    act(() => result.current.setBio("Server bio"));

    await waitFor(() => {
      expect(result.current.profileRevisionToken).toBe("profile-v2");
      expect(result.current.displayName).toBe("Member C");
      expect(result.current.bio).toBe("Server C bio");
      expect(result.current.videoList).toEqual(["https://vimeo.com/server-c"]);
      expect(result.current.imageList).toEqual(["c-image1234567890abcdef"]);
      expect(result.current.isDirty).toBe(false);
    });
  });

  it("adopts a newer profile revision only while the form is clean", async () => {
    const profile = createProfile();
    const { result, rerender } = renderHook(
      ({ profileRevisionToken }) => useProfileFormState({
        profile,
        displayName: "Member",
        profileRevisionToken,
      }),
      { initialProps: { profileRevisionToken: "profile-v1" }, wrapper: QueryHarness },
    );

    rerender({ profileRevisionToken: "profile-v2" });

    await waitFor(() => {
      expect(result.current.profileRevisionToken).toBe("profile-v2");
    });
    expect(result.current.isDirty).toBe(false);
  });

  it("rejects a late editor-open revision after its own profile save advances the token", async () => {
    const initialProfile = createProfile();
    const savedProfile = createProfile({ bio: "Saved v2 bio", updated_at: "2026-07-03T00:00:00.000Z" });
    const { result, rerender } = renderHook(
      ({ profile, profileRevisionToken }) => useProfileFormState({
        profile,
        displayName: "Member",
        profileRevisionToken,
      }),
      {
        initialProps: { profile: initialProfile, profileRevisionToken: "profile-v1" },
        wrapper: QueryHarness,
      },
    );

    act(() => result.current.setBio("Saved v2 bio"));
    const submitted = {
      displayName: result.current.displayName,
      bio: result.current.bio,
      titleHtml: result.current.titleHtml,
      power: result.current.power,
      classList: result.current.classList,
      videoList: result.current.videoList,
      imageList: result.current.imageList,
      availabilityData: result.current.availabilityData,
    };
    act(() => result.current.acceptServerProfile(savedProfile, "Member", submitted, "profile-v2"));
    rerender({ profile: initialProfile, profileRevisionToken: "profile-v1" });

    expect(result.current.profileRevisionToken).toBe("profile-v2");
    expect(result.current.bio).toBe("Saved v2 bio");
  });

  it("accepts its own media revision without turning that media change into a stale draft", () => {
    const profile = createProfile();
    const { result } = renderHook(
      () => useProfileFormState({ profile, displayName: "Member", profileRevisionToken: "profile-v1" }),
      { wrapper: QueryHarness },
    );

    act(() => {
      result.current.acceptOwnImageUpload(["second1234567890abcde"], "profile-v2");
    });

    expect(result.current.profileRevisionToken).toBe("profile-v2");
    expect(result.current.isDirty).toBe(false);
  });

  it("clears the unsaved marker when an availability edit is undone", () => {
    /* 必须在 renderHook 外面建好：profile 的 identity 变了就会重跑基线同步，
       每次渲染新建一个对象会把 hook 送进死循环。 */
    const profile = createProfile();
    const { result } = renderHook(() => useProfileFormState({ profile, displayName: "Member" }), { wrapper: QueryHarness });

    act(() => {
      result.current.setAvailabilityData(availability({
        monday: [{ start_utc: "12:00", end_utc: "16:00" }],
      }));
    });
    expect(result.current.dirtySections.availability).toBe(true);

    /* 删光时段之后编辑器交回来的是七个空数组，而基线是 null。语义上没有改动，
       保存条就不该继续亮着。 */
    act(() => {
      result.current.setAvailabilityData({
        timezone: "Asia/Shanghai",
        days: {
          monday: [], tuesday: [], wednesday: [], thursday: [],
          friday: [], saturday: [], sunday: [],
        },
      });
    });
    expect(result.current.dirtySections.availability).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it("ignores key order and empty days when comparing availability", () => {
    const profile = createProfile({
      availability: availability({
        monday: [{ start_utc: "12:00", end_utc: "16:00" }],
      }),
    });
    const { result } = renderHook(() => useProfileFormState({ profile, displayName: "Member" }), { wrapper: QueryHarness });

    act(() => {
      result.current.setAvailabilityData({
        days: {
          sunday: [], saturday: [], friday: [], thursday: [], wednesday: [], tuesday: [],
          monday: [{ end_utc: "16:00", start_utc: "12:00" }],
        },
        timezone: "Asia/Shanghai",
      });
    });

    expect(result.current.dirtySections.availability).toBe(false);
  });

  it("accepts a successful save as the new baseline without overwriting newer edits", () => {
    const initialProfile = createProfile();
    const { result } = renderHook(() => useProfileFormState({ profile: initialProfile, displayName: "Member" }), { wrapper: QueryHarness });

    act(() => {
      result.current.setBio("Saved bio");
    });
    act(() => {
      result.current.acceptServerProfile(createProfile({ bio: "Saved bio" }), "Member");
    });

    expect(result.current.bio).toBe("Saved bio");
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.setBio("Newer local edit");
      result.current.acceptServerProfile(createProfile({ bio: "Saved bio" }), "Member");
    });

    expect(result.current.bio).toBe("Newer local edit");
    expect(result.current.isDirty).toBe(true);
  });

  it("takes the server's normalised value for fields untouched since the submit", () => {
    /* 服务端会把称号 HTML 过一遍白名单清洗，回来的和送出去的不是同一串。
       不校准草稿的话 isDirty 永远为真——存成功了，「未保存更改」却撤不掉。 */
    /* profile 必须在 renderHook 外面建好：每次渲染都传一个新对象的话，
       同步基线的 effect 会每渲染一次就 setState 一次，直接转成死循环。 */
    const initialProfile = createProfile();
    const { result } = renderHook(() => useProfileFormState({ profile: initialProfile, displayName: "Member" }), { wrapper: QueryHarness });

    act(() => {
      result.current.setTitleHtml("<p>Guild Leader</p>");
      result.current.setBio("Bio the user kept editing");
    });

    const submitted = {
      displayName: result.current.displayName,
      bio: "Bio the user kept editing",
      titleHtml: "<p>Guild Leader</p>",
      power: result.current.power,
      classList: result.current.classList,
      videoList: result.current.videoList,
      imageList: result.current.imageList,
      availabilityData: result.current.availabilityData,
    };

    act(() => {
      // 请求在飞的时候用户又动了简介，但没再碰称号。
      result.current.setBio("Newer local edit");
      result.current.acceptServerProfile(
        createProfile({ title_html: "Guild Leader", bio: "Bio the user kept editing" }),
        "Member",
        submitted,
      );
    });

    expect(result.current.titleHtml, "没再动过的字段要换成清洗后的结果").toBe("Guild Leader");
    expect(result.current.bio, "飞行途中改的那一笔必须留住").toBe("Newer local edit");
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.setBio("Bio the user kept editing");
    });
    expect(result.current.isDirty, "把那一笔改回去之后，未保存提示就该消失").toBe(false);
  });

  it("keeps a newer public display-name edit while accepting a save response", () => {
    const initialProfile = createProfile();
    const { result } = renderHook(
      () => useProfileFormState({ profile: initialProfile, displayName: "Member" }),
      { wrapper: QueryHarness },
    );

    act(() => {
      result.current.setDisplayName("Saved Member");
    });
    const submitted = {
      displayName: "Saved Member",
      bio: result.current.bio,
      titleHtml: result.current.titleHtml,
      power: result.current.power,
      classList: result.current.classList,
      videoList: result.current.videoList,
      imageList: result.current.imageList,
      availabilityData: result.current.availabilityData,
    };

    act(() => {
      result.current.setDisplayName("Newer Member");
      result.current.acceptServerProfile(createProfile(), "Saved Member", submitted);
    });

    expect(result.current.displayName).toBe("Newer Member");
    expect(result.current.dirtySections.home).toBe(true);
  });
});
