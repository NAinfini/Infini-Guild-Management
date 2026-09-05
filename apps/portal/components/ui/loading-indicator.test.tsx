import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoadingIndicator } from "./loading-indicator";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: () => "正在加载…" }) }));

describe("LoadingIndicator", () => {
  it("announces one localized status and hides only the decorative spinner", () => {
    const { container } = render(<LoadingIndicator />);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载…");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".loading-indicator__spinner")).toHaveAttribute("aria-hidden", "true");
  });
});
