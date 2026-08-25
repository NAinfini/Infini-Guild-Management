import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { PortalThemeProvider } from "../../providers/ThemeProvider";

function ConfirmDialogHarness() {
  const confirm = useConfirmDialog();

  return (
    <button
      type="button"
      onClick={() => void confirm({
        title: "Delete item",
        description: "This action cannot be undone.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        intent: "danger",
      })}
    >
      Open confirm
    </button>
  );
}

describe("Base UI dialog host", () => {
  it("opens the shared confirmation dialog under PortalThemeProvider", async () => {
    const user = userEvent.setup();

    render(
      <PortalThemeProvider>
        <ConfirmDialogHarness />
      </PortalThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open confirm" }));

    expect(await screen.findByRole("alertdialog", { name: "Delete item" })).toBeInTheDocument();
    expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });
});
