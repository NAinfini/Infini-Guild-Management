// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("opens the title sandbox in a workspace editor layout", async () => {
    renderToolsPage();

    fireEvent.click(screen.getByRole("button", { name: /sandbox\.title/i }));

    await waitFor(() => expect(document.querySelector(".sandbox__topbar")).not.toBeNull());
    expect(document.querySelector(".sandbox__workspace")).not.toBeNull();
    expect(document.querySelector(".sandbox__panel--controls")).not.toBeNull();
    expect(document.querySelector(".sandbox__panel--output")).not.toBeNull();
  });
});
