// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolsPage } from "./ToolsPage";
import { fetchGameData } from "@portal/services/GameDataService";
import type { GameDataBaseInput } from "@guild/shared/schemas/equipment-calc";

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

vi.mock("@portal/services/GameDataService", () => ({
  fetchGameData: vi.fn(),
}));

function renderToolsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <ToolsPage />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe("ToolsPage", () => {
  beforeEach(() => {
    // ToolsPage only reads `version`; the rest of the payload is irrelevant here.
    vi.mocked(fetchGameData).mockResolvedValue({
      data: {} as GameDataBaseInput,
      version: "workbook-2026-06-27-7d9f97f8",
      schemaVersion: 1,
    });
  });

  it("opens the title sandbox in a workspace editor layout", async () => {
    renderToolsPage();

    fireEvent.click(screen.getByRole("button", { name: /sandbox\.title/i }));

    await waitFor(() => expect(document.querySelector(".sandbox__topbar")).not.toBeNull());
    expect(document.querySelector(".sandbox__workspace")).not.toBeNull();
    expect(document.querySelector(".sandbox__panel--controls")).not.toBeNull();
    expect(document.querySelector(".sandbox__panel--output")).not.toBeNull();
  });

  it("shows the equipment calculator data version on the tool card", async () => {
    renderToolsPage();

    expect(await screen.findByText("equipCalc.versionLabel")).toBeInTheDocument();
    expect(screen.getByText("workbook-2026-06-27-7d9f97f8")).toBeInTheDocument();
  });
});
