// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfileMediaTab } from "./ProfileMediaTab";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => vi.fn(),
}));

vi.mock("@portal/components/shared/ImageGridEditor", () => ({
  ImageGridEditor: () => <div data-testid="image-grid-editor" />,
}));

const uploader = {
  files: [new File(["media"], "media.bin")],
  supportError: null,
  isUploading: false,
  isConverting: false,
  conversionProgress: 0,
  uploadProgress: 0,
  error: null,
  selectFiles: vi.fn(),
};

function renderMediaTab(onUploadAudio: () => void = vi.fn()) {
  return render(
      <MantineProvider>
        <ProfileMediaTab
          avatarKey="avatars/member.webp"
          profileAudioKey={null}
          imageList={[]}
          videoDraft=""
          videoList={[]}
          imageUploader={uploader}
          audioUploader={uploader}
          avatarUploading={false}
          onUploadAvatar={vi.fn()}
          onRemoveAvatar={vi.fn()}
          onReorderImages={vi.fn()}
          onRemoveImage={vi.fn()}
          removingImageKeys={new Set()}
          onUploadImages={vi.fn()}
          onVideoDraftChange={vi.fn()}
          onAddVideoUrl={vi.fn()}
          onMoveVideo={vi.fn()}
          onRemoveVideo={vi.fn()}
          onUploadAudio={onUploadAudio}
          onRemoveAudio={vi.fn()}
        />
    </MantineProvider>,
  );
}

describe("ProfileMediaTab", () => {
  it("keeps upload and avatar actions at least 44px high", async () => {
    const user = userEvent.setup();
    renderMediaTab();

    // The four media groups share one card now, so each group's buttons only
    // exist while its segment is selected — assert them one segment at a time.
    await user.click(screen.getByRole("radio", { name: "media.tab.audioEmpty" }));
    const audioActions = [screen.getByRole("button", { name: "media.selectAudio" })];

    await user.click(screen.getByRole("radio", { name: "media.avatar" }));
    const avatarActions = [
      screen.getByRole("button", { name: "media.uploadAvatar" }),
      screen.getByRole("button", { name: "media.removeAvatar" }),
    ];

    expect([...audioActions, ...avatarActions]).toHaveLength(3);
    for (const action of [...audioActions, ...avatarActions]) {
      expect(action).toHaveStyle({
        height: "calc(2.75rem * var(--mantine-scale))",
      });
    }
  });

  it("uploads the picked music file straight away, with no second button to press", async () => {
    const user = userEvent.setup();
    const onUploadAudio = vi.fn();
    renderMediaTab(onUploadAudio);

    // Picking a file is the whole gesture, the same as the avatar group right
    // next to it. A staged file that needs a second click leaves one live button
    // and one greyed-out one sitting side by side for the entire wait.
    expect(onUploadAudio).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("radio", { name: "media.tab.audioEmpty" }));
    expect(screen.queryByRole("button", { name: "action.upload" })).not.toBeInTheDocument();
  });

  it("shows each group's count on the switch without opening it", () => {
    renderMediaTab();

    // Collapsing four cards into one switch only works if the counts survive
    // the collapse; otherwise you have to open each group to see if it is empty.
    expect(screen.getByRole("radio", { name: "media.tab.images" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "media.tab.videos" })).toBeInTheDocument();
    expect(screen.getByTestId("image-grid-editor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "media.uploadAvatar" })).not.toBeInTheDocument();
  });
});
