import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import { ContentFilterGroup, ContentFilterToolbar } from "./ContentFilterToolbar";

const responsive = vi.hoisted(() => ({ mobile: false }));

vi.mock("@portal/hooks/useMediaQuery", () => ({
  useMediaQuery: () => responsive.mobile,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

Object.defineProperty(HTMLElement.prototype, "getAnimations", {
  configurable: true,
  value: () => [],
});

function renderToolbar(overrides: Partial<React.ComponentProps<typeof ContentFilterToolbar>> = {}) {
  return render(
    <ContentFilterToolbar
      search={<Input aria-label="Search content" />}
      filterControls={<Button>Status</Button>}
      filterActions={<Button>Pinned only</Button>}
      view={<Button>Cards</Button>}
      actions={<Button>Create</Button>}
      summary={<span>12 results</span>}
      filterLabel="Filter & sort"
      activeFilterCount={2}
      {...overrides}
    />,
  );
}

function StatefulFilterToolbar() {
  const [status, setStatus] = useState("active");
  return (
    <ContentFilterToolbar
      search={<Input aria-label="Search content" />}
      filterControls={(
        <ContentFilterGroup label="Status">
          <Select
            items={{ active: "Active", archived: "Archived" }}
            value={status}
            onValueChange={(value) => setStatus(value ?? "active")}
          >
            <SelectTrigger aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </ContentFilterGroup>
      )}
      filterLabel="Filter & sort"
    />
  );
}

describe("ContentFilterToolbar", () => {
  beforeEach(() => {
    responsive.mobile = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1200, 48),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps search, view, summary, and page actions visible while filters use one entry", async () => {
    const user = userEvent.setup();
    renderToolbar();

    expect(screen.getByRole("textbox", { name: "Search content" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cards" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Create" })).toBeVisible();
    expect(screen.getByText("12 results")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pinned only" })).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Filter & sort (2)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const dialog = await screen.findByRole("dialog", { name: /Filter & sort/ });
    expect(dialog).toBeInTheDocument();
    expect(dialog.querySelector(".content-filter-toolbar__panel-heading")).toHaveTextContent("Filter & sort");
    expect(dialog.querySelector(".content-filter-toolbar__panel-heading")).toHaveTextContent("2");
    expect(within(dialog).getByRole("button", { name: "Status" }).closest(
      ".content-filter-toolbar__panel-controls",
    )).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Pinned only" }).closest(
      ".content-filter-toolbar__panel-action-rail",
    )).not.toBeNull();
  });

  it("omits the filter count when no hidden filter differs from its default", () => {
    renderToolbar({ activeFilterCount: 0 });

    expect(screen.getByRole("button", { name: "Filter & sort" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Filter & sort (2)" })).not.toBeInTheDocument();
  });

  it("shows a compact reset action only when filters differ from their defaults", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    renderToolbar({
      activeFilterCount: 1,
      resetLabel: "Reset filters",
      onReset,
      filterControls: (
        <ContentFilterGroup label="Status" description="Choose one state">
          <Button>Active</Button>
        </ContentFilterGroup>
      ),
    });

    await user.click(screen.getByRole("button", { name: "Filter & sort (1)" }));
    const dialog = await screen.findByRole("dialog", { name: /Filter & sort/ });

    expect(within(dialog).getByText("Status")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Reset filters" }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("uses a bottom drawer on mobile and returns focus after Escape", async () => {
    responsive.mobile = true;
    const user = userEvent.setup();
    renderToolbar();

    const toggle = screen.getByRole("button", { name: "Filter & sort (2)" });
    await user.click(toggle);

    const dialog = await screen.findByRole("dialog", { name: "Filter & sort" });
    expect(dialog.querySelector(".content-filter-toolbar__panel-heading")).toHaveTextContent("Filter & sort");
    expect(dialog.querySelector(".content-filter-toolbar__panel")).not.toBeNull();
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveFocus();
    });
  });

  it("keeps the desktop filter panel open while a nested Select updates", async () => {
    const user = userEvent.setup();
    render(<StatefulFilterToolbar />);

    const toggle = screen.getByRole("button", { name: "Filter & sort" });
    await user.click(toggle);
    const dialog = await screen.findByRole("dialog", { name: "Filter & sort" });

    await user.click(within(dialog).getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Archived" }));

    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("combobox", { name: "Status" })).toHaveTextContent("Archived");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the desktop panel on an outside press", async () => {
    const user = userEvent.setup();
    renderToolbar();

    const toggle = screen.getByRole("button", { name: "Filter & sort (2)" });
    await user.click(toggle);
    expect(await screen.findByRole("dialog", { name: "Filter & sort" })).toBeVisible();

    await user.click(document.body);

    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
  });

  it("uses only the final Base UI slots and container-sized wrapping", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/shared/ContentFilterToolbar.tsx"),
      "utf8",
    );
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/shared/ContentFilterToolbar.css"),
      "utf8",
    );

    expect(source).toContain("filterControls");
    expect(source).toContain("filterActions");
    expect(source).toContain("<PopoverTrigger");
    expect(source).toContain("<DrawerTrigger");
    expect(source).toContain("<ScrollArea");
    const deprecatedUiName = ["man", "tine"].join("");
    expect(source.toLowerCase()).not.toContain(deprecatedUiName);
    expect(source).not.toMatch(/flattenFilterNodes|isAuxiliaryFilter|ActionIcon|HoverCard|Tooltip|isValidElement|Children/);
    expect(source).not.toMatch(/\bfilters[?:]/);
    expect(source).not.toMatch(/\bwithBorder\b|\bpadding\b/);
    expect(css.toLowerCase()).not.toContain(deprecatedUiName);
    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/grid-template-areas:\s*"search filter view summary actions"/);
    expect(css).toContain("content-filter-toolbar__panel-action-rail");
    expect(css).toMatch(/@container content-filter-toolbar \(max-width:\s*58rem\)/);
    expect(css).toMatch(/@container content-filter-toolbar \(max-width:\s*32rem\)/);
    expect(css).toMatch(/"search filter view actions"/);
    expect(css).toMatch(/"search filter"/);
    expect(css).toMatch(/content-filter-toolbar__toggle[\s\S]*?min-height:\s*var\(--control-hit-area\)/);
    expect(css).toMatch(/content-filter-toolbar__actions[\s\S]*?grid-area:\s*actions/);
  });
});
