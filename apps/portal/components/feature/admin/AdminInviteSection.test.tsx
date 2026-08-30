import type { AdminRole, InviteLink } from "@guild/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminInviteSection } from "./AdminInviteSection";

const responsive = vi.hoisted(() => ({ compact: false }));

vi.mock("@portal/hooks/useMediaQuery", () => ({
  useMediaQuery: () => responsive.compact,
}));

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
  code: "A1B2C3D4E5",
  created_by: "admin-1",
  role_id: "raid-lead",
  role_name: "Raid Lead",
  role_color: "#22c55e",
  role_level: 100,
  max_uses: 5,
  used_count: 1,
  expires_at: null,
  created_at: "2026-07-28T00:00:00.000Z",
  revoked_at: "2026-07-28T01:00:00.000Z",
};

const roles = [{
  id: "raid-lead",
  name: "Raid Lead",
  level: 100,
  color: "#22c55e",
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
  assigned_user_count: 1,
  permissions: {},
}] as unknown as AdminRole[];

const activeInvite: InviteLink = {
  ...revokedInvite,
  id: "invite-2",
  used_count: 2,
  expires_at: "9999-12-31T23:59:59.999Z",
  revoked_at: null,
};

function renderSection(
  overrides: Partial<React.ComponentProps<typeof AdminInviteSection>> = {},
) {
  const props: React.ComponentProps<typeof AdminInviteSection> = {
    inviteVisibility: "revoked",
    onInviteVisibilityChange: vi.fn(),
    onCreateInvite: vi.fn(),
    roles,
    createInvitePending: false,
    inviteStatsLoading: false,
    inviteStats: null,
    inviteLinksLoading: false,
    inviteLinksError: false,
    onRetryInviteLinks: vi.fn(),
    inviteRows: [revokedInvite],
    inviteTotal: 1,
    hasMoreInvites: false,
    loadingMoreInvites: false,
    onLoadMoreInvites: vi.fn(),
    inviteSearch: "",
    onInviteSearchChange: vi.fn(),
    isInviteInactive: () => true,
    isInviteActionPending: () => false,
    onRevokeInvite: vi.fn(),
    onDeleteInvite: vi.fn(),
    ...overrides,
  };

  render(<AdminInviteSection {...props} />);

  return props;
}

function getToolbarCreateButton() {
  return screen
    .getAllByRole("button", { name: "invite.create" })
    .find((button) => !button.closest('[role="dialog"]'))!;
}

