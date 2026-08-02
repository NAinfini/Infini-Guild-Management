// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolsPage } from "./ToolsPage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../hooks/useExternalView", () => ({
  useExternalView: () => false,
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
  it("lists the dice roller", () => {
    renderToolsPage();

    expect(screen.getByRole("button", { name: /dice\.title/i })).toBeInTheDocument();
  });

  it("does not render the removed equipment calculator", () => {
    renderToolsPage();

    expect(screen.queryByRole("button", { name: /equipCalc\.title/i })).not.toBeInTheDocument();
  });

  // 称号沙盒搬到了资料页（在那里编辑称号才是它真正的用途），工具页不该再有入口。
  // 弹窗自身的布局断言见 feature/profile/TitleSandboxModal.test.tsx。
  it("does not render the title sandbox that moved to the profile page", () => {
    renderToolsPage();

    expect(screen.queryByRole("button", { name: /sandbox\.title/i })).not.toBeInTheDocument();
  });
});
