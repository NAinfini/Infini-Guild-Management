// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageTabPanel, PageTabs } from "./PageTabs";

const routerMock = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => routerMock.navigate,
  useSearch: () => routerMock.search,
}));

function renderTabs() {
  return render(
    <MantineProvider>
      <PageTabs
        defaultValue="overview"
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "history", label: "History" },
        ]}
      >
        <PageTabPanel value="overview">Overview content</PageTabPanel>
        <PageTabPanel value="history">History content</PageTabPanel>
      </PageTabs>
    </MantineProvider>,
  );
}

describe("PageTabs", () => {
  beforeEach(() => {
    routerMock.navigate.mockReset();
    routerMock.search = {};
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
  });

  it("writes the selected tab to the current URL without dropping other search state", async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByRole("tab", { name: "History" }));

    expect(routerMock.navigate).toHaveBeenCalledTimes(1);
    const navigation = routerMock.navigate.mock.calls[0]?.[0] as {
      replace?: boolean;
      search?: (previous: Record<string, unknown>) => Record<string, unknown>;
      viewTransition?: boolean;
    };
    expect(navigation.replace).toBe(true);
    expect(navigation.viewTransition).toBe(false);
    expect(navigation.search?.({ member: "user-1" })).toEqual({
      member: "user-1",
      tab: "history",
    });
  });

  it("restores the selected tab from the URL on reload", () => {
    routerMock.search = { tab: "history" };

    renderTabs();

    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("History content");
  });

  it("keeps a URL-selected tab visible inside an overflowing tab row", () => {
    routerMock.search = { tab: "history" };

    renderTabs();

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });

  it("falls back safely and carries the shared horizontal-scroll class", () => {
    routerMock.search = { tab: "removed-tab" };

    const { container } = renderTabs();

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(container.querySelector(".page-tabs__list")).not.toBeNull();
  });
});
