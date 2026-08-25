import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationPopover } from "./NotificationPopover";

const mocks = vi.hoisted(() => ({
  fetchInboxNotifications: vi.fn(),
  markInboxNotificationsRead: vi.fn(),
  isPhone: false,
}));

vi.mock("../../hooks/useMediaQuery", () => ({
  useMediaQuery: () => mocks.isPhone,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "label.notificationsUnread") return `Notifications (${options?.count ?? 0} unread)`;
      if (key === "label.notifications") return "Notifications";
      if (key === "action.markAllRead") return "Mark all read";
      if (key === "notification.title.announcement_published") return "Announcement published";
      if (key === "notification.aria.open") return `Open ${options?.title ?? ""} notification`;
      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../services/NotificationService", () => ({
  fetchInboxNotifications: mocks.fetchInboxNotifications,
  markInboxNotificationsRead: mocks.markInboxNotificationsRead,
}));

const firstPage = {
  data: [{
    id: "notification-1",
    kind: "announcement_published" as const,
    entity_type: "announcement" as const,
    entity_id: "announcement-1",
    payload: { title: "First announcement" },
    occurred_at: "2026-08-22T12:00:00.000Z",
    read_at: null,
  }],
  next_cursor: null,
  unread_count: 1,
};

const secondPage = {
  data: [{
    id: "notification-2",
    kind: "announcement_published" as const,
    entity_type: "announcement" as const,
    entity_id: "announcement-2",
    payload: { title: "Second announcement" },
    occurred_at: "2026-08-21T12:00:00.000Z",
    read_at: null,
  }],
  next_cursor: null,
  unread_count: 2,
};

const firstRowLabel = "Open Announcement published: First announcement notification";

function renderPopover(user: { id: string } | null = { id: "user-1" }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NotificationPopover user={user as never} />
    </QueryClientProvider>,
  );
}

describe("NotificationPopover", () => {
  beforeEach(() => {
    mocks.isPhone = false;
    mocks.fetchInboxNotifications.mockReset().mockResolvedValue(firstPage);
    mocks.markInboxNotificationsRead.mockReset().mockResolvedValue({ ok: true, unread_count: 0 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 360, 48),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a viewport-safe width and bounded scrolling contract", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/layout/NotificationPopover.module.css"),
      "utf8",
    );

    expect(styles).toMatch(/width:\s*min\(27\.5rem,\s*calc\(100vw - var\(--space-xl\)\)\)/);
    expect(styles).toMatch(/max-height:\s*min\(/);
    expect(styles).toContain("overflow-y: auto");
  });

  it("does not request the protected inbox for a guest, even if the isolated trigger is clicked", async () => {
    const user = userEvent.setup();
    renderPopover(null);

    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(mocks.fetchInboxNotifications).not.toHaveBeenCalled();
  });

  it("automatically loads every recent notification page without exposing filter, read-toggle, or load-more controls", async () => {
    mocks.fetchInboxNotifications.mockImplementation(({ cursor }: { cursor?: string | null }) =>
      Promise.resolve(cursor === "next-page" ? secondPage : { ...firstPage, next_cursor: "next-page", unread_count: 2 }));
    const user = userEvent.setup();
    renderPopover();

    await user.click(await screen.findByRole("button", { name: "Notifications (2 unread)" }));

    expect(await screen.findByText("Second announcement")).toBeInTheDocument();
    expect(mocks.fetchInboxNotifications).toHaveBeenCalledWith({ limit: 50, cursor: "next-page" });
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("marks an unread notification once on fine-pointer hover even if it subsequently receives focus", async () => {
    let resolveRead!: (value: { ok: true; unread_count: number }) => void;
    mocks.markInboxNotificationsRead.mockReturnValue(new Promise<{ ok: true; unread_count: number }>((resolve) => {
      resolveRead = resolve;
    }));
    const user = userEvent.setup();
    renderPopover();
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    const row = await screen.findByRole("button", { name: firstRowLabel });

    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    fireEvent.focus(row);
    fireEvent.pointerEnter(row, { pointerType: "mouse" });

    await waitFor(() => expect(mocks.markInboxNotificationsRead).toHaveBeenCalledTimes(1));
    expect(mocks.markInboxNotificationsRead).toHaveBeenCalledWith({ ids: ["notification-1"] });
    resolveRead({ ok: true, unread_count: 0 });
  });

  it("marks an unread notification on keyboard focus", async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    const row = await screen.findByRole("button", { name: firstRowLabel });

    fireEvent.focus(row);

    await waitFor(() => expect(mocks.markInboxNotificationsRead).toHaveBeenCalledWith({ ids: ["notification-1"] }));
  });

  it("does not mark an already-read row on hover or focus", async () => {
    mocks.fetchInboxNotifications.mockResolvedValue({
      ...firstPage,
      data: [{ ...firstPage.data[0]!, read_at: "2026-08-22T13:00:00.000Z" }],
      unread_count: 0,
    });
    const user = userEvent.setup();
    renderPopover();
    await user.click(await screen.findByRole("button", { name: "Notifications" }));
    const row = await screen.findByRole("button", { name: firstRowLabel });

    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    fireEvent.focus(row);

    expect(mocks.markInboxNotificationsRead).not.toHaveBeenCalled();
  });

  it("keeps the explicit mark-all-read action", async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));

    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    await waitFor(() => expect(mocks.markInboxNotificationsRead).toHaveBeenCalledWith({ all: true }));
  });

  it("uses a bottom drawer on phone viewports", async () => {
    mocks.isPhone = true;
    const user = userEvent.setup();
    renderPopover();

    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));

    expect(await screen.findByRole("dialog", { name: /^Notifications/ })).toBeInTheDocument();
    expect(screen.getByText("First announcement")).toBeInTheDocument();
  });

  it("keeps loading, error, and retry feedback inside the inbox panel", async () => {
    mocks.fetchInboxNotifications.mockRejectedValue(new Error("network failed"));
    const user = userEvent.setup();
    renderPopover();

    await user.click(await screen.findByRole("button", { name: "Notifications" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("loadError");
    const callsBeforeRetry = mocks.fetchInboxNotifications.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "action.retry" }));
    await waitFor(() => expect(mocks.fetchInboxNotifications.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
  });

  it("uses the shared Base UI popover and drawer primitives", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/layout/NotificationPopover.tsx"),
      "utf8",
    );

    expect(source).toContain('"@portal/components/ui/popover"');
    expect(source).toContain('"@portal/components/ui/drawer"');
    expect(source.toLowerCase()).not.toContain(["man", "tine"].join(""));
  });

  it("does not retain the removed unread mutation, segmented tabs, eyes, or manual pagination in the source", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/layout/NotificationPopover.tsx"),
      "utf8",
    );

    expect(source).not.toContain("markInboxNotificationUnread");
    expect(source).not.toContain("SegmentedControl");
    expect(source).not.toContain("EyeIcon");
    expect(source).not.toContain("notification.action.loadMore");
  });
});
