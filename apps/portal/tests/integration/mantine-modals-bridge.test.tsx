// @vitest-environment jsdom
import { KitApp } from "@infini-dev-kit/frontend/provider";
import { modals } from "@mantine/modals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

function ConfirmModalHarness() {
  return (
    <button
      type="button"
      onClick={() => {
        modals.openConfirmModal({
          title: "Delete item",
          children: "This action cannot be undone.",
          labels: {
            confirm: "Delete",
            cancel: "Cancel",
          },
        });
      }}
    >
      Open confirm
    </button>
  );
}

describe("mantine modals bridge", () => {
  it("opens a confirm modal from portal code under KitApp", async () => {
    const user = userEvent.setup();

    render(
      <KitApp>
        <ConfirmModalHarness />
      </KitApp>,
    );

    await user.click(screen.getByRole("button", { name: "Open confirm" }));

    expect(await screen.findByRole("dialog", { name: "Delete item" })).toBeInTheDocument();
    expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
