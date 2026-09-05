import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../api/query-keys";
import { deferred } from "../../testing/deferred";
import { NotificationPopover } from "./NotificationPopover";

const mocks = vi.hoisted(() => ({
  fetchActiveImportantNotices: vi.fn(),
  fetchInboxNotifications: vi.fn(),
  fetchInboxUnreadCount: vi.fn(),
  markImportantNoticesRead: vi.fn(),
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
      if (key === "action.loadMore") return "Load more";
      if (key === "notification.loadMoreError") return "Unable to load more notifications.";
      if (key === "notification.title.announcement_published") return "Announcement published";
      if (key === "notification.aria.open") return `Open ${options?.title ?? ""} notification`;
      if (key === "notification.aria.openRequired") {
        return `Open ${options?.title ?? ""} notification — acknowledgement required`;
      }
      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../services/NotificationService", () => ({
  fetchActiveImportantNotices: mocks.fetchActiveImportantNotices,
  fetchInboxNotifications: mocks.fetchInboxNotifications,
  fetchInboxUnreadCount: mocks.fetchInboxUnreadCount,
  markImportantNoticesRead: mocks.markImportantNoticesRead,
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

function renderPopover(
  user: { id: string } | null = { id: "user-1" },
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  render(
    <QueryClientProvider client={queryClient}>
      <NotificationPopover user={user as never} />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("NotificationPopover", () => {
  beforeEach(() => {
    mocks.isPhone = false;
    mocks.fetchActiveImportantNotices.mockReset().mockResolvedValue([]);
    mocks.fetchInboxNotifications.mockReset().mockResolvedValue(firstPage);
    mocks.fetchInboxUnreadCount.mockReset().mockResolvedValue({ unread_count: 1 });
    mocks.markImportantNoticesRead.mockReset().mockResolvedValue({ updated: 1 });
    mocks.markInboxNotificationsRead.mockReset().mockResolvedValue({ ok: true, unread_count: 0 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 360, 48),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not request the protected inbox for a guest, even if the isolated trigger is clicked", async () => {
    const user = userEvent.setup();
    renderPopover(null);

    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(mocks.fetchInboxNotifications).not.toHaveBeenCalled();
    expect(mocks.fetchInboxUnreadCount).not.toHaveBeenCalled();
    expect(mocks.fetchActiveImportantNotices).not.toHaveBeenCalled();
  });

  it("loads only the unread count while closed and reuses fresh inbox data after opening", async () => {
    const user = userEvent.setup();
    renderPopover();

    const trigger = await screen.findByRole("button", { name: "Notifications (1 unread)" });
    expect(mocks.fetchInboxUnreadCount).toHaveBeenCalledTimes(1);
    expect(mocks.fetchInboxNotifications).not.toHaveBeenCalled();

    await user.click(trigger);
    expect(await screen.findByText("First announcement")).toBeInTheDocument();
    expect(mocks.fetchInboxNotifications).toHaveBeenCalledTimes(1);

    await user.click(trigger);
    await waitFor(() => expect(screen.queryByText("First announcement")).not.toBeInTheDocument());
    await user.click(trigger);
    expect(await screen.findByText("First announcement")).toBeInTheDocument();
    expect(mocks.fetchInboxNotifications).toHaveBeenCalledTimes(1);
    expect(mocks.fetchInboxUnreadCount).toHaveBeenCalledTimes(1);
  });

  it("refreshes only the unread count after a closed inbox is invalidated by push", async () => {
    const user = userEvent.setup();
    const queryClient = renderPopover();
    const trigger = await screen.findByRole("button", { name: "Notifications (1 unread)" });
    await user.click(trigger);
    expect(await screen.findByText("First announcement")).toBeInTheDocument();
    await user.click(trigger);
    await waitFor(() => expect(screen.queryByText("First announcement")).not.toBeInTheDocument());

    mocks.fetchInboxUnreadCount.mockResolvedValue({ unread_count: 2 });
    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }));

    expect(await screen.findByRole("button", { name: "Notifications (2 unread)" })).toBeInTheDocument();
    expect(mocks.fetchInboxUnreadCount).toHaveBeenCalledTimes(2);
    expect(mocks.fetchInboxNotifications).toHaveBeenCalledTimes(1);

    await user.click(trigger);
    await waitFor(() => expect(mocks.fetchInboxNotifications).toHaveBeenCalledTimes(2));
  });

  it("recovers the unread count from an opened inbox when the count request failed", async () => {
    mocks.fetchInboxUnreadCount.mockRejectedValue(new Error("count request failed"));
    const user = userEvent.setup();
    const queryClient = renderPopover();
    await waitFor(() => expect(queryClient.getQueryState(queryKeys.notifications.unreadCount("user-1"))?.status)
      .toBe("error"));
    expect(mocks.fetchInboxNotifications).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("First announcement")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Notifications (1 unread)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeEnabled();
  });

  it("closes from its trigger and stays closed after the exit transition", async () => {
    const user = userEvent.setup();
    renderPopover();

    const trigger = await screen.findByRole("button", { name: "Notifications (1 unread)" });
    await user.click(trigger);
    expect(await screen.findByText("First announcement")).toBeInTheDocument();

    await user.click(trigger);
    await waitFor(() => expect(screen.queryByText("First announcement")).not.toBeInTheDocument());

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.queryByText("First announcement")).not.toBeInTheDocument();
  });

  it("loads additional notification pages only when the user requests them", async () => {
    mocks.fetchInboxUnreadCount.mockResolvedValue({ unread_count: 2 });
    mocks.fetchInboxNotifications.mockImplementation(({ cursor }: { cursor?: string | null }) =>
      Promise.resolve(cursor === "next-page" ? secondPage : { ...firstPage, next_cursor: "next-page", unread_count: 2 }));
    const user = userEvent.setup();
    renderPopover();

    await user.click(await screen.findByRole("button", { name: "Notifications (2 unread)" }));

    expect(await screen.findByText("First announcement")).toBeInTheDocument();
    expect(screen.queryByText("Second announcement")).not.toBeInTheDocument();
    expect(mocks.fetchInboxNotifications).not.toHaveBeenCalledWith({ limit: 50, cursor: "next-page" });

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Second announcement")).toBeInTheDocument();
    expect(mocks.fetchInboxNotifications).toHaveBeenCalledWith({ limit: 50, cursor: "next-page" });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
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
    mocks.fetchInboxUnreadCount.mockResolvedValue({ unread_count: 0 });
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

  it("marks all unread notifications even when they are beyond the loaded page", async () => {
    mocks.fetchInboxUnreadCount.mockResolvedValue({ unread_count: 3 });
    mocks.fetchInboxNotifications.mockResolvedValue({
      ...firstPage,
      data: [{ ...firstPage.data[0]!, read_at: "2026-08-22T13:00:00.000Z" }],
      next_cursor: "older-unread-notifications",
      unread_count: 3,
    });
    const user = userEvent.setup();
    renderPopover();
    await user.click(await screen.findByRole("button", { name: "Notifications (3 unread)" }));
    expect(await screen.findByText("First announcement")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    await waitFor(() => expect(mocks.markInboxNotificationsRead).toHaveBeenCalledWith({ all: true }));
    expect(mocks.fetchInboxNotifications).not.toHaveBeenCalledWith({ limit: 50, cursor: "older-unread-notifications" });
  });

  it.each([
    { action: "selected", remaining: 3 },
    { action: "all", remaining: 0 },
  ])("uses the server's unread count after marking $action notifications read", async ({ action, remaining }) => {
    const read = deferred<{ ok: true; unread_count: number }>();
    const refresh = deferred<{ unread_count: number }>();
    mocks.markInboxNotificationsRead.mockReturnValue(read.promise);
    const user = userEvent.setup();
    const queryClient = renderPopover();
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    const row = await screen.findByRole("button", { name: firstRowLabel });
    if (action === "all") await user.click(screen.getByRole("button", { name: "Mark all read" }));
    else fireEvent.focus(row);
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
    mocks.fetchInboxUnreadCount.mockReturnValue(refresh.promise);
    mocks.fetchInboxNotifications.mockResolvedValue({
      ...firstPage,
      data: [{ ...firstPage.data[0]!, read_at: "2026-08-22T13:00:00.000Z" }],
      unread_count: remaining,
    });

    await act(async () => { read.resolve({ ok: true, unread_count: remaining }); });

    await waitFor(() => expect(queryClient.getQueryData(queryKeys.notifications.unreadCount("user-1")))
      .toEqual({ unread_count: remaining }));
    expect(await screen.findByRole("button", {
      name: remaining > 0 ? `Notifications (${remaining} unread)` : "Notifications",
    })).toBeInTheDocument();
    await act(async () => { refresh.resolve({ unread_count: remaining }); });
  });

  it("does not let a cancelled inbox response restore a count changed by marking read", async () => {
    const list = deferred<typeof firstPage>();
    const read = deferred<{ ok: true; unread_count: number }>();
    mocks.fetchInboxNotifications.mockReturnValue(list.promise);
    mocks.markInboxNotificationsRead.mockReturnValue(read.promise);
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.notifications.inbox("user-1"), {
      pages: [firstPage],
      pageParams: [undefined],
    }, { updatedAt: 1 });
    renderPopover({ id: "user-1" }, queryClient);
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    await waitFor(() => expect(mocks.fetchInboxNotifications).toHaveBeenCalledOnce());
    fireEvent.focus(await screen.findByRole("button", { name: firstRowLabel }));
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();

    await act(async () => { list.resolve(firstPage); });

    expect(queryClient.getQueryData(queryKeys.notifications.unreadCount("user-1"))).toEqual({ unread_count: 0 });
    mocks.fetchInboxUnreadCount.mockResolvedValue({ unread_count: 0 });
    mocks.fetchInboxNotifications.mockResolvedValue({ ...firstPage, data: [], unread_count: 0 });
    await act(async () => { read.resolve({ ok: true, unread_count: 0 }); });
  });

  it.each(["selected", "all"])("restores the badge and rows when marking %s notifications read fails", async (action) => {
    const read = deferred<{ ok: true; unread_count: number }>();
    const countRefresh = deferred<{ unread_count: number }>();
    const listRefresh = deferred<typeof firstPage>();
    mocks.markInboxNotificationsRead.mockReturnValue(read.promise);
    const user = userEvent.setup();
    const queryClient = renderPopover();
    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    const row = await screen.findByRole("button", { name: firstRowLabel });
    if (action === "all") await user.click(screen.getByRole("button", { name: "Mark all read" }));
    else fireEvent.focus(row);
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
    mocks.fetchInboxUnreadCount.mockReturnValue(countRefresh.promise);
    mocks.fetchInboxNotifications.mockReturnValue(listRefresh.promise);

    await act(async () => { read.reject(new Error("write failed")); });

    expect(await screen.findByRole("button", { name: "Notifications (1 unread)" })).toBeInTheDocument();
    expect(queryClient.getQueryData(queryKeys.notifications.inbox("user-1"))).toMatchObject({
      pages: [{ data: [{ id: "notification-1", read_at: null }] }],
    });
    await act(async () => {
      countRefresh.resolve({ unread_count: 1 });
      listRefresh.resolve(firstPage);
    });
  });

  it("keeps active administrator notices above recent activity and marks opening as read without acknowledging", async () => {
    mocks.fetchActiveImportantNotices.mockResolvedValue([{
      id: "notice-1",
      title: "Planned maintenance",
      body_json: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Tonight at 8" }] }],
      }),
      published_at: "2026-08-23T12:00:00.000Z",
      expires_at: null,
      requires_acknowledgement: true,
      read_at: null,
      acknowledged_at: null,
    }]);
    const user = userEvent.setup();
    renderPopover();

    await user.click(await screen.findByRole("button", { name: "Notifications (2 unread)" }));

    expect(screen.getByText("notification.noticesSection")).toBeInTheDocument();
    expect(screen.getByText("Planned maintenance")).toBeInTheDocument();
    expect(screen.getByText("notification.activitySection")).toBeInTheDocument();
    await user.click(screen.getByRole("button", {
      name: "Open Planned maintenance notification — acknowledgement required",
    }));
    await waitFor(() => expect(mocks.markImportantNoticesRead).toHaveBeenCalledWith({ ids: ["notice-1"] }));
  });

  it("marks both notice layers read without acknowledging either one", async () => {
    mocks.fetchActiveImportantNotices.mockResolvedValue([{
      id: "notice-1",
      title: "Planned maintenance",
      body_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
      published_at: "2026-08-23T12:00:00.000Z",
      expires_at: null,
      requires_acknowledgement: false,
      read_at: null,
      acknowledged_at: null,
    }]);
    const user = userEvent.setup();
    renderPopover();

    await user.click(await screen.findByRole("button", { name: "Notifications (2 unread)" }));
    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    await waitFor(() => expect(mocks.markInboxNotificationsRead).toHaveBeenCalledWith({ all: true }));
    expect(mocks.markImportantNoticesRead).toHaveBeenCalledWith({ all: true });
  });

  it("uses a bottom drawer on phone viewports", async () => {
    mocks.isPhone = true;
    const user = userEvent.setup();
    renderPopover();

    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));

    expect(await screen.findByRole("dialog", { name: /^Notifications/ })).toBeInTheDocument();
    expect(await screen.findByText("First announcement")).toBeInTheDocument();
  });

  it("keeps loading, error, and retry feedback inside the inbox panel", async () => {
    mocks.fetchInboxNotifications.mockRejectedValue(new Error("network failed"));
    const user = userEvent.setup();
    renderPopover();

    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("notification.activityLoadError");
    const callsBeforeRetry = mocks.fetchInboxNotifications.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "action.retry" }));
    await waitFor(() => expect(mocks.fetchInboxNotifications.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
  });

  it("refreshes stale inbox data when it opens", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const inboxQueryKey = queryKeys.notifications.inbox("user-1");
    queryClient.setQueryData(inboxQueryKey, {
      pages: [firstPage],
      pageParams: [undefined],
    });
    renderPopover({ id: "user-1" }, queryClient);

    const trigger = await screen.findByRole("button", { name: "Notifications (1 unread)" });
    expect(mocks.fetchInboxNotifications).not.toHaveBeenCalled();

    queryClient.setQueryData(inboxQueryKey, (current) => current, { updatedAt: 0 });
    await user.click(trigger);

    await waitFor(() => expect(mocks.fetchInboxNotifications).toHaveBeenCalledTimes(1));
  });

  it("keeps loaded notifications visible and retries only the failed next page", async () => {
    mocks.fetchInboxNotifications.mockImplementation(({ cursor }: { cursor?: string | null }) => {
      if (cursor === "next-page") return Promise.reject(new Error("next page failed"));
      return Promise.resolve({ ...firstPage, next_cursor: "next-page" });
    });
    const user = userEvent.setup();
    renderPopover();

    await user.click(await screen.findByRole("button", { name: "Notifications (1 unread)" }));
    await user.click(await screen.findByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load more notifications.");
    expect(screen.getByText("First announcement")).toBeInTheDocument();

    mocks.fetchInboxNotifications.mockImplementation(({ cursor }: { cursor?: string | null }) =>
      Promise.resolve(cursor === "next-page" ? secondPage : { ...firstPage, next_cursor: "next-page" }));
    await user.click(screen.getByRole("button", { name: "action.retry" }));

    expect(await screen.findByText("Second announcement")).toBeInTheDocument();
    expect(mocks.fetchInboxNotifications).toHaveBeenLastCalledWith({ limit: 50, cursor: "next-page" });
  });
});
