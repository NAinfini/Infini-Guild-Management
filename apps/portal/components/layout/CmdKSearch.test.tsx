// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CmdKSearch } from "./CmdKSearch";

const navigateMock = vi.hoisted(() => vi.fn());
const apiRequestMock = vi.hoisted(() => vi.fn());

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

vi.mock("../../api/client", () => ({
  apiRequest: apiRequestMock,
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
    apiRequestMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/users")) {
        return Promise.reject(new Error("users failed"));
      }
      if (path.startsWith("/api/events")) {
        return Promise.resolve({ data: [] });
      }
      if (path.startsWith("/api/announcements")) {
        return Promise.resolve({ data: [] });
      }
      if (path.startsWith("/api/wiki/articles")) {
        return Promise.resolve({ data: [{ id: "wiki-1", title: "war history", slug: "war-history", body_json: "archive" }] });
      }
      if (path.startsWith("/api/guild-war/history")) {
        return Promise.resolve({
          data: [{ id: "war-1", war_name: "Guild War", result: "win", created_at: "2026-03-01T10:00:00.000Z" }],
        });
      }
      if (path.startsWith("/api/gallery")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
  });

  it("still shows war matches when one search source fails", async () => {
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
