// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useConfirmDialog } from "./useConfirmDialog";

function ConfirmationProbe() {
  const confirm = useConfirmDialog();
  const [result, setResult] = useState("pending");

  const requestConfirmation = async () => {
    const accepted = await confirm({
      title: "Delete entry?",
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      intent: "danger",
    });
    setResult(String(accepted));
  };

  return (
    <>
      <button type="button" onClick={requestConfirmation}>
        Request confirmation
      </button>
      <output>{result}</output>
    </>
  );
}

function MenuConfirmationProbe() {
  const confirm = useConfirmDialog();
  const [result, setResult] = useState("pending");

  const requestConfirmation = async () => {
    const accepted = await confirm({
      title: "Archive entry?",
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
      intent: "warning",
    });
    setResult(String(accepted));
  };

  return (
    <>
      <button id="event-actions" type="button">
        Event actions
      </button>
      <div role="menu" aria-labelledby="event-actions">
        <button type="button" role="menuitem" onClick={requestConfirmation}>
          Archive
        </button>
      </div>
      <output>{result}</output>
    </>
  );
}

function renderWithProvider(children: ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{children}</ModalsProvider>
    </MantineProvider>,
  );
}

describe("useConfirmDialog", () => {
  it("resolves a page-level confirmation without losing accessible labels", async () => {
    const user = userEvent.setup();
    renderWithProvider(<ConfirmationProbe />);

    const trigger = screen.getByRole("button", { name: "Request confirmation" });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Delete entry?" });
    expect(within(dialog).getByText("This cannot be undone.")).toBeInTheDocument();
    const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
    expect(cancelButton).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(screen.getByText("true")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Delete entry?" })).not.toBeInTheDocument();
    });
  });

  it("restores focus to the menu trigger after a menu action is cancelled", async () => {
    const user = userEvent.setup();
    renderWithProvider(<MenuConfirmationProbe />);

    const menuTrigger = screen.getByRole("button", { name: "Event actions" });
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive entry?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("false")).toBeInTheDocument();
    expect(menuTrigger).toHaveFocus();
  });

});
