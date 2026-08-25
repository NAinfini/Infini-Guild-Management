import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImportantNoticeGate,
  importantNoticeAcknowledgementStorageKey,
} from "./ImportantNoticeGate";
import { useAuthStore } from "../../stores/auth";

const mocks = vi.hoisted(() => ({
  fetchActiveImportantNotices: vi.fn(),
  fetchImportantNoticeAcknowledgements: vi.fn(),
  acknowledgeImportantNotice: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../api/queries/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/queries/notifications")>()),
  fetchActiveImportantNotices: mocks.fetchActiveImportantNotices,
  fetchImportantNoticeAcknowledgements: mocks.fetchImportantNoticeAcknowledgements,
}));

vi.mock("../../api/mutations/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/mutations/notifications")>()),
  acknowledgeImportantNotice: mocks.acknowledgeImportantNotice,
}));

vi.mock("@portal/components/shared/TipTapEditor", () => ({
  TipTapEditor: ({ value }: { value: string }) => <div data-testid="notice-body">{value}</div>,
}));

const notice = {
  id: "notice-1",
  title: "Read this first",
  body_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Required message" }] }] }),
  published_at: "2026-08-01T00:00:00.000Z",
  expires_at: null,
  publication_revision: 2,
};

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
    localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    useAuthStore.getState().clearSession();
    mocks.fetchActiveImportantNotices.mockReset().mockResolvedValue([notice]);
    mocks.fetchImportantNoticeAcknowledgements.mockReset().mockResolvedValue([]);
    mocks.acknowledgeImportantNotice.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.getElementById("root")?.removeAttribute("inert");
  });

  it("blocks an anonymous visitor until acknowledgement is saved locally", async () => {
    const user = userEvent.setup();
    renderGate();

    await screen.findByRole("dialog", { name: "Read this first" });
    expect(document.getElementById("root")).toHaveAttribute("inert");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    fireEvent.mouseDown(overlay as Element);
    fireEvent.click(overlay as Element);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(localStorage.getItem(importantNoticeAcknowledgementStorageKey(notice))).toBeNull();
    await user.click(screen.getByRole("button", { name: "importantNotice.confirm" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.acknowledgeImportantNotice).not.toHaveBeenCalled();
    expect(localStorage.getItem(importantNoticeAcknowledgementStorageKey(notice))).toBe("1");
  });

  it("shows the notice content without repeating the generic notice label", async () => {
    renderGate();

    await screen.findByRole("dialog", { name: "Read this first" });

    expect(screen.getByText("importantNotice.published")).toBeInTheDocument();
    expect(screen.getByTestId("notice-body")).toBeInTheDocument();
    expect(screen.queryByText("importantNotice.label")).not.toBeInTheDocument();
  });

  it("does not flash a locally acknowledged notice", async () => {
    localStorage.setItem(importantNoticeAcknowledgementStorageKey(notice), "1");
    renderGate();

    await waitFor(() => expect(mocks.fetchActiveImportantNotices).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires the server acknowledgement after a guest acknowledgement and later login", async () => {
    const user = userEvent.setup();
    const firstRender = renderGate();

    await screen.findByRole("dialog", { name: "Read this first" });
    await user.click(screen.getByRole("button", { name: "importantNotice.confirm" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    firstRender.unmount();

    useAuthStore.setState({ user: { id: "member-a" } as never, profile: {} as never });
    renderGate();

    await waitFor(() => expect(mocks.fetchImportantNoticeAcknowledgements).toHaveBeenCalled());
    expect(await screen.findByRole("dialog", { name: "Read this first" })).toBeInTheDocument();
  });

  it("does not mirror a signed-in acknowledgement into guest-local state", async () => {
    useAuthStore.setState({ user: { id: "member-a" } as never, profile: {} as never });
    const user = userEvent.setup();
    const firstRender = renderGate();

    await screen.findByRole("dialog", { name: "Read this first" });
    await user.click(screen.getByRole("button", { name: "importantNotice.confirm" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.acknowledgeImportantNotice).toHaveBeenCalledWith("notice-1", 2);
    firstRender.unmount();

    useAuthStore.getState().clearSession();
    renderGate();

    await waitFor(() => expect(mocks.fetchActiveImportantNotices).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("dialog", { name: "Read this first" })).toBeInTheDocument();
  });

  it("advances active notices from oldest publication to newest and treats a revision as new", async () => {
    const olderNotice = {
      ...notice,
      id: "notice-older",
      title: "Older first",
      published_at: "2026-07-01T00:00:00.000Z",
      publication_revision: 1,
    };
    mocks.fetchActiveImportantNotices.mockResolvedValue([notice, olderNotice]);
    const user = userEvent.setup();
    renderGate();

    await screen.findByRole("dialog", { name: "Older first" });
    await user.click(screen.getByRole("button", { name: "importantNotice.confirm" }));
    await screen.findByRole("dialog", { name: "Read this first" });
  });

  it("does not let an acknowledgement for an older publication revision hide the current revision", async () => {
    localStorage.setItem(importantNoticeAcknowledgementStorageKey({ ...notice, publication_revision: 1 }), "1");
    renderGate();

    await screen.findByRole("dialog", { name: "Read this first" });
    expect(importantNoticeAcknowledgementStorageKey({ ...notice, publication_revision: 1 }))
      .not.toBe(importantNoticeAcknowledgementStorageKey(notice));
  });

  it("does not depend on local storage after a server acknowledgement", async () => {
    useAuthStore.setState({ user: { id: "member-a" } as never, profile: {} as never });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const user = userEvent.setup();
    renderGate();

    await screen.findByRole("dialog", { name: "Read this first" });
    await user.click(screen.getByRole("button", { name: "importantNotice.confirm" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("importantNotice.error")).not.toBeInTheDocument();
    expect(mocks.acknowledgeImportantNotice).toHaveBeenCalledWith("notice-1", 2);
  });
});
