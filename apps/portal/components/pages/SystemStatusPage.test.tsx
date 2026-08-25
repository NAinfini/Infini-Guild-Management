import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SystemStatusPage } from "./SystemStatusPage";

vi.mock("../shared/VisualThemeArtwork", () => ({
  VisualThemeScene: ({ variant }: { variant?: string }) => (
    <div data-testid="scene" data-variant={variant} aria-hidden="true" />
  ),
}));

function renderStatus(kind: "not-found" | "error" | "forbidden" | "maintenance", onClick = vi.fn()) {
  const isLink = kind === "not-found" || kind === "forbidden";
  return render(
    <SystemStatusPage
      kind={kind}
      code={kind === "not-found" ? "404" : kind === "forbidden" ? "403" : kind === "maintenance" ? "503" : "500"}
      title={kind === "not-found" ? "This page is not here" : kind === "forbidden" ? "This area is restricted" : kind === "maintenance" ? "Portal maintenance in progress" : "This page cannot be opened right now"}
      description={kind === "not-found" ? "Return to the portal to continue." : kind === "forbidden" ? "Your account does not have access to this page." : kind === "maintenance" ? "The service is being updated. Please return shortly." : "Reload the page and try again."}
      action={isLink
        ? { label: "Return to portal", href: "/" }
        : { label: "Retry", onClick }}
    />,
  );
}

describe("SystemStatusPage", () => {
  it("presents a complete 404 scene with one status panel and one recovery link", () => {
    const { container } = renderStatus("not-found");

    expect(screen.getByTestId("scene")).toHaveAttribute("data-variant", "status");
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "This page is not here" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to portal" })).toHaveAttribute("href", "/");
    expect(container.querySelectorAll(".system-status-page__panel")).toHaveLength(1);
  });

  it("uses the same scene and a single retry action for a server error", () => {
    const onClick = vi.fn();
    renderStatus("error", onClick);

    expect(screen.getByTestId("scene")).toHaveAttribute("data-variant", "status");
    expect(screen.getByText("500")).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each([
    ["forbidden", "403", "This area is restricted", "link"],
    ["maintenance", "503", "Portal maintenance in progress", "button"],
  ] as const)("renders the %s status as a focused full-scene recovery flow", (kind, code, title, actionRole) => {
    renderStatus(kind);

    expect(screen.getByText(code)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole(actionRole, { name: actionRole === "link" ? "Return to portal" : "Retry" })).toBeInTheDocument();
  });
});
