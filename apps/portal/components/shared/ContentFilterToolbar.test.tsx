import { Button, MantineProvider, Text, TextInput } from "@mantine/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentFilterToolbar } from "./ContentFilterToolbar";

const responsive = vi.hoisted(() => ({ mobile: false }));

vi.mock("@mantine/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mantine/hooks")>();
  return {
    ...actual,
    useMediaQuery: () => responsive.mobile,
  };
});

let resizeCallback: ResizeObserverCallback | undefined;

class ResizeObserverMock implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  disconnect() {}
  observe() {}
  unobserve() {}
}

function setToolbarWidth(width: number) {
  act(() => {
    resizeCallback?.(
      [{ contentRect: { width } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  });
}

function renderToolbar(overrides: Partial<React.ComponentProps<typeof ContentFilterToolbar>> = {}) {
  return render(
    <MantineProvider>
      <ContentFilterToolbar
        search={<TextInput aria-label="Search content" />}
        controls={<Button>Status</Button>}
        primary={<Text>12 results</Text>}
        toggleLabel="Filter & sort"
        activeSummary="Status: archived"
        activeFilterCount={2}
        {...overrides}
      />
    </MantineProvider>,
  );
}

describe("ContentFilterToolbar", () => {
  beforeEach(() => {
    responsive.mobile = false;
    resizeCallback = undefined;
    window.ResizeObserver = ResizeObserverMock;
  });

  it("keeps search and primary information visible while compact controls use one entry", async () => {
    const user = userEvent.setup();
    renderToolbar();
    setToolbarWidth(720);

    expect(screen.getByRole("textbox", { name: "Search content" })).toBeVisible();
    expect(screen.getByText("12 results")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Status" })).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Filter & sort (2)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const dialog = await screen.findByRole("dialog", { name: /Filter & sort/ });
    expect(dialog).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-controls", dialog.id);
    expect(screen.getAllByRole("button", { name: "Status", hidden: true })).toHaveLength(1);
    expect(screen.queryByText("Status: archived")).not.toBeInTheDocument();
  });

  it("renders controls inline once the toolbar itself has enough width", () => {
    renderToolbar();
    setToolbarWidth(1200);

    expect(screen.queryByRole("button", { name: "Filter & sort (2)" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Status" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("does not add a bulk clear action to the compact panel", async () => {
    const user = userEvent.setup();
    renderToolbar();
    setToolbarWidth(720);

    const toggle = screen.getByRole("button", { name: "Filter & sort (2)" });
    await user.click(toggle);

    expect(screen.queryByRole("button", { name: "Clear all", hidden: true })).not.toBeInTheDocument();
  });

  it("uses a bottom drawer on mobile and returns focus after Escape", async () => {
    responsive.mobile = true;
    const user = userEvent.setup();
    renderToolbar();
    setToolbarWidth(390);

    const toggle = screen.getByRole("button", { name: "Filter & sort (2)" });
    await user.click(toggle);

    expect(await screen.findByRole("dialog", { name: "Filter & sort" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveFocus();
    });
  });

  it("uses container sizing and a touch-friendly compact composition", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/shared/ContentFilterToolbar.tsx"),
      "utf8",
    );
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/shared/ContentFilterToolbar.css"),
      "utf8",
    );

    expect(source).not.toMatch(/clearFiltersLabel|onClearFilters/);
    expect(css).not.toContain("content-filter-toolbar__panel-footer");
    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/data-compact="true"[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
    expect(css).toMatch(/content-filter-toolbar__toggle[\s\S]*?min-height:\s*var\(--control-hit-area\)/);
    expect(css).toMatch(/content-filter-toolbar__primary[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
  });
});
