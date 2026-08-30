import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userScopedStorageKey } from "../../session-storage";
import { CmdKSearch } from "./CmdKSearch";

const navigateMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "cmdk.searchButton": "Search",
        "cmdk.searchTitle": "Global Search",
        "cmdk.searchPlaceholder": "Search everything",
        "cmdk.noResults": "No results",
        "action.retry": "Retry",
        loadError: "Unable to load search results.",
        "cmdk.recent": "Recent",
        "cmdk.category.members": "Members",
        "cmdk.category.events": "Events",
        "cmdk.category.announcements": "Announcements",
        "cmdk.category.wiki": "Wiki",
        "cmdk.category.gallery": "Gallery",
        "cmdk.category.guildWar": "Guild War",
        "cmdk.aria.openSearch": "Open search",
        "cmdk.aria.searchInput": "Search input",
        "message.loading": "Loading",
        noClass: "No class",
        unknown: "Unknown",
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../services/SearchService", () => ({
  searchGlobal: searchMock,
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe("CmdKSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    searchMock.mockResolvedValue({
      data: [
        {
          id: "user-1",
          title: "Aster",
          subtitle: "Raid coordinator",
          type: "user",
          to: "/roster?member=Aster",
          role: "raid-lead",
          role_name: "Raid Lead",
          role_color: "#22c55e",
          role_level: 100,
        },
        { id: "war-1", title: "Guild War", subtitle: "win - 2026-03-01", type: "war", to: "/guild-war" },
        {
          id: "announcement-1",
          title: "war briefing",
          subtitle: "Announcement",
          type: "announcement",
          to: "/announcements",
          entity_id: "announcement-1",
        },
        {
          id: "wiki-1",
          title: "war history",
          subtitle: "war-history",
          type: "wiki",
          to: "/wiki",
          entity_id: "war-history",
        },
      ],
    });
  });

  it("keeps the desktop trigger label in its accessible name", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const user = userEvent.setup();

    render(<CmdKSearch />, { wrapper: createWrapper(queryClient) });

    const trigger = screen.getByText("Search").closest("button");
    expect(trigger).not.toBeNull();
    expect(trigger).toHaveAccessibleName("Search");

    await user.click(trigger!);
    expect(await screen.findByRole("heading", { name: "Global Search" })).toBeInTheDocument();
  });

  it("shows war matches from search service data", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const user = userEvent.setup();

    render(<CmdKSearch />, { wrapper: createWrapper(queryClient) });

    await user.click(screen.getByRole("button", { name: "Search" }));

    const input = await screen.findByPlaceholderText("Search everything");
    await user.type(input, "war");

    await waitFor(() => {
      expect(screen.getAllByText("Guild War").length).toBeGreaterThan(0);
    });

    expect(searchMock).toHaveBeenCalledWith("war", 24);
    expect(screen.getByRole("option", { name: /war.*history/i })).toBeInTheDocument();
  });

  it("distinguishes a failed search from zero results and allows retry", async () => {
    searchMock.mockRejectedValueOnce(new Error("network failed"));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<CmdKSearch />, { wrapper: createWrapper(queryClient) });

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(await screen.findByPlaceholderText("Search everything"), "war");

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load search results.");
    expect(screen.queryByText("No results")).not.toBeInTheDocument();

    searchMock.mockResolvedValueOnce({ data: [] });
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No results")).toBeInTheDocument();
  });

  it("removes stale selectable results while a changed query is debouncing", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<CmdKSearch />, { wrapper: createWrapper(queryClient) });

    await user.click(screen.getByRole("button", { name: "Search" }));
    const input = await screen.findByPlaceholderText("Search everything");
    await user.type(input, "war");
    expect(await screen.findByRole("option", { name: /war history/i })).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "new query");

    expect(screen.queryByRole("option", { name: /war history/i })).not.toBeInTheDocument();
    expect(screen.getByText("Loading")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows the embedded D1 role name instead of a raw role id", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<CmdKSearch />, { wrapper: createWrapper(queryClient) });

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(await screen.findByPlaceholderText("Search everything"), "aster");

    expect(await screen.findByText("Raid Lead")).toBeInTheDocument();
    expect(screen.queryByText("raid-lead")).not.toBeInTheDocument();
  });

  it("loads a user-scoped recent search and applies it from the command list", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    localStorage.setItem(
      userScopedStorageKey("cmdk.recent.searches", undefined),
      JSON.stringify(["blackwater"]),
    );

    render(<CmdKSearch />, { wrapper: createWrapper(queryClient) });

    await user.click(screen.getByRole("button", { name: "Search" }));
    const recent = await screen.findByRole("option", { name: "blackwater" });
    await user.click(recent);

    expect(await screen.findByRole("combobox", { name: "Search input" })).toHaveValue("blackwater");
  });

  it("opens with the keyboard shortcut and supports keyboard result selection", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const user = userEvent.setup();

    render(<CmdKSearch />, { wrapper: createWrapper(queryClient) });

    await user.keyboard("{Control>}k{/Control}");
    const input = await screen.findByRole("combobox", { name: "Search input" });
    await user.type(input, "war");
    const options = await screen.findAllByRole("option");
    const target = options.find((option) => option.textContent?.includes("war history"));
    const targetIndex = options.indexOf(target!);

    expect(target).toBeDefined();
    expect(targetIndex).toBeGreaterThan(0);
    await waitFor(() => expect(options[0]).toHaveAttribute("aria-selected", "true"));
    await user.keyboard("{ArrowDown}".repeat(targetIndex));
    await waitFor(() => expect(target).toHaveAttribute("aria-selected", "true"));
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/wiki/$slug",
        params: { slug: "war-history" },
      });
    });
  });

  it("opens announcement matches on their independent detail route", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<CmdKSearch />, { wrapper: createWrapper(queryClient) });

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(await screen.findByPlaceholderText("Search everything"), "war");
    await user.click(await screen.findByRole("option", { name: /war briefing/i }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/announcements/$announcementId",
        params: { announcementId: "announcement-1" },
      });
    });
  });

  it("returns focus to the trigger when the palette closes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const user = userEvent.setup();

    render(<CmdKSearch />, { wrapper: createWrapper(queryClient) });

    const trigger = screen.getByRole("button", { name: "Search" });
    await user.click(trigger);
    expect(await screen.findByRole("combobox", { name: "Search input" })).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
