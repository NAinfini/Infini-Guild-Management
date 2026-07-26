// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminGameDataSection } from "./AdminGameDataSection";
import { fetchGameDataFull, fetchGameDataVersions, uploadGameData } from "@portal/services/GameDataService";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { message?: string }) => {
      if (key === "gameData.invalidJson") return `Invalid JSON: ${options?.message ?? ""}`;
      return key;
    },
  }),
}));

vi.mock("@portal/services/GameDataService", () => ({
  fetchGameDataFull: vi.fn(),
  fetchGameDataVersions: vi.fn(),
  uploadGameData: vi.fn(),
  rollbackGameData: vi.fn(),
}));

vi.mock("@portal/utils/notifications", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

const latestGameData = {
  data: {
    classes: ["warrior"],
    maxValues: {
      Power: 100,
    },
  },
  version: "2026-05-22T01:00:00.000Z",
  schemaVersion: 1,
};

function renderGameDataSection() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <AdminGameDataSection />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

async function openJsonEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "gameData.showJsonEditor" }));
  return screen.getByLabelText("gameData.editorLabel");
}

describe("AdminGameDataSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchGameDataFull).mockResolvedValue(latestGameData);
    vi.mocked(fetchGameDataVersions).mockResolvedValue([]);
    vi.mocked(uploadGameData).mockResolvedValue({ version: "2026-05-22T02:00:00.000Z" });
  });

  it("keeps the raw JSON editor collapsed until admins open it", async () => {
    const user = userEvent.setup();
    renderGameDataSection();

    await screen.findByText("gameData.editorTitle");
    expect(screen.queryByLabelText("gameData.editorLabel")).not.toBeInTheDocument();

    const editor = await openJsonEditor(user);

    expect(editor).toHaveValue(JSON.stringify(latestGameData.data, null, 2));
  });

  it("saves valid in-place JSON edits through the upload mutation", async () => {
    const user = userEvent.setup();
    renderGameDataSection();
    const editor = await openJsonEditor(user);

    fireEvent.change(editor, { target: { value: '{"classes":["mage"],"maxValues":{"Power":120}}' } });
    await user.click(screen.getByRole("button", { name: "gameData.saveJson" }));

    await waitFor(() => {
      expect(uploadGameData).toHaveBeenCalled();
      expect(vi.mocked(uploadGameData).mock.calls[0]?.[0]).toBe(JSON.stringify({
        classes: ["mage"],
        maxValues: { Power: 120 },
      }, null, 2));
    });
  });

  it("shows a validation error and does not upload invalid JSON", async () => {
    const user = userEvent.setup();
    renderGameDataSection();
    const editor = await openJsonEditor(user);

    fireEvent.change(editor, { target: { value: '{"classes":' } });
    await user.click(screen.getByRole("button", { name: "gameData.saveJson" }));

    expect(await screen.findByText(/Invalid JSON:/)).toBeInTheDocument();
    expect(uploadGameData).not.toHaveBeenCalled();
  });
});
