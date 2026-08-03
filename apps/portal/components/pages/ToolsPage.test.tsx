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
});
