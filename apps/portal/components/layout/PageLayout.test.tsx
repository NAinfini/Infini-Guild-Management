import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageLayout } from "./PageLayout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "nav.breadcrumbs": "Localized breadcrumb navigation",
    })[key] ?? key,
  }),
}));

describe("PageLayout", () => {
  it("does not reserve a page-header row for ordinary content", () => {
    const { container } = render(
      <PageLayout>
        <section>Event list</section>
      </PageLayout>,
    );

    expect(container.querySelector(".page-layout__header")).not.toBeInTheDocument();
    expect(screen.getByText("Event list")).toBeInTheDocument();
  });

  it("keeps breadcrumbs and actions in the first content row without rendering another page header", () => {
    const { container } = render(
      <PageLayout
        breadcrumbs={<a href="/">Dashboard</a>}
        actions={<button type="button">Create event</button>}
      >
        <section>Event list</section>
      </PageLayout>,
    );

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(container.querySelector("header")).not.toBeInTheDocument();
    expect(container.querySelector(".page-layout__action-row")).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "Localized breadcrumb navigation" })).toContainElement(
      screen.getByRole("link", { name: "Dashboard" }),
    );
    expect(screen.getByRole("button", { name: "Create event" })).toBeInTheDocument();
  });

  it("uses the shell route metadata for width instead of accepting page-specific width values", () => {
    const { container } = render(
      <PageLayout>
        <section>Settings form</section>
      </PageLayout>,
    );

    expect(container.querySelector(".page-layout")).toHaveAttribute("data-page-layout", "content");
  });

  it("keeps an optional toolbar outside the scrolling workspace", () => {
    const { container } = render(
      <PageLayout toolbar={<div>Search and filters</div>}>
        <section>Announcement list</section>
      </PageLayout>,
    );

    const toolbar = container.querySelector(".page-layout__toolbar");
    const workspace = container.querySelector(".page-layout__workspace");

    expect(toolbar).toHaveTextContent("Search and filters");
    expect(workspace).toHaveTextContent("Announcement list");
    expect(toolbar?.parentElement).toBe(workspace?.parentElement);
    expect(toolbar?.nextElementSibling).toBe(workspace);
  });

  it("declares whether the shared workspace or an inner pane owns scrolling", () => {
    const { container, rerender } = render(
      <PageLayout>
        <section>Scrollable page</section>
      </PageLayout>,
    );

    expect(container.querySelector(".page-layout")).toHaveAttribute(
      "data-workspace-mode",
      "scroll",
    );

    rerender(
      <PageLayout workspaceMode="contained">
        <section>Pane workspace</section>
      </PageLayout>,
    );

    expect(container.querySelector(".page-layout")).toHaveAttribute(
      "data-workspace-mode",
      "contained",
    );
  });
});
