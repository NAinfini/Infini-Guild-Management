import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminDataIntegrityTool } from "./AdminDataIntegrityTool";

const fetchPage = vi.hoisted(() => vi.fn());

vi.mock("../../../services/AdminService", () => ({
  fetchBlobReconciliationPage: fetchPage,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider>{children}</MantineProvider>
    </QueryClientProvider>
  );
}

describe("AdminDataIntegrityTool", () => {
  beforeEach(() => fetchPage.mockReset());

  it("advances an explicitly paged read-only scan and aggregates findings", async () => {
    const user = userEvent.setup();
    fetchPage
      .mockResolvedValueOnce({
        status: "incomplete",
        scanned: 50,
        findings: [{
          kind: "missing_blob",
          expected: {
            source: "media",
            source_id: "asset-1",
            object_key: "media/asset-1/full.webp",
            byte_size: 10,
            content_type: "image/webp",
            sha256: "a".repeat(64),
          },
        }],
        next_checkpoint: { phase: "inventory", prefix: "media/", checkpoint: "next" },
      })
      .mockResolvedValueOnce({
        status: "clean",
        scanned: 12,
        findings: [],
        next_checkpoint: null,
      });

    render(<AdminDataIntegrityTool />, { wrapper: Wrapper });
    await user.click(screen.getByRole("button", { name: "diagnostics.integrity.start" }));

    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith({ phase: "manifest" }));
    expect(await screen.findByText("media/asset-1/full.webp")).toBeInTheDocument();
    expect(screen.getByText("diagnostics.integrity.incomplete")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "diagnostics.integrity.continue" }));
    await waitFor(() => expect(fetchPage).toHaveBeenLastCalledWith({
      phase: "inventory",
      prefix: "media/",
      checkpoint: "next",
    }));
    expect(await screen.findByText("diagnostics.integrity.drift")).toBeInTheDocument();
    expect(screen.getByText("62")).toBeInTheDocument();
  });
});
