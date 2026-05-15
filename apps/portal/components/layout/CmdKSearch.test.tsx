// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CmdKSearch } from "./CmdKSearch";

const navigateMock = vi.hoisted(() => vi.fn());
const fetchSearchDataMock = vi.hoisted(() => vi.fn());

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
  fetchSearchData: fetchSearchDataMock,
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
    fetchSearchDataMock.mockResolvedValue({
      users: [],
      events: [],
      announcements: [],
      wikiArticles: [{ id: "wiki-1", title: "war history", slug: "war-history", body_json: "archive" }],
      warHistory: [{ id: "war-1", war_name: "Guild War", result: "win", created_at: "2026-03-01T10:00:00.000Z" }],
      galleryItems: [],
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

    expect(
      screen.getByText((_, element) => element?.textContent === "war history"),
    ).toBeInTheDocument();
  });
});
