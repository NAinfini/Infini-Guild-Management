import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GalleryLikeButton } from "./GalleryLikeButton";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => `${key}:${options?.count ?? ""}`,
  }),
}));

describe("GalleryLikeButton", () => {
  it("announces both the action and current count for an interactive like", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <GalleryLikeButton liked={false} likeCount={7} canLike onToggle={onToggle} />,
    );

    const button = screen.getByRole("button", { name: "aria.like:7" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("announces the count when removing an existing like", () => {
    render(
      <GalleryLikeButton liked likeCount={8} canLike onToggle={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "aria.unlike:8" })).toHaveAttribute("aria-pressed", "true");
  });
});
