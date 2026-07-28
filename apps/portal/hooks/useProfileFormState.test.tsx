// @vitest-environment jsdom
import type { MemberProfile } from "@guild/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
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
    id: "profile-1",
    user_id: "user-1",
    power: 100,
    classes: ["Berserker"],
    title_html: null,
    bio: "Server bio",
    avatar_key: null,
    images: ["profiles/user-1/one.webp"],
    audio_key: null,
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

describe("useProfileFormState", () => {
  it("preserves unsaved fields when a same-profile media refresh arrives", async () => {
    const initialProfile = createProfile();
    const { result, rerender } = renderHook(
      ({ profile }) => useProfileFormState({ profile }),
      { initialProps: { profile: initialProfile } },
    );

    act(() => {
      result.current.setBio("Unsaved bio");
      result.current.setAvailabilityData({ days: { monday: [{ start_utc: "09:00", end_utc: "10:00" }] } });
    });

    rerender({
      profile: createProfile({
        avatar_key: "profiles/user-1/avatar.webp",
        images: ["profiles/user-1/one.webp", "profiles/user-1/two.webp"],
        updated_at: "2026-07-02T00:00:00.000Z",
      }),
    });

    await waitFor(() => {
      expect(result.current.imageList).toEqual([
        "profiles/user-1/one.webp",
        "profiles/user-1/two.webp",
      ]);
    });
    expect(result.current.bio).toBe("Unsaved bio");
    expect(result.current.availabilityData).toEqual({
      days: { monday: [{ start_utc: "09:00", end_utc: "10:00" }] },
    });
    expect(result.current.isDirty).toBe(true);
  });

  it("accepts a successful save as the new baseline without overwriting newer edits", () => {
    const initialProfile = createProfile();
    const { result } = renderHook(() => useProfileFormState({ profile: initialProfile }));

    act(() => {
      result.current.setBio("Saved bio");
    });
    act(() => {
      result.current.acceptServerProfile(createProfile({ bio: "Saved bio" }));
    });

    expect(result.current.bio).toBe("Saved bio");
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.setBio("Newer local edit");
      result.current.acceptServerProfile(createProfile({ bio: "Saved bio" }));
    });

    expect(result.current.bio).toBe("Newer local edit");
    expect(result.current.isDirty).toBe(true);
  });
});
