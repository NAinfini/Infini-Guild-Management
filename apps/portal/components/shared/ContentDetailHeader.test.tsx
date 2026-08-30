import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ContentDetailHeader } from "./ContentDetailHeader";

vi.mock("@portal/components/ui/avatar", () => ({
  Avatar: ({ children, ...props }: ComponentProps<"span">) => <span {...props}>{children}</span>,
  AvatarImage: (props: ComponentProps<"img">) => <img {...props} />,
  AvatarFallback: ({ children, ...props }: ComponentProps<"span">) => <span {...props}>{children}</span>,
}));

describe("ContentDetailHeader", () => {
  it("keeps navigation, taxonomy, identity, time, views, and actions in one semantic header", () => {
    const { container } = render(
      <ContentDetailHeader
        domain="announce"
        navigation={<button type="button">Back</button>}
        category="Important"
        states={<span>Pinned</span>}
        title="A long guild dispatch"
        authorLabel="Author"
        authorName="Guild Keeper"
        authorAvatarUrl="/avatar.webp"
        timestampLabel="Release time"
        timestamp="January 1, 2026"
        timestampDateTime="2026-01-01T00:00:00.000Z"
        viewsLabel="Views"
        viewCount={1234}
        actions={<button type="button">Edit</button>}
      />,
    );

    const header = container.querySelector(".content-detail-header");
    expect(header).not.toBeNull();
    expect(header).toHaveAttribute("data-domain", "announce");
    expect(header).toContainElement(screen.getByRole("button", { name: "Back" }));
    expect(header).toContainElement(screen.getByRole("button", { name: "Edit" }));
    const title = screen.getByRole("heading", { level: 2, name: "A long guild dispatch" });
    expect(title).toBeInTheDocument();
    expect(title.compareDocumentPosition(screen.getByText("Important")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(header as HTMLElement).getByText("Important")).toBeInTheDocument();
    expect(within(header as HTMLElement).getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("Guild Keeper")).toBeInTheDocument();
    expect(container.querySelector('img[src="/avatar.webp"]')).toBeInTheDocument();
    expect(screen.getByText("January 1, 2026").closest("time")).toHaveAttribute(
      "datetime",
      "2026-01-01T00:00:00.000Z",
    );
    expect(screen.getByText("1,234").closest("data")).toHaveAttribute("value", "1234");
    expect(container.querySelector(".content-detail-header__cover")).not.toBeInTheDocument();
  });

  it("uses a safe initial when no avatar image is available", () => {
    const { container } = render(
      <ContentDetailHeader
        domain="wiki"
        navigation="Back"
        category="Guides"
        title="Raid guide"
        authorLabel="Last editor"
        authorName="Guild member"
        timestampLabel="Updated"
        timestamp="January 2, 2026"
        timestampDateTime="2026-01-02T00:00:00.000Z"
        viewsLabel="Views"
        viewCount={8}
      />,
    );

    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("G")).toBeInTheDocument();
  });
});
