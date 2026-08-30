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

  it("presents a single semantic dice launch control", () => {
    renderToolsPage();

    const launchButton = screen.getByRole("button", { name: /dice\.title/i });
    expect(screen.getAllByRole("button", { name: /dice\.title/i })).toHaveLength(1);
    expect(within(launchButton).getByText("dice.open")).toBeInTheDocument();
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
