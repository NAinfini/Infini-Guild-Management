import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiceRollerModal } from "./DiceRollerModal";

const ROLL_DURATION_MS_FOR_TEST = 1200;

const mocks = vi.hoisted(() => ({
  reducedMotion: false,
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, values?: Record<string, string | number>) => {
        if (key !== "dice.resultAnnouncement" || !values) return key;
        return `${key} ${values.notation} ${values.results} ${values.total}`;
      },
    }),
  };
});

vi.mock("@portal/hooks/useMediaQuery", () => ({
  useMediaQuery: () => mocks.reducedMotion,
}));

function renderDiceRoller() {
  return render(<DiceRollerModal opened onClose={vi.fn()} />);
}

describe("DiceRollerModal", () => {
  beforeEach(() => {
    mocks.reducedMotion = false;
    window.localStorage.clear();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the final result immediately when reduced motion is requested", () => {
    mocks.reducedMotion = true;
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    renderDiceRoller();
    intervalSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "dice.roll" }));

    expect(intervalSpy).not.toHaveBeenCalled();
    expect(document.querySelector(".dice__stage--rolling")).toBeNull();
    expect(document.querySelector(".dice__history-item")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "dice.resultAnnouncement 1d6 1 1",
    );
  });

  it("hides intermediate values and announces the final result only once", () => {
    vi.useFakeTimers();
    renderDiceRoller();

    fireEvent.click(screen.getByRole("button", { name: "dice.roll" }));

    const results = document.querySelector(".dice__results-dice");
    expect(results).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector(".dice__stage")).not.toHaveAttribute("aria-live");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    act(() => vi.advanceTimersByTime(60));

    expect(results).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    act(() => vi.advanceTimersByTime(ROLL_DURATION_MS_FOR_TEST - 60));

    expect(results).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("status")).toHaveTextContent(
      "dice.resultAnnouncement 1d6 1 1",
    );
    expect(screen.getByRole("status").children).toHaveLength(1);
  });
});