describe("AdminInviteSection", () => {
  beforeEach(() => {
    responsive.compact = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1200, 48),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows invite status to administrators", () => {
    renderSection();

    expect(screen.getByText("invite.table.status")).toBeInTheDocument();
    expect(screen.getByText("invite.status.revoked")).toBeInTheDocument();
  });

  it("keeps search and creation visible while status uses the shared filter menu", async () => {
    const user = userEvent.setup();
    renderSection();

    expect(screen.getByRole("textbox", { name: "invite.search" })).toBeVisible();
    expect(getToolbarCreateButton()).toBeVisible();
    await user.click(screen.getByRole("button", { name: "common:filter.toggle (1)" }));
    const filterDialog = await screen.findByRole("dialog", { name: /common:filter\.toggle/ });
    expect(within(filterDialog).getByRole("radiogroup", { name: "invite.filter.status" })).toBeInTheDocument();
    expect(within(filterDialog).getByRole("radio", { name: "invite.segActive" })).toBeInTheDocument();
    expect(within(filterDialog).getByRole("radio", { name: "invite.segExpired" })).toBeInTheDocument();
    expect(within(filterDialog).getByRole("radio", { name: "invite.segRevoked" })).toBeInTheDocument();
  });

  it("uses the inactive status reason for disabled actions", async () => {
    renderSection();

    // 撤销/删除收进了行尾的 ⋮ 菜单，置灰的撤销项同样要带上原因。
    fireEvent.click(screen.getByRole("button", { name: "invite.table.actions" }));
    /* hidden: true 的理由同 AvailabilityEditor.test.tsx：jsdom 没有布局，
       floating-ui 的 hide 中间件会异步给已打开的浮层盖上 display: none。 */
    const dropdown = await screen.findByRole("menu", { hidden: true });
    const revokeItem = within(dropdown).getByText("invite.revoke").closest('[role="menuitem"]')!;

    expect(revokeItem).toHaveAttribute("aria-disabled", "true");
    expect(revokeItem.parentElement).toHaveAttribute("data-disabled-tooltip-target");
  });

  it("resets the create form after every cancel path", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(getToolbarCreateButton());
    const dialog = screen.getByRole("dialog");
    const maxUses = within(dialog).getByLabelText("invite.aria.maxUses");
    const expiresAt = within(dialog).getByLabelText("invite.aria.expiresAt");
    const role = within(dialog).getByLabelText("invite.aria.role");
    await user.click(role);
    await user.click(await screen.findByRole("option", { name: "Raid Lead", hidden: true }));
    fireEvent.change(maxUses, { target: { value: "4" } });
    fireEvent.change(expiresAt, { target: { value: "2026-08-01T12:30" } });

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(getToolbarCreateButton());
    const reopenedDialog = screen.getByRole("dialog");

    expect(within(reopenedDialog).getByLabelText("invite.aria.maxUses")).toHaveValue(10);
    expect(within(reopenedDialog).getByLabelText("invite.aria.expiresAt")).toHaveValue("");
    expect(within(reopenedDialog).getByLabelText("invite.aria.role")).toHaveValue("");

    await user.click(within(reopenedDialog).getByLabelText("invite.aria.role"));
    await user.click(await screen.findByRole("option", { name: "Raid Lead", hidden: true }));
    await user.click(within(reopenedDialog).getByRole("button", { name: "common:action.close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(getToolbarCreateButton());
    expect(within(screen.getByRole("dialog")).getByLabelText("invite.aria.role")).toHaveValue("");
  });

  it("closes only after the current create request succeeds", async () => {
    const user = userEvent.setup();
    const onCreateInvite = vi.fn();
    renderSection({ onCreateInvite });

    await user.click(getToolbarCreateButton());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "invite.create" })).toBeDisabled();
    await user.click(within(dialog).getByLabelText("invite.aria.role"));
    await user.click(await screen.findByRole("option", { name: "Raid Lead", hidden: true }));
    await user.click(within(dialog).getByRole("button", { name: "invite.create" }));

    expect(onCreateInvite).toHaveBeenCalledWith(
      { roleId: "raid-lead", maxUses: 10, expiresAt: "" },
      expect.any(Function),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => {
      const successCallback = onCreateInvite.mock.calls[0]?.[1] as ((invite: InviteLink) => void) | undefined;
      successCallback?.({
        ...activeInvite,
        code: "F6G7H8J9K0",
      });
    });

    expect(within(screen.getByRole("dialog")).getByText("invite.createdCodeNotice")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByLabelText("invite.createdLink"))
      .toHaveValue(`${window.location.origin}/register/F6G7H8J9K0`);
    expect(within(screen.getByRole("dialog")).getByLabelText("invite.createdCode"))
      .toHaveTextContent("F6G7H8J9K0");
    await user.click(within(screen.getByRole("dialog")).getAllByRole("button", { name: "common:action.close" }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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

  it("uses a complete, keyboard-reachable invite card at compact widths", () => {
    responsive.compact = true;
    renderSection({
      inviteVisibility: "active",
      inviteRows: [activeInvite],
      isInviteInactive: () => false,
    });

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const card = screen.getByRole("article", { name: "invite.cardAria" });
    expect(within(card).getByText("Raid Lead")).toBeInTheDocument();
    expect(within(card).getByText("2/5")).toBeInTheDocument();
    expect(within(card).getByText("invite.status.active")).toBeInTheDocument();
    expect(within(card).getByText("invite.table.expires")).toBeInTheDocument();
    expect(within(card).getByText("invite.table.created")).toBeInTheDocument();
    expect(card.querySelectorAll("time")).toHaveLength(2);

    expect(within(card).getByRole("button", { name: "invite.revoke" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "invite.delete" })).toBeEnabled();
  });

  it.each([
    ["desktop", false],
    ["compact", true],
  ] as const)("scopes destructive pending by invite id in the %s layout", async (_label, compact) => {
    responsive.compact = compact;
    const user = userEvent.setup();
    const onRevokeInvite = vi.fn();
    const onDeleteInvite = vi.fn();
    const otherInvite: InviteLink = {
      ...activeInvite,
      id: "invite-3",
    };
    renderSection({
      inviteVisibility: "active",
      inviteRows: [activeInvite, otherInvite],
      inviteTotal: 2,
      isInviteInactive: () => false,
      isInviteActionPending: (inviteId) => inviteId === activeInvite.id,
      onRevokeInvite,
      onDeleteInvite,
    });

    if (compact) {
      const cards = screen.getAllByRole("article", { name: "invite.cardAria" });
      const targetRevoke = within(cards[0]!).getByRole("button", { name: "invite.revoke" });
      const targetDelete = within(cards[0]!).getByRole("button", { name: "invite.delete" });
      expect(targetRevoke).toBeDisabled();
      expect(targetDelete).toBeDisabled();
      expect(within(cards[1]!).getByRole("button", { name: "invite.revoke" })).toBeEnabled();
      expect(within(cards[1]!).getByRole("button", { name: "invite.delete" })).toBeEnabled();

      await user.click(targetRevoke);
      await user.click(targetRevoke);
      await user.click(targetDelete);
      await user.click(targetDelete);
    } else {
      const actionButtons = screen.getAllByRole("button", { name: "invite.table.actions" });
      await user.click(actionButtons[0]!);
      let dropdown = await screen.findByRole("menu", { hidden: true });
      const targetRevoke = within(dropdown).getByText("invite.revoke").closest('[role="menuitem"]')!;
      const targetDelete = within(dropdown).getByText("invite.delete").closest('[role="menuitem"]')!;
      expect(targetRevoke).toHaveAttribute("aria-disabled", "true");
      expect(targetDelete).toHaveAttribute("aria-disabled", "true");

      await user.click(targetRevoke);
      await user.click(targetDelete);
      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(screen.queryByRole("menu", { hidden: true })).not.toBeInTheDocument();
      });
      await user.click(actionButtons[1]!);
      dropdown = await screen.findByRole("menu", { hidden: true });
      expect(within(dropdown).getByText("invite.revoke").closest('[role="menuitem"]')).not.toHaveAttribute("aria-disabled", "true");
      expect(within(dropdown).getByText("invite.delete").closest('[role="menuitem"]')).not.toHaveAttribute("aria-disabled", "true");
    }

    expect(onRevokeInvite).not.toHaveBeenCalled();
    expect(onDeleteInvite).not.toHaveBeenCalled();
  });
});
