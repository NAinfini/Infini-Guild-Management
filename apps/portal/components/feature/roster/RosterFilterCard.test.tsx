// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RosterFilterCard } from "./RosterFilterCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../utils/audio-player", () => ({
  isAudioPlaying: () => false,
  stopAudio: vi.fn(),
}));

describe("RosterFilterCard", () => {
  it("keeps BGM playback preferences available without dominating the filter row", async () => {
    render(
      <MantineProvider>
        <RosterFilterCard
          search=""
          onSearchChange={vi.fn()}
          classFilter={[]}
          loadedClassIds={[]}
          onClassFilterChange={vi.fn()}
          sortMode="power"
          onSortModeChange={vi.fn()}
          audioMuted={false}
          onAudioMutedChange={vi.fn()}
          audioVolume={60}
          onAudioVolumeChange={vi.fn()}
          renderedCount={12}
          totalCount={12}
          isMobile={false}
        />
      </MantineProvider>,
    );

    expect(screen.queryByRole("slider", { name: "audio.aria.volumeSlider" })).not.toBeInTheDocument();
    const audioPreferencesButton = screen.getByRole("button", { name: "audio.hint" });
    await userEvent.click(audioPreferencesButton);
    expect(audioPreferencesButton).toHaveAttribute("aria-expanded", "true");
    expect(
      await screen.findByRole("slider", { name: "audio.aria.volumeSlider" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "audio.aria.mute" }),
    ).toBeInTheDocument();
  });

  it("keeps a loaded legacy class selectable after it leaves the catalog", async () => {
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <RosterFilterCard
          search=""
          onSearchChange={vi.fn()}
          classFilter={[]}
          loadedClassIds={["retired-class"]}
          onClassFilterChange={vi.fn()}
          sortMode="power"
          onSortModeChange={vi.fn()}
          audioMuted={false}
          onAudioMutedChange={vi.fn()}
          audioVolume={60}
          onAudioVolumeChange={vi.fn()}
          renderedCount={1}
          totalCount={1}
          isMobile={false}
        />
      </MantineProvider>,
    );

    await user.click(screen.getByRole("textbox", { name: "filter.class.aria" }));

    expect(await screen.findByText("retired-class")).toBeInTheDocument();
  });
});
