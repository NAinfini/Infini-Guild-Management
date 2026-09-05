import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSiteConfigStore } from "../../stores/site-config";
import { SystemStatusPage } from "./SystemStatusPage";

vi.mock("../shared/VisualThemeArtwork", () => ({
  VisualThemeScene: ({ variant }: { variant?: string }) => (
    <div data-testid="scene" data-variant={variant} aria-hidden="true" />
  ),
}));

beforeEach(() => {
  useSiteConfigStore.setState({ siteName: "Infini Guild", siteLogoUrl: "/guild-logo.svg" });
});

function renderStatus(kind: "not-found" | "error" | "unauthorized" | "forbidden" | "maintenance", onClick = vi.fn()) {
  const isLink = kind === "not-found" || kind === "unauthorized" || kind === "forbidden";
  return render(
    <SystemStatusPage
      kind={kind}
      code={kind === "not-found" ? "404" : kind === "unauthorized" ? "401" : kind === "forbidden" ? "403" : kind === "maintenance" ? "503" : "500"}
      title={kind === "not-found" ? "This page is not here" : kind === "unauthorized" ? "Sign in required" : kind === "forbidden" ? "This area is restricted" : kind === "maintenance" ? "Portal maintenance in progress" : "This page cannot be opened right now"}
      description={kind === "not-found" ? "Return to the portal to continue." : kind === "unauthorized" ? "Sign in to continue to this page." : kind === "forbidden" ? "Your account does not have access to this page." : kind === "maintenance" ? "The service is being updated. Please return shortly." : "Reload the page and try again."}
      action={isLink
        ? { label: kind === "unauthorized" ? "Go to login" : "Return to portal", href: kind === "unauthorized" ? "/login" : "/" }
        : { label: "Retry", onClick }}
    />,
  );
}

describe("SystemStatusPage", () => {
  it("presents a complete 404 scene with one status panel and one recovery link", () => {
    const { container } = renderStatus("not-found");

    expect(screen.getByTestId("scene")).toHaveAttribute("data-variant", "status-not-found");
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "This page is not here" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to portal" })).toHaveAttribute("href", "/");
    expect(container.querySelectorAll(".system-status-page__panel")).toHaveLength(1);
    expect(container.querySelector(".system-status-page__emblem")).toHaveAttribute("src", "/guild-logo.svg");
    expect(container.querySelector(".system-status-page__site-name")).toHaveTextContent("Infini Guild");
  });

  it("uses the error-specific scene and a single retry action for a server error", () => {
    const onClick = vi.fn();
    renderStatus("error", onClick);

    expect(screen.getByTestId("scene")).toHaveAttribute("data-variant", "status-error");
    expect(screen.getByText("500")).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each([
    ["unauthorized", "401", "Sign in required", "link", "Go to login"],
    ["forbidden", "403", "This area is restricted", "link", "Return to portal"],
    ["maintenance", "503", "Portal maintenance in progress", "button", "Retry"],
  ] as const)("renders the %s status as a focused full-scene recovery flow", (kind, code, title, actionRole, actionLabel) => {
    renderStatus(kind);

    expect(screen.getByTestId("scene")).toHaveAttribute("data-variant", kind === "unauthorized" ? "status-forbidden" : `status-${kind}`);
    expect(screen.getByText(code)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole(actionRole, { name: actionLabel })).toBeInTheDocument();
  });

  it("does not invent a substitute logo when only the site name is available", () => {
    useSiteConfigStore.setState({ siteName: "Infini Guild", siteLogoUrl: "" });
    const { container } = renderStatus("forbidden");

    expect(container.querySelector(".system-status-page__emblem")).toBeNull();
    expect(container.querySelector(".system-status-page__site-name")).toHaveTextContent("Infini Guild");
  });
});
