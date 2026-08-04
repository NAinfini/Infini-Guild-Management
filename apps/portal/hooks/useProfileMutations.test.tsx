// @vitest-environment jsdom
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
  updateMyProfile: vi.fn(),
}));
const setProfileMock = vi.hoisted(() => vi.fn());
const notifySuccessMock = vi.hoisted(() => vi.fn());

vi.mock("../services/UserService", () => serviceMocks);
vi.mock("../services/AuthService", () => ({ logout: vi.fn() }));
vi.mock("../stores/auth", () => ({
  useAuthStore: (selector: (state: {
    user: { id: string };
    setProfile: typeof setProfileMock;
  }) => unknown) => selector({
    user: { id: "user-1" },
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
    notifySuccessMock.mockReset();
  });

  it("finishes a successful save before slow cache refreshes settle", async () => {
    const updatedProfile = { id: "profile-1", user_id: "user-1" };
    serviceMocks.updateMyProfile.mockResolvedValue(updatedProfile);

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
      bio: "Saved bio",
      titleHtml: "",
      power: 100,
      classList: [],
      videoList: [],
      imageList: [],
      availabilityData: {
        days: { monday: [{ start_utc: "20:00", end_utc: "00:00" }] },
      },
      acceptServerProfile,
    } as unknown as MutationParams["form"];
    const uploader = { upload: vi.fn() } as unknown as MutationParams["imageUploader"];
    const { result } = renderHook(() => useProfileMutations({
      form,
      imageUploader: uploader,
      audioUploader: uploader,
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
    } finally {
      finishRefresh();
    }
  });
});
