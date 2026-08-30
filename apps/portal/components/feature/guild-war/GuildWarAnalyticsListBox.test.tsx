import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { UserListBoxItem } from "./GuildWarAnalyticsListBox";

vi.mock("@portal/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AvatarImage: ({
    src,
    alt,
    loading,
    decoding,
  }: {
    src: string;
    alt: string;
    loading?: "eager" | "lazy";
    decoding?: "async" | "auto" | "sync";
  }) => <img src={src} alt={alt} loading={loading} decoding={decoding} />,
  AvatarFallback: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

describe("UserListBoxItem", () => {
  it("renders the member avatar when analytics provides one", () => {
    const { container } = render(
      <UserListBoxItem
        item={{
          value: "user-1",
          label: "Aster",
          avatarMediaId: "avatar1234567890abcde",
        }}
        checked={false}
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("/api/media/avatar1234567890abcde/view"),
    );
    expect(container.querySelector("img")).toHaveAttribute("loading", "lazy");
    expect(container.querySelector("img")).toHaveAttribute("decoding", "async");
  });
});
