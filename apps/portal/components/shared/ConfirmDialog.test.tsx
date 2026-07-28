// @vitest-environment jsdom
import { Drawer, MantineProvider, Modal } from "@mantine/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialogProvider, useConfirmDialog } from "./ConfirmDialog";

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
      <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
    </MantineProvider>,
  );
}

describe("ConfirmDialog", () => {
  it("resolves a page-level confirmation without losing accessible labels", async () => {
    const user = userEvent.setup();
    renderWithProvider(<ConfirmationProbe />);

    const trigger = screen.getByRole("button", { name: "Request confirmation" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Delete entry?" });
    expect(within(dialog).getByText("This cannot be undone.")).toBeInTheDocument();
    const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
    expect(cancelButton).toHaveFocus();

    trigger.focus();
    expect(cancelButton).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(screen.getByText("true")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Delete entry?" })).not.toBeInTheDocument();
  });

  it("restores focus to the menu trigger after a menu action is cancelled", async () => {
    const user = userEvent.setup();
    renderWithProvider(<MenuConfirmationProbe />);

    const menuTrigger = screen.getByRole("button", { name: "Event actions" });
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));

    const dialog = screen.getByRole("dialog", { name: "Archive entry?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("false")).toBeInTheDocument();
    expect(menuTrigger).toHaveFocus();
  });

  it("keeps confirmation inside an existing modal instead of stacking another modal", async () => {
    const user = userEvent.setup();
    renderWithProvider(
      <Modal opened onClose={() => undefined} title="Edit entry">
        <ConfirmationProbe />
      </Modal>,
    );

    const originDialog = screen.getByRole("dialog", { name: "Edit entry" });
    await user.click(within(originDialog).getByRole("button", { name: "Request confirmation" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const inlineConfirmation = within(originDialog).getByRole("alertdialog", {
      name: "Delete entry?",
    });
    expect(within(inlineConfirmation).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(inlineConfirmation).getByRole("button", { name: "Cancel" }));

    expect(within(originDialog).getByText("false")).toBeInTheDocument();
    expect(within(originDialog).queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps confirmation inside an existing drawer instead of stacking a modal", async () => {
    const user = userEvent.setup();
    const onDrawerClose = vi.fn();
    renderWithProvider(
      <Drawer opened onClose={onDrawerClose} title="Edit article">
        <ConfirmationProbe />
      </Drawer>,
    );

    const originDialog = screen.getByRole("dialog", { name: "Edit article" });
    await user.click(within(originDialog).getByRole("button", { name: "Request confirmation" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const inlineConfirmation = within(originDialog).getByRole("alertdialog", {
      name: "Delete entry?",
    });
    expect(within(inlineConfirmation).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(onDrawerClose).not.toHaveBeenCalled();
    expect(within(originDialog).getByText("false")).toBeInTheDocument();
    expect(within(originDialog).queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
