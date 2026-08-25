import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnsavedChangesAffix } from "../shared/UnsavedChangesAffix";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("MyProfilePage save flow", () => {
  it("only renders the save affix while changes are dirty or saving", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <UnsavedChangesAffix isDirty={false} saving={false} onSave={onSave} />,
    );

    expect(screen.queryByRole("button", { name: "action.saveProfile" })).not.toBeInTheDocument();

    rerender(
      <UnsavedChangesAffix isDirty saving={false} onSave={onSave} />,
    );

    expect(screen.getByRole("button", { name: "action.saveProfile" })).toBeEnabled();

    rerender(
      <UnsavedChangesAffix isDirty={false} saving onSave={onSave} />,
    );

    expect(screen.getByText("status.saving")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "action.saveProfile" })).toBeDisabled();
  });
});
