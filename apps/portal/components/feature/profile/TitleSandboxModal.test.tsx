// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enTools from "../../../i18n/en/tools.json";
import zhTools from "../../../i18n/zh/tools.json";
import { TitleSandboxModal } from "./TitleSandboxModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@portal/hooks/useExternalView", () => ({
  useExternalView: () => false,
}));

vi.mock("@portal/utils/notifications", () => ({
  notifySuccess: vi.fn(),
}));

function renderModal(initialHtml?: string) {
  render(
    <MantineProvider>
      <TitleSandboxModal opened onClose={() => {}} initialHtml={initialHtml} />
    </MantineProvider>,
  );
}

describe("TitleSandboxModal", () => {
  it("renders the workspace editor layout", () => {
    renderModal();

    expect(document.querySelector(".sandbox__topbar")).not.toBeNull();
    expect(document.querySelector(".sandbox__workspace")).not.toBeNull();
    expect(document.querySelector(".sandbox__panel--controls")).not.toBeNull();
    expect(document.querySelector(".sandbox__panel--output")).not.toBeNull();
  });

  it("switches an initial title to generated markup when a design control changes", () => {
    renderModal("<strong>Existing title</strong>");

    const preview = document.querySelector(".sandbox__preview-rendered");
    expect(preview).toHaveTextContent("Existing title");

    fireEvent.change(screen.getByLabelText("sandbox.aria.titleInput"), {
      target: { value: "Updated title" },
    });

    expect(preview).toHaveTextContent("Updated title");
    expect(preview).not.toHaveTextContent("Existing title");
  });

  it("switches manual markup back to generated markup when typography changes", () => {
    renderModal();

    const preview = document.querySelector(".sandbox__preview-rendered");
    fireEvent.change(screen.getByLabelText("sandbox.aria.customHtmlOverride"), {
      target: { value: "<em>Manual title</em>" },
    });
    expect(preview).toHaveTextContent("Manual title");

    fireEvent.click(screen.getByLabelText("sandbox.aria.toggleUnderline"));

    expect(preview).toHaveTextContent("sandbox.defaultTitle");
    expect(preview).not.toHaveTextContent("Manual title");
  });

  it("uses neutral bilingual preview copy instead of a guild-specific title", () => {
    expect(enTools["sandbox.defaultTitle"]).toBe("Title Preview");
    expect(zhTools["sandbox.defaultTitle"]).toBe("称号预览");
  });
});
