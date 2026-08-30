import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../api/query-keys";
import { useProfileMutations } from "./useProfileMutations";

const serviceMocks = vi.hoisted(() => ({
  changeMyPassword: vi.fn(),
  changeMyUsername: vi.fn(),
  deleteProfileAudio: vi.fn(),
  deleteProfileImage: vi.fn(),
  updateOwnProfile: vi.fn(),
}));
const setProfileMock = vi.hoisted(() => vi.fn());
const setSessionMock = vi.hoisted(() => vi.fn());
const notifySuccessMock = vi.hoisted(() => vi.fn());

vi.mock("../services/UserService", () => serviceMocks);
vi.mock("../services/AuthService", () => ({ logout: vi.fn() }));
vi.mock("../stores/auth", () => ({
  useAuthStore: (selector: (state: {
    user: { id: string };
    sessionScope: "normal";
    setSession: typeof setSessionMock;
    setProfile: typeof setProfileMock;
  }) => unknown) => selector({
    user: { id: "user-1" },
    sessionScope: "normal",
    setSession: setSessionMock,
    setProfile: setProfileMock,
  }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./useAppError", () => ({
  useAppError: () => ({ showError: vi.fn() }),
}));
vi.mock("../session-transition", () => ({ transitionSession: vi.fn() }));
vi.mock("../utils/notifications", () => ({ notifySuccess: notifySuccessMock }));

type MutationParams = Parameters<typeof useProfileMutations>[0];

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useProfileMutations", () => {
  beforeEach(() => {
    for (const mock of Object.values(serviceMocks)) mock.mockReset();
    setProfileMock.mockReset();
    setSessionMock.mockReset();
    notifySuccessMock.mockReset();
  });

  it.each(["image", "audio"] as const)("adopts the committed revision after removing profile %s", async (kind) => {
    serviceMocks.deleteProfileImage.mockResolvedValue({ profileRevisionToken: "profile-v2" });
    serviceMocks.deleteProfileAudio.mockResolvedValue({ profileRevisionToken: "profile-v2" });
    const form = {
      profileRevisionToken: "profile-v1",
      acceptOwnImageRemoval: vi.fn(),
      acceptOwnMediaRevision: vi.fn(),
    } as unknown as MutationParams["form"];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useProfileMutations({
      form,
      imageUploader: { upload: vi.fn() } as unknown as MutationParams["imageUploader"],
      audioUploader: { upload: vi.fn() } as unknown as MutationParams["audioUploader"],
    }), { wrapper: createWrapper(queryClient) });

    act(() => kind === "image" ? result.current.removeImage("image-1") : result.current.removeAudio());

    if (kind === "image") {
      await waitFor(() => expect(form.acceptOwnImageRemoval).toHaveBeenCalledWith("image-1", "profile-v2"));
      expect(serviceMocks.deleteProfileImage).toHaveBeenCalledWith("user-1", "image-1", "profile-v1");
    } else {
      await waitFor(() => expect(form.acceptOwnMediaRevision).toHaveBeenCalledWith("profile-v2"));
      expect(serviceMocks.deleteProfileAudio).toHaveBeenCalledWith("user-1", "profile-v1");
    }
  });

  it("finishes a successful save before slow cache refreshes settle", async () => {
    const updatedProfile = { user_id: "user-1" };
    serviceMocks.updateOwnProfile.mockResolvedValue({
      profile: updatedProfile,
      profileRevisionToken: "profile-v2",
    });

    let finishRefresh!: () => void;
    const slowRefresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(slowRefresh);
    const acceptServerProfile = vi.fn();
    const form = {
      displayName: "Saved Member",
      bio: "Saved bio",
      titleHtml: "",
      power: 100,
      classList: [],
      videoList: [],
      imageList: [],
      availabilityData: {
        timezone: "UTC",
        days: {
          sunday: [],
          monday: [{ start_utc: "20:00", end_utc: "24:00" }],
          tuesday: [],
          wednesday: [],
          thursday: [],
          friday: [],
          saturday: [],
        },
      },
      profileRevisionToken: "profile-v1",
      acceptServerProfile,
    } as unknown as MutationParams["form"];
    const imageUploader = { upload: vi.fn() } as unknown as MutationParams["imageUploader"];
    const audioUploader = { upload: vi.fn() } as unknown as MutationParams["audioUploader"];
    const { result } = renderHook(() => useProfileMutations({
      form,
      imageUploader,
      audioUploader,
    }), { wrapper: createWrapper(queryClient) });

    try {
      act(() => result.current.saveProfile());

      await waitFor(() => expect(acceptServerProfile).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.saveProfileMutation.isSuccess).toBe(true));

      expect(invalidateSpy).toHaveBeenNthCalledWith(1, {
        queryKey: queryKeys.myProfile.detail("user-1"),
      });
      expect(invalidateSpy).toHaveBeenNthCalledWith(2, {
        queryKey: queryKeys.users.all,
      });
      expect(notifySuccessMock).toHaveBeenCalledWith("message.profileSaved");
      expect(serviceMocks.updateOwnProfile).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ display_name: "Saved Member" }),
        "profile-v1",
      );
      expect(acceptServerProfile).toHaveBeenCalledWith(updatedProfile, "Saved Member", expect.any(Object), "profile-v2");
    } finally {
      finishRefresh();
    }
  });

  it("writes the returned profile revision into the local detail cache", async () => {
    const updatedProfile = { user_id: "user-1", bio: "Saved bio" };
    serviceMocks.updateOwnProfile.mockResolvedValue({
      profile: updatedProfile,
      profileRevisionToken: "profile-v2",
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(queryKeys.myProfile.detail("user-1"), {
      user: { id: "user-1", display_name: "Member" },
      profile: { user_id: "user-1", bio: "Old bio" },
      badges: [],
      edit_revisions: {
        user_revision_token: "user-v1",
        profile_revision_token: "profile-v1",
      },
    });
    const form = {
      displayName: "Member",
      bio: "Saved bio",
      titleHtml: "",
      power: 0,
      classList: [],
      videoList: [],
      imageList: [],
      availabilityData: null,
      profileRevisionToken: "profile-v1",
      acceptServerProfile: vi.fn(),
    } as unknown as MutationParams["form"];
    const imageUploader = { upload: vi.fn() } as unknown as MutationParams["imageUploader"];
    const audioUploader = { upload: vi.fn() } as unknown as MutationParams["audioUploader"];
    const { result } = renderHook(() => useProfileMutations({ form, imageUploader, audioUploader }), {
      wrapper: createWrapper(queryClient),
    });

    act(() => result.current.saveProfile());

    await waitFor(() => expect(form.acceptServerProfile).toHaveBeenCalled());
    expect(queryClient.getQueryData(queryKeys.myProfile.detail("user-1"))).toMatchObject({
      profile: updatedProfile,
      edit_revisions: {
        user_revision_token: "user-v1",
        profile_revision_token: "profile-v2",
      },
    });
  });
});
