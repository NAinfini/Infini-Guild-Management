// @vitest-environment jsdom
import type { InviteLink } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdminInviteSection } from "./AdminInviteSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../hooks/useEffectivePermissions", () => ({
  useEffectivePermissions: () => ({
    canManage: () => true,
  }),
}));

const revokedInvite: InviteLink = {
  id: "invite-1",
  code: "REVOKED",
  created_by: "admin-1",
  max_uses: 5,
  used_count: 1,
  expires_at: null,
  created_at: "2026-07-28T00:00:00.000Z",
  revoked_at: "2026-07-28T01:00:00.000Z",
};

function renderSection(
  overrides: Partial<React.ComponentProps<typeof AdminInviteSection>> = {},
) {
  const props: React.ComponentProps<typeof AdminInviteSection> = {
    inviteVisibility: "revoked",
    onInviteVisibilityChange: vi.fn(),
    onCreateInvite: vi.fn(),
    createInvitePending: false,
    inviteStatsLoading: false,
    inviteStats: null,
    inviteLinksLoading: false,
    inviteLinksError: false,
    inviteRows: [revokedInvite],
    inviteTotal: 1,
    hasMoreInvites: false,
    loadingMoreInvites: false,
    onLoadMoreInvites: vi.fn(),
    inviteSearch: "",
    onInviteSearchChange: vi.fn(),
    isInviteInactive: () => true,
    onRevokeInvite: vi.fn(),
    onDeleteInvite: vi.fn(),
    ...overrides,
  };

  render(
    <MantineProvider>
      <AdminInviteSection {...props} />
    </MantineProvider>,
  );

  return props;
}

function getToolbarCreateButton() {
  return screen
    .getAllByRole("button", { name: "invite.create" })
    .find((button) => !button.closest('[role="dialog"]'))!;
}

describe("AdminInviteSection", () => {
  it("shows invite status to administrators", () => {
    renderSection();

    expect(screen.getByText("invite.table.status")).toBeInTheDocument();
    expect(screen.getByText("invite.status.revoked")).toBeInTheDocument();
  });

  it("uses the inactive status reason for disabled actions", async () => {
    const user = userEvent.setup();
    renderSection();

    const copyButton = screen.getByRole("button", { name: "invite.copy" });
    const revokeButton = screen.getByRole("button", { name: "invite.revoke" });

    expect(copyButton).toBeDisabled();
    expect(copyButton.parentElement).toHaveAttribute("data-disabled-tooltip-target");
    expect(revokeButton).toBeDisabled();
    expect(revokeButton.parentElement).toHaveAttribute("data-disabled-tooltip-target");

    await user.hover(copyButton.parentElement!);
    expect(await screen.findByText("invite.tooltip.revoked")).toBeInTheDocument();
  });

  it("resets the create form every time the modal opens", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(getToolbarCreateButton());
    const dialog = screen.getByRole("dialog");
    const maxUses = within(dialog).getByLabelText("invite.aria.maxUses");
    const expiresAt = within(dialog).getByLabelText("invite.aria.expiresAt");
    fireEvent.change(maxUses, { target: { value: "4" } });
    fireEvent.change(expiresAt, { target: { value: "2026-08-01T12:30" } });

    await user.keyboard("{Escape}");
    await user.click(getToolbarCreateButton());
    const reopenedDialog = screen.getByRole("dialog");

    expect(within(reopenedDialog).getByLabelText("invite.aria.maxUses")).toHaveValue("10");
    expect(within(reopenedDialog).getByLabelText("invite.aria.expiresAt")).toHaveValue("");
  });

  it("closes only after the current create request succeeds", async () => {
    const user = userEvent.setup();
    const onCreateInvite = vi.fn();
    renderSection({ onCreateInvite });

    await user.click(getToolbarCreateButton());
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "invite.create" }));

    expect(onCreateInvite).toHaveBeenCalledWith(
      { maxUses: 10, expiresAt: "" },
      expect.any(Function),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => {
      const successCallback = onCreateInvite.mock.calls[0]?.[1] as (() => void) | undefined;
      successCallback?.();
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("loads the next server page without client-side pagination", async () => {
    const user = userEvent.setup();
    const onLoadMoreInvites = vi.fn();
    renderSection({
      hasMoreInvites: true,
      inviteTotal: 75,
      onLoadMoreInvites,
    });

    expect(screen.getByText("invite.loadedCount")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "invite.loadMore" }));

    expect(onLoadMoreInvites).toHaveBeenCalledOnce();
  });
});
