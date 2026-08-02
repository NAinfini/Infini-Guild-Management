// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CmdKSearch } from "./CmdKSearch";
import styles from "./CmdKSearch.module.css";

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

  it("keeps the desktop trigger label in its accessible name and uses a semantic title color", async () => {
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
    expect(await screen.findByText("Global Search")).toHaveClass(styles.modalTitle!);
  });

  it("marks the compact trigger as a header touch target", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(<CmdKSearch asIcon />, { wrapper: createWrapper(queryClient) });

    expect(screen.getByRole("button", { name: "Open search" })).toHaveClass("app-header-icon-btn");
  });

  it("keeps header icon hit targets at least 44 pixels square", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/layout/AppShell.css"), "utf8");
    const iconRule = css.match(/\.app-header-icon-btn\s*\{([^}]*)\}/)?.[1] ?? "";

    /*
     * 尺寸走 --control-hit-area，不再写死 44px：theme-tokens.test.ts 禁止在按钮
     * 选择器上写裸像素高度，同一个文件里另有一条断言钉住该 token 的值就是 44px，
     * 两处合起来仍然保证了这块热区不小于 44 见方。
     */
    expect(iconRule).toMatch(/min-width:\s*var\(--control-hit-area\)/);
    expect(iconRule).toMatch(/min-height:\s*var\(--control-hit-area\)/);
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

    await user.click(screen.getByRole("button", { name: "Search" }));
    const input = await screen.findByRole("combobox", { name: "Search input" });

    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute("data-silent-autofocus", "true");

    await user.tab();
    expect(input).not.toHaveAttribute("data-silent-autofocus");
  });
});
