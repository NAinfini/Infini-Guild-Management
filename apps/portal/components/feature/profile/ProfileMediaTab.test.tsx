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
          profileAudioKey={null}
          imageList={[]}
          videoDraft=""
          videoList={[]}
          imageUploader={uploader}
          audioUploader={uploader}
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
  it("keeps the music upload action at least 44px high", async () => {
    const user = userEvent.setup();
    renderMediaTab();

    // The media groups share one card, so each group's buttons only exist while
    // its segment is selected — reach the music one through its segment.
    await user.click(screen.getByRole("radio", { name: "media.tab.audioEmpty" }));

    expect(screen.getByRole("button", { name: "media.selectAudio" })).toHaveStyle({
      height: "calc(2.75rem * var(--mantine-scale))",
    });
  });

  it("uploads the picked music file straight away, with no second button to press", async () => {
    const user = userEvent.setup();
    const onUploadAudio = vi.fn();
    renderMediaTab(onUploadAudio);

    // Picking a file is the whole gesture. A staged file that needs a second
    // click leaves one live button and one greyed-out one sitting side by side
    // for the entire wait.
    expect(onUploadAudio).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("radio", { name: "media.tab.audioEmpty" }));
    expect(screen.queryByRole("button", { name: "action.upload" })).not.toBeInTheDocument();
  });

  it("shows each group's count on the switch without opening it", () => {
    renderMediaTab();

    // Collapsing three cards into one switch only works if the counts survive
    // the collapse; otherwise you have to open each group to see if it is empty.
    expect(screen.getByRole("radio", { name: "media.tab.images" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "media.tab.videos" })).toBeInTheDocument();
    expect(screen.getByTestId("image-grid-editor")).toBeInTheDocument();
  });

  it("leaves the avatar to the overview card instead of keeping a fourth group", () => {
    renderMediaTab();

    // 换头像的入口长在概览条的头像上（见 ProfileOverviewCard.test.tsx）。
    // 这张卡里再留一个「头像」分组，就是同一件事有两个入口。
    expect(screen.queryByRole("radio", { name: "media.avatar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "media.uploadAvatar" })).not.toBeInTheDocument();
  });
});
