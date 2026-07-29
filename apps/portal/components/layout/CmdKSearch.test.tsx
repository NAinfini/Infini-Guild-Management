// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
        <MantineProvider>{children}</MantineProvider>
      </QueryClientProvider>
    );
  };
}

describe("CmdKSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchMock.mockResolvedValue({
      data: [
        { id: "war-1", title: "Guild War", subtitle: "win - 2026-03-01", type: "war", to: "/guild-war" },
        { id: "wiki-1", title: "war history", subtitle: "war-history", type: "wiki", to: "/wiki" },
      ],
    });
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

    await user.click(screen.getByRole("button", { name: "Open search" }));

    const input = await screen.findByPlaceholderText("Search everything");
    await user.type(input, "war");

    await waitFor(() => {
      expect(screen.getAllByText("Guild War").length).toBeGreaterThan(0);
    });

    expect(searchMock).toHaveBeenCalledWith("war", 24);
    expect(screen.getByRole("option", { name: /war.*history/i })).toBeInTheDocument();
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
    await screen.findAllByRole("option");

    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: "/wiki" });
    });
  });

  it("keeps initial autofocus visually quiet until focus leaves the search input", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const user = userEvent.setup();

    render(<CmdKSearch />, { wrapper: createWrapper(queryClient) });

    await user.click(screen.getByRole("button", { name: "Open search" }));
    const input = await screen.findByRole("combobox", { name: "Search input" });

    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute("data-silent-autofocus", "true");

    await user.tab();
    expect(input).not.toHaveAttribute("data-silent-autofocus");
  });
});
