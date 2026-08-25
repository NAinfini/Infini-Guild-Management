import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ConfirmDialogHost } from "@portal/components/shared/ConfirmDialogHost";
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

function QueuedConfirmationProbe() {
  const confirm = useConfirmDialog();
  const [result, setResult] = useState("pending");

  const requestConfirmations = async () => {
    const [first, second] = await Promise.all([
      confirm({
        title: "First confirmation",
        confirmLabel: "Continue",
        cancelLabel: "Cancel",
      }),
      confirm({
        title: "Second confirmation",
        confirmLabel: "Continue",
        cancelLabel: "Cancel",
      }),
    ]);
    setResult(`${first},${second}`);
  };

  return (
    <>
      <button type="button" onClick={requestConfirmations}>
        Request queued confirmations
      </button>
      <output>{result}</output>
    </>
  );
}

function renderWithProvider(children: ReactNode) {
  return render(
    <>
      <ConfirmDialogHost />
      {children}
    </>,
  );
}

describe("useConfirmDialog", () => {
  it("resolves a page-level confirmation without losing accessible labels", async () => {
    const user = userEvent.setup();
    renderWithProvider(<ConfirmationProbe />);

    const trigger = screen.getByRole("button", { name: "Request confirmation" });
    await user.click(trigger);

    const dialog = await screen.findByRole("alertdialog", { name: "Delete entry?" });
    expect(within(dialog).getByText("This cannot be undone.")).toBeInTheDocument();
    const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
    expect(cancelButton).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(screen.getByText("true")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog", { name: "Delete entry?" })).not.toBeInTheDocument();
    });
  });

  it("restores focus to the menu trigger after a menu action is cancelled", async () => {
    const user = userEvent.setup();
    renderWithProvider(<MenuConfirmationProbe />);

    const menuTrigger = screen.getByRole("button", { name: "Event actions" });
    /* hidden: true 的理由同 AvailabilityEditor.test.tsx：jsdom 没有布局，
       floating-ui 的 hide 中间件会异步给已打开的浮层盖上 display: none。 */
    await user.click(screen.getByRole("menuitem", { name: "Archive", hidden: true }));

    const dialog = await screen.findByRole("alertdialog", { name: "Archive entry?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("false")).toBeInTheDocument();
    expect(menuTrigger).toHaveFocus();
  });

  it("keeps Escape and backdrop presses from settling the request", async () => {
    const user = userEvent.setup();
    renderWithProvider(<ConfirmationProbe />);

    await user.click(screen.getByRole("button", { name: "Request confirmation" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete entry?" });

    await user.keyboard("{Escape}");
    await user.click(document.querySelector('[data-slot="alert-dialog-overlay"]')!);

    expect(screen.getByRole("alertdialog", { name: "Delete entry?" })).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  });

  it("serializes concurrent requests through one dialog", async () => {
    const user = userEvent.setup();
    renderWithProvider(<QueuedConfirmationProbe />);

    await user.click(screen.getByRole("button", { name: "Request queued confirmations" }));
    const first = await screen.findByRole("alertdialog", { name: "First confirmation" });
    await user.click(within(first).getByRole("button", { name: "Continue" }));

    const second = await screen.findByRole("alertdialog", { name: "Second confirmation" });
    expect(within(second).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(second).getByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("true,false")).toBeInTheDocument();
  });

});
