import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolsPage } from "./ToolsPage";

const mocks = vi.hoisted(() => ({
  isExternalView: false,
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("../../hooks/useExternalView", () => ({
  useExternalView: () => mocks.isExternalView,
}));

vi.mock("../../utils/notifications", () => ({
  notifySuccess: vi.fn(),
}));

function renderToolsPage() {
  return render(<ToolsPage />);
}

describe("ToolsPage", () => {
  beforeEach(() => {
    mocks.isExternalView = false;
  });

  it("presents one compact semantic dice launch panel without decorative artwork", () => {
    const { container } = renderToolsPage();

    const launchButton = screen.getByRole("button", { name: /dice\.title/i });
    expect(screen.getAllByRole("button", { name: /dice\.title/i })).toHaveLength(1);
    expect(launchButton.closest(".tools-page__utility")).not.toBeNull();
    expect(launchButton.querySelector(".tool-launch-panel__artwork")).toBeNull();
    expect(launchButton.querySelector(".visual-theme-object")).toBeNull();
    expect(launchButton.querySelector(".tool-launch-panel__semantic-icon")).not.toBeNull();
    expect(within(launchButton).getByText("dice.open")).toBeInTheDocument();

    expect(container.querySelector(".page-spotlight")).toBeNull();

    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/ToolsPage.css"),
      "utf8",
    );
    expect(styles).toMatch(
      /\.tools-page__utility\s*\{[^}]*width:\s*100%[^}]*align-content:\s*start/s,
    );
    expect(styles).toMatch(
      /\.tool-launch-panel\s*\{[^}]*max-width:\s*42rem/s,
    );
    expect(styles).toMatch(
      /\.tool-launch-panel__button\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/s,
    );

    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/ToolsPage.tsx"),
      "utf8",
    );
    expect(source).not.toContain("VisualThemeObject");
    expect(source).not.toContain("variant=\"toolkit\"");
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
