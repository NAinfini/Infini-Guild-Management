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

vi.mock("../../../hooks/data/useClassData", () => ({
  useClassCatalog: () => [
    { id: "vanguard", label: "Vanguard" },
    { id: "healer", label: "Healer" },
  ],
}));

Object.defineProperty(HTMLElement.prototype, "getAnimations", {
  configurable: true,
  value: () => [],
});

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
      />,
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

  it("keeps class and sort controls in the shared filter surface", async () => {
    const onClassFilterChange = vi.fn();
    const onSortModeChange = vi.fn();

    render(
      <RosterFilterCard
        search=""
        onSearchChange={vi.fn()}
        classFilter={[]}
        onClassFilterChange={onClassFilterChange}
        sortMode="power"
        onSortModeChange={onSortModeChange}
        audioMuted={false}
        onAudioMutedChange={vi.fn()}
        audioVolume={60}
        onAudioVolumeChange={vi.fn()}
        renderedCount={12}
        totalCount={12}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "common:filter.toggle" }));
    await userEvent.click(await screen.findByText("Vanguard"));
    await userEvent.click(screen.getByText("sort.displayNameAsc"));

    expect(onClassFilterChange).toHaveBeenCalledWith(["vanguard"]);
    expect(onSortModeChange).toHaveBeenCalledWith("display_name");
  });

});
