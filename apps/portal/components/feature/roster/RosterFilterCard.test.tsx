import { MantineProvider } from "@mantine/core";
import { screen } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

class WideResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect() {}
  unobserve() {}
  observe() {
    this.callback(
      [{ contentRect: { width: 1200 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

describe("RosterFilterCard", () => {
  beforeEach(() => {
    window.ResizeObserver = WideResizeObserver as unknown as typeof ResizeObserver;
  });

  it("keeps BGM playback preferences available without dominating the filter row", async () => {
    render(
      <MantineProvider>
        <RosterFilterCard
          search=""
          onSearchChange={vi.fn()}
          classFilter={[]}
          onClassFilterChange={vi.fn()}
          sortMode="power"
          onSortModeChange={vi.fn()}
          audioMuted={false}
          onAudioMutedChange={vi.fn()}
          audioVolume={60}
          onAudioVolumeChange={vi.fn()}
          renderedCount={12}
          totalCount={12}
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

});
