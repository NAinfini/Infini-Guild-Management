// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyProfilePage } from "./MyProfilePage";

const routeMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: { tab: "availability" as string | undefined },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => routeMocks.navigate,
  useSearch: () => routeMocks.search,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: { id: string; username: string } }) => unknown) =>
    selector({ user: { id: "user-1", username: "Member" } }),
}));

vi.mock("../../hooks/data/useProfileData", () => ({
  useProfileData: () => ({
    profileQuery: {
      data: { profile: { avatar_key: null, audio_key: null } },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    },
  }),
}));

vi.mock("../../hooks/useProfileFormState", () => ({
  useProfileFormState: () => ({
    power: 0,
    setPower: vi.fn(),
    classDraft: "",
    setClassDraft: vi.fn(),
    classOptions: [],
    classList: [],
    addClass: vi.fn(),
    handleClassDragEnd: vi.fn(),
    removeClass: vi.fn(),
    titleHtml: "",
    setTitleHtml: vi.fn(),
    bio: "",
    setBio: vi.fn(),
    imageList: [],
    setImageList: vi.fn(),
    videoDraft: "",
    setVideoDraft: vi.fn(),
    videoList: [],
    setVideoList: vi.fn(),
    activeNowEstimate: 0,
    availabilityData: null,
    setAvailabilityData: vi.fn(),
    dirtySections: { home: true, availability: false },
    currentPassword: "",
    setCurrentPassword: vi.fn(),
    newPassword: "",
    setNewPassword: vi.fn(),
    confirmNewPassword: "",
    setConfirmNewPassword: vi.fn(),
    currentPasswordForUsername: "",
    setCurrentPasswordForUsername: vi.fn(),
    newUsername: "",
    setNewUsername: vi.fn(),
    isDirty: false,
  }),
}));

vi.mock("../../hooks/useProfileMutations", () => ({
  useProfileMutations: () => ({
    saveProfile: vi.fn(),
    saveProfileMutation: { isPending: false },
    removeImage: vi.fn(),
    uploadImages: vi.fn(),
    uploadAudio: vi.fn(),
    removeAudio: vi.fn(),
    changePassword: vi.fn(),
    changeUsername: vi.fn(),
    logout: vi.fn(),
    changePasswordMutation: { isPending: false },
    changeUsernameMutation: { isPending: false },
  }),
}));

vi.mock("../../hooks/useMediaUpload", () => ({
  useMediaUpload: () => ({}),
}));

vi.mock("../../hooks/useProfileAvatarMutations", () => ({
  useProfileAvatarMutations: () => ({
    avatarUploadMutation: { isPending: false, mutate: vi.fn() },
    avatarDeleteMutation: { mutate: vi.fn() },
  }),
}));

vi.mock("../../hooks/useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: vi.fn(),
}));

vi.mock("../../hooks/useLoadWarningToast", () => ({
  useLoadWarningToast: vi.fn(),
}));

vi.mock("../../hooks/useAppError", () => ({
  useAppError: () => ({ showError: vi.fn() }),
}));

vi.mock("../layout/PageLayout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../shared/UnsavedChangesAffix", () => ({
  UnsavedChangesAffix: () => null,
}));

vi.mock("../feature/profile/ProfileOverviewCard", () => ({
  ProfileOverviewCard: () => null,
}));

vi.mock("../feature/profile/ProfileWeekSummary", () => ({
  ProfileWeekSummary: () => null,
}));

vi.mock("../feature/profile/ProfileGapsCallout", () => ({
  ProfileGapsCallout: () => null,
}));

vi.mock("../feature/profile/ProfileProfileTab", () => ({
  ProfileProfileTab: () => <div>profile-panel</div>,
}));

vi.mock("../feature/profile/ProfileMediaTab", () => ({
  ProfileMediaTab: () => <div>media-panel</div>,
}));

vi.mock("../feature/profile/ProfileAvailabilityTab", () => ({
  ProfileAvailabilityTab: () => <div>availability-panel</div>,
}));

vi.mock("../feature/profile/ProfileAccountTab", () => ({
  ProfileAccountTab: () => <div>account-panel</div>,
}));

describe("MyProfilePage tab routing", () => {
  beforeEach(() => {
    routeMocks.search.tab = "availability";
    routeMocks.navigate.mockReset();
  });

  it("restores the deep link and keeps tab content aligned with the URL", async () => {
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <MyProfilePage />
      </MantineProvider>,
    );

    expect(screen.getByText("availability-panel")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: /tab\.account/ }));
    expect(screen.getByText("account-panel")).toBeVisible();
    expect(routeMocks.navigate).toHaveBeenLastCalledWith({
      to: "/profile",
      search: { tab: "account" },
      replace: true,
      viewTransition: false,
    });

    await user.click(screen.getByRole("tab", { name: /tab\.home/ }));
    expect(screen.getByText("profile-panel")).toBeVisible();
    expect(screen.getByText("media-panel")).toBeVisible();
    expect(routeMocks.navigate).toHaveBeenLastCalledWith({
      to: "/profile",
      search: { tab: undefined },
      replace: true,
      viewTransition: false,
    });
  });

  it("marks the tab that owns unsaved changes", () => {
    render(
      <MantineProvider>
        <MyProfilePage />
      </MantineProvider>,
    );

    // dirtySections says home, not availability: the dot has to follow the
    // fields, otherwise switching tabs hides where the unsaved work is.
    const homeTab = screen.getByRole("tab", { name: /tab\.home/ });
    expect(homeTab.querySelector(".my-profile-tab-label__dot")).not.toBeNull();
    expect(
      screen.getByRole("tab", { name: /tab\.availability/ })
        .querySelector(".my-profile-tab-label__dot"),
    ).toBeNull();
  });
});
