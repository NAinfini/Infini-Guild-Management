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

function renderMediaTab() {
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
          onUploadImages={vi.fn()}
          onVideoDraftChange={vi.fn()}
          onAddVideoUrl={vi.fn()}
          onMoveVideo={vi.fn()}
          onRemoveVideo={vi.fn()}
          onUploadAudio={vi.fn()}
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
    const audioActions = [
      screen.getByRole("button", { name: "media.selectAudio" }),
      ...screen.getAllByRole("button", { name: "action.upload" }),
    ];

    await user.click(screen.getByRole("radio", { name: "media.avatar" }));
    const avatarActions = [
      screen.getByRole("button", { name: "media.uploadAvatar" }),
      screen.getByRole("button", { name: "media.removeAvatar" }),
    ];

    expect([...audioActions, ...avatarActions]).toHaveLength(4);
    for (const action of [...audioActions, ...avatarActions]) {
      expect(action).toHaveStyle({
        height: "calc(2.75rem * var(--mantine-scale))",
      });
    }
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
