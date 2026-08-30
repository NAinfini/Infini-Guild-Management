import type { ImportantNoticeActive } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../../stores/auth";
import { ImportantNoticeGate } from "./ImportantNoticeGate";

const mocks = vi.hoisted(() => ({
  fetchActiveImportantNotices: vi.fn(),
  acknowledgeImportantNotice: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../api/queries/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/queries/notifications")>()),
  fetchActiveImportantNotices: mocks.fetchActiveImportantNotices,
}));

vi.mock("../../api/mutations/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/mutations/notifications")>()),
  acknowledgeImportantNotice: mocks.acknowledgeImportantNotice,
}));

vi.mock("@portal/components/shared/TipTapEditor", () => ({
  TipTapEditor: ({ value }: { value: string }) => <div data-testid="notice-body">{value}</div>,
}));

const notice: ImportantNoticeActive = {
  id: "notice-1",
  title: "Read this first",
  body_json: JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Required message" }] }],
  }),
  published_at: "2026-08-01T00:00:00.000Z",
  expires_at: null,
  requires_acknowledgement: true,
  read_at: null,
  acknowledged_at: null,
};

function signIn() {
  useAuthStore.setState({ user: { id: "member-a" } as never, profile: {} as never });
}

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ImportantNoticeGate />
    </QueryClientProvider>,
  );
}

describe("ImportantNoticeGate", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    useAuthStore.getState().clearSession();
    mocks.fetchActiveImportantNotices.mockReset().mockResolvedValue([notice]);
    mocks.acknowledgeImportantNotice.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.getElementById("root")?.removeAttribute("inert");
  });

  it("does not request signed-in notices for a guest", async () => {
    renderGate();

    await Promise.resolve();
    expect(mocks.fetchActiveImportantNotices).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the app blocked when required notices cannot be checked", async () => {
    signIn();
    mocks.fetchActiveImportantNotices.mockRejectedValue(new Error("network unavailable"));
    renderGate();

    expect(await screen.findByRole("dialog", { name: "importantNotice.loadErrorTitle" })).toBeInTheDocument();
    expect(document.getElementById("root")).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "action.retry" })).toBeInTheDocument();
  });

  it("blocks a signed-in member until the required notice is acknowledged", async () => {
    signIn();
    const user = userEvent.setup();
    mocks.fetchActiveImportantNotices
      .mockResolvedValueOnce([notice])
      .mockResolvedValue([{ ...notice, read_at: "2026-08-02T00:00:00.000Z", acknowledged_at: "2026-08-02T00:00:00.000Z" }]);
    renderGate();

    await screen.findByRole("dialog", { name: "Read this first" });
    expect(document.getElementById("root")).toHaveAttribute("inert");
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(document.querySelector('[data-slot="dialog-overlay"]') as Element);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "importantNotice.confirm" }));

    expect(mocks.acknowledgeImportantNotice).toHaveBeenCalledWith("notice-1");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the notice content without repeating a generic notice label", async () => {
    signIn();
    renderGate();

    await screen.findByRole("dialog", { name: "Read this first" });
    expect(screen.getByText("importantNotice.published")).toBeInTheDocument();
    expect(screen.getByTestId("notice-body")).toBeInTheDocument();
    expect(screen.queryByText("importantNotice.label")).not.toBeInTheDocument();
  });

  it("never blocks for an inbox-only notice", async () => {
    signIn();
    mocks.fetchActiveImportantNotices.mockResolvedValue([{ ...notice, requires_acknowledgement: false }]);
    renderGate();

    await waitFor(() => expect(mocks.fetchActiveImportantNotices).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not request another acknowledgement after the same notice is edited or republished", async () => {
    signIn();
    mocks.fetchActiveImportantNotices.mockResolvedValue([{
      ...notice,
      title: "Edited after acknowledgement",
      body_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
      published_at: "2026-08-20T00:00:00.000Z",
      acknowledged_at: "2026-08-02T00:00:00.000Z",
    }]);
    renderGate();

    await waitFor(() => expect(mocks.fetchActiveImportantNotices).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.acknowledgeImportantNotice).not.toHaveBeenCalled();
  });

  it("advances required notices from oldest publication to newest", async () => {
    signIn();
    const olderNotice = {
      ...notice,
      id: "notice-older",
      title: "Older first",
      published_at: "2026-07-01T00:00:00.000Z",
    };
    mocks.fetchActiveImportantNotices
      .mockResolvedValueOnce([notice, olderNotice])
      .mockResolvedValue([
        notice,
        { ...olderNotice, read_at: "2026-08-02T00:00:00.000Z", acknowledged_at: "2026-08-02T00:00:00.000Z" },
      ]);
    const user = userEvent.setup();
    renderGate();

    await screen.findByRole("dialog", { name: "Older first" });
    await user.click(screen.getByRole("button", { name: "importantNotice.confirm" }));
    expect(await screen.findByRole("dialog", { name: "Read this first" })).toBeInTheDocument();
  });
});
