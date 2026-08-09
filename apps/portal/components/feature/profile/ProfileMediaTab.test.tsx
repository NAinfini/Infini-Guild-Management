// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen, within } from "@testing-library/react";
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

function renderMediaTab(
  onUploadAudio: () => void = vi.fn(),
  profileAudioMediaId: string | null = null,
  profileAudioName: string | null = null,
) {
  return render(
      <MantineProvider>
        <ProfileMediaTab
          profileAudioMediaId={profileAudioMediaId}
          profileAudioName={profileAudioName}
          maxImages={8}
          imageList={[]}
          videoDraft=""
          videoList={[]}
          imageUploader={uploader}
          audioUploader={uploader}
          onReorderImages={vi.fn()}
          onRemoveImage={vi.fn()}
          removingImageIds={new Set()}
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

/* 三组同屏之后「上传」「删除」这类通用文案不再唯一，按组取才问得到正确的那个。 */
const audioGroup = () => within(screen.getByRole("group", { name: "media.group.audio" }));

describe("ProfileMediaTab", () => {
  it("keeps the music upload action on the 44px touch target", () => {
    renderMediaTab();

    expect(
      audioGroup().getByRole("button", { name: "media.selectAudio" }).getAttribute("style"),
    ).toContain("--ai-size: calc(2.75rem * var(--mantine-scale))");
  });

  it("uploads the picked music file straight away, with no second button to press", () => {
    const onUploadAudio = vi.fn();
    renderMediaTab(onUploadAudio);

    // Picking a file is the whole gesture. A staged file that needs a second
    // click leaves one live button and one greyed-out one sitting side by side
    // for the entire wait.
    expect(onUploadAudio).toHaveBeenCalledTimes(1);
    expect(audioGroup().queryByRole("button", { name: "action.upload" })).not.toBeInTheDocument();
  });

  it("opens all three groups at once, each carrying its own count", () => {
    renderMediaTab();

    // 三组各占一个分组框，不再靠切换互相遮挡：一眼就能看出哪一组是空的。
    expect(screen.getByText("media.group.images")).toBeInTheDocument();
    expect(screen.getByText("media.group.videos")).toBeInTheDocument();
    expect(screen.getByText("media.group.audio")).toBeInTheDocument();
    expect(screen.getByTestId("image-grid-editor")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "media.videos" })).toBeInTheDocument();
  });

  it("names the chosen song, and says so plainly when there is none", () => {
    const withoutAudio = renderMediaTab();

    // 空态也要占住这一行：整行消失的话，用户看到的是「这里什么都没有」，
    // 分不清是没选还是没加载出来。删除键此时无事可删，置灰而不是撤掉。
    expect(audioGroup().getByText("media.noAudioSelected")).toBeInTheDocument();
    expect(audioGroup().getByRole("button", { name: "action.delete" })).toBeDisabled();
    withoutAudio.unmount();

    renderMediaTab(vi.fn(), "audio1234567890abcdef", "夜曲.ogg");

    // 用户看到独立保存的上传文件名，媒体 ID 不承担展示职责。
    expect(audioGroup().getByText("夜曲.ogg")).toBeInTheDocument();
    expect(audioGroup().getByRole("button", { name: "action.delete" })).toBeEnabled();
  });

  it("leaves the avatar to the overview card instead of keeping a fourth group", () => {
    renderMediaTab();

    // 换头像的入口长在概览条的头像上（见 ProfileOverviewCard.test.tsx）。
    // 这张卡里再留一个「头像」分组，就是同一件事有两个入口。
    expect(screen.queryByText("media.avatar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "media.uploadAvatar" })).not.toBeInTheDocument();
  });
});
