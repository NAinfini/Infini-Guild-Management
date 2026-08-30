import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageLayout } from "./PageLayout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("PageLayout workspace ownership", () => {
  it("declares whether the shared workspace or an inner pane owns vertical scrolling", () => {
    const { container, rerender } = render(
      <PageLayout><section>Scrollable page</section></PageLayout>,
    );

    expect(container.querySelector(".page-layout")).toHaveAttribute("data-workspace-mode", "scroll");

    rerender(
      <PageLayout workspaceMode="contained"><section>Contained pane</section></PageLayout>,
    );

    expect(container.querySelector(".page-layout")).toHaveAttribute("data-workspace-mode", "contained");
  });
});
