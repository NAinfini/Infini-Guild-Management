// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MantineProvider } from "@mantine/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolsPage } from "./ToolsPage";

const mocks = vi.hoisted(() => ({
  isExternalView: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../hooks/useExternalView", () => ({
  useExternalView: () => mocks.isExternalView,
}));

vi.mock("../../utils/notifications", () => ({
  notifySuccess: vi.fn(),
}));

function renderToolsPage() {
  render(
    <MantineProvider>
      <ToolsPage />
    </MantineProvider>,
  );
}

describe("ToolsPage", () => {
  beforeEach(() => {
    mocks.isExternalView = false;
  });

  it("presents the dice roller as a focused, width-limited launch panel", () => {
    renderToolsPage();

    expect(screen.getByText("page.description")).toBeInTheDocument();

    const launchButton = screen.getByRole("button", { name: /dice\.title/i });
    expect(launchButton.closest(".tools-page__utility")).not.toBeNull();
    expect(within(launchButton).getByText("dice.open")).toBeInTheDocument();

    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/ToolsPage.css"),
      "utf8",
    );
    expect(styles).toMatch(
      /\.tools-page__utility\s*\{[^}]*width:\s*100%[^}]*max-width:\s*46rem[^}]*margin-inline:\s*auto/s,
    );
  });

  it("disables transform-based dice animations when reduced motion is requested", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/ToolsPage.css"),
      "utf8",
    );
    const reducedMotionCss =
      styles.match(
        /@media[^{]*prefers-reduced-motion[^{]*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/,
      )?.[1] ?? "";
    const selectorsWithAnimationDisabled = [
      ...reducedMotionCss.matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ]
      .filter(([, , declarations]) => /\banimation:\s*none\b/.test(declarations ?? ""))
      .flatMap(([, selectors]) =>
        (selectors ?? "").split(",").map((selector) => selector.trim()),
      );

    expect(selectorsWithAnimationDisabled).toEqual(
      expect.arrayContaining([
        ".dice__icon-spin",
        ".dice__stage--rolling",
        ".dice__die--spinning",
        ".dice__history-item",
      ]),
    );
    expect(selectorsWithAnimationDisabled).not.toContain(".dice__roll-btn--rolling");
  });

  it("opens the existing dice roller modal from the launch panel", async () => {
    const user = userEvent.setup();
    renderToolsPage();

    await user.click(screen.getByRole("button", { name: /dice\.title/i }));

    expect(await screen.findByRole("dialog", { name: "dice.title" })).toBeInTheDocument();
  });

  it("uses a genuinely disabled launch control in external view", async () => {
    const user = userEvent.setup();
    mocks.isExternalView = true;
    renderToolsPage();

    expect(screen.getByText("page.readOnlyHint")).toBeInTheDocument();
    const launchButton = screen.getByRole("button", { name: /dice\.title/i });
    expect(launchButton).toBeDisabled();
    expect(launchButton).toHaveAttribute("aria-disabled", "true");

    await user.click(launchButton);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
