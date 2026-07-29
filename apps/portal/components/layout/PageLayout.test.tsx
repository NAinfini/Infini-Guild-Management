// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageLayout } from "./PageLayout";

describe("PageLayout", () => {
  it("does not reserve a page-header row for ordinary content", () => {
    const { container } = render(
      <MantineProvider>
        <PageLayout>
          <section>Event list</section>
        </PageLayout>
      </MantineProvider>,
    );

    expect(container.querySelector(".page-layout__header")).not.toBeInTheDocument();
    expect(screen.getByText("Event list")).toBeInTheDocument();
  });

  it("keeps breadcrumbs and actions in the first content row without rendering another page header", () => {
    const { container } = render(
      <MantineProvider>
        <PageLayout
          breadcrumbs={<a href="/">Dashboard</a>}
          actions={<button type="button">Create event</button>}
        >
          <section>Event list</section>
        </PageLayout>
      </MantineProvider>,
    );

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(container.querySelector("header")).not.toBeInTheDocument();
    expect(container.querySelector(".page-layout__action-row")).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toContainElement(
      screen.getByRole("link", { name: "Dashboard" }),
    );
    expect(screen.getByRole("button", { name: "Create event" })).toBeInTheDocument();
  });

  it("uses the shell route metadata for width instead of accepting page-specific width values", () => {
    const { container } = render(
      <MantineProvider>
        <PageLayout>
          <section>Settings form</section>
        </PageLayout>
      </MantineProvider>,
    );

    expect(container.querySelector(".page-layout")).toHaveAttribute("data-page-layout", "content");
  });
});
