import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PasswordRequirements } from "./PasswordRequirements";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("PasswordRequirements", () => {
  it("shows every rule separately and updates each check as the password changes", () => {
    const { rerender, container } = render(<PasswordRequirements id="rules" password="" confirmation="" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(container.querySelectorAll('[data-met="true"]')).toHaveLength(0);

    rerender(<PasswordRequirements id="rules" password="violet7!" confirmation="different" />);
    expect(container.querySelector('[data-password-rule="uppercase"]')).toHaveAttribute("data-met", "false");
    expect(container.querySelector('[data-password-rule="lowercase"]')).toHaveAttribute("data-met", "true");
    expect(container.querySelector('[data-password-rule="special"]')).toHaveAttribute("data-met", "true");
    expect(container.querySelector('[data-password-rule="match"]')).toHaveAttribute("data-met", "false");

    rerender(<PasswordRequirements id="rules" password="Violets!" confirmation="Violets!" />);
    expect(container.querySelectorAll('[data-met="true"]')).toHaveLength(5);
  });
});
