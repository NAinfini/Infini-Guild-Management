import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GuildWarAddToPoolDialog } from "./GuildWarAddToPoolDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderDialog(loadError: {
  kind: "directory" | "next-page" | "identities";
  retry: () => Promise<unknown>;
  retrying: boolean;
}, options: Array<{ value: string; label: string }> = []) {
  render(
    <GuildWarAddToPoolDialog
      open
      pending={false}
      availableCount={options.length}
      options={options}
      selectedUserIds={[]}
      search=""
      onOpenChange={vi.fn()}
      onToggleUser={vi.fn()}
      onSearchChange={vi.fn()}
      memberLoadError={loadError}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
}

describe("GuildWarAddToPoolDialog member loading", () => {
  it("offers retry instead of reporting zero available members on an initial failure", async () => {
    const retry = vi.fn(async () => undefined);
    renderDialog({ kind: "directory", retry, retrying: false });

    expect(screen.getByText("loadError")).toBeInTheDocument();
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
    expect(screen.queryByText("active.addToPoolAvailable")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "action.retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("keeps loaded candidates visible when the next page fails", () => {
    renderDialog(
      { kind: "next-page", retry: vi.fn(async () => undefined), retrying: false },
      [{ value: "member-1", label: "Member One" }],
    );

    expect(screen.getByRole("checkbox", { name: "Member One" })).toBeInTheDocument();
    expect(screen.getByText("loadError")).toBeInTheDocument();
  });
});
