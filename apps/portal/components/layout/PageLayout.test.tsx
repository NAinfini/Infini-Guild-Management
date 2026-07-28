// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageLayout } from "./PageLayout";

describe("PageLayout", () => {
  it("renders the route title as the only h1 and exposes the page-header slots", () => {
    render(
      <MantineProvider>
        <PageLayout
          title="Events"
          subtitle="Plan and join guild activities."
          icon={<span data-testid="page-icon">E</span>}
          breadcrumbs={<a href="/">Dashboard</a>}
          actions={<button type="button">Create event</button>}
        >
          <section>Event list</section>
        </PageLayout>
      </MantineProvider>,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Events" })).toBeInTheDocument();
    expect(screen.getByText("Plan and join guild activities.")).toBeInTheDocument();
    expect(screen.getByTestId("page-icon")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toContainElement(
      screen.getByRole("link", { name: "Dashboard" }),
    );
    expect(screen.getByRole("button", { name: "Create event" })).toBeInTheDocument();
  });
});
