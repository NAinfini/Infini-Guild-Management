// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

function renderModal() {
  render(
    <MantineProvider>
      <TitleSandboxModal opened onClose={() => {}} />
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
});
