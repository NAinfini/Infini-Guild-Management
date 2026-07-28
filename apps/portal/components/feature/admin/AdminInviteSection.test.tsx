// @vitest-environment jsdom
import type { InviteLink } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
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

function renderSection() {
  render(
    <MantineProvider>
      <AdminInviteSection
        inviteVisibility="revoked"
        onInviteVisibilityChange={vi.fn()}
        inviteMaxUses={1}
        onInviteMaxUsesChange={vi.fn()}
        inviteExpiresAt=""
        onInviteExpiresAtChange={vi.fn()}
        onCreateInvite={vi.fn()}
        createInvitePending={false}
        createInviteSuccess={false}
        inviteStatsLoading={false}
        inviteStats={null}
        inviteLinksLoading={false}
        inviteLinksError={false}
        inviteRows={[revokedInvite]}
        inviteSearch=""
        onInviteSearchChange={vi.fn()}
        isInviteInactive={() => true}
        onRevokeInvite={vi.fn()}
        onDeleteInvite={vi.fn()}
      />
    </MantineProvider>,
  );
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
});
