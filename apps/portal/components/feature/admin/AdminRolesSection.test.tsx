import { PERMISSIONS, type AdminRole, type Permission, type User } from "@guild/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminRolesSection } from "./AdminRolesSection";

const confirmMock = vi.hoisted(() => vi.fn());
const authMock = vi.hoisted(() => ({
  permissions: { "admin.roles.manage": true } as Record<string, boolean>,
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirmMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) => options?.defaultValue ?? key,
  }),
}));

vi.mock("../../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: User }) => unknown) =>
    selector({
      user: {
        id: "admin-1",
        display_name: "admin",
        role: "admin",
        role_name: "Guild Admin",
        role_color: "#ef4444",
        role_level: 999,
        permissions: authMock.permissions as Record<Permission, boolean>,
        is_active: true,
        deleted_at: null,
        created_at: "2026-06-11T00:00:00.000Z",
        updated_at: "2026-06-11T00:00:00.000Z",
        last_login_at: null,
      },
    }),
}));

const permissions = {
  "admin.roles.manage": true,
  "admin.siteConfig.manage": true,
  "admin.importantNotices.manage": true,
  "admin.storage.structure": true,
  "admin.storage.items": true,
  "admin.storage.stock": true,
} as Record<Permission, boolean>;

const roles: AdminRole[] = [{
  id: "admin",
  name: "Admin",
  level: 999,
  color: "red",
  created_at: "2026-06-11T00:00:00.000Z",
  updated_at: "2026-06-11T00:00:00.000Z",
  revision_token: "admin-role-v1",
  assigned_user_count: 1,
  permissions,
}];

const customRoles: AdminRole[] = [
  {
    ...roles[0]!,
    id: "raid-lead",
    name: "Raid Lead",
    level: 200,
    assigned_user_count: 0,
  },
  {
    ...roles[0]!,
    id: "diplomat",
    name: "Diplomat",
    level: 150,
    assigned_user_count: 0,
  },
];

function renderRolesSection(
  overrides: Partial<React.ComponentProps<typeof AdminRolesSection>> = {},
) {
  const props: React.ComponentProps<typeof AdminRolesSection> = {
    rolesLoading: false,
    rolesError: false,
    onRetryRoles: vi.fn(),
    roles,
    createRolePending: false,
    updateRolePending: false,
    isRoleDeletePending: () => false,
    onCreateRole: vi.fn(),
    onUpdateRole: vi.fn(),
    onDeleteRole: vi.fn(),
    ...overrides,
  };

  const result = render(<AdminRolesSection {...props} />);

  return {
    ...props,
    rerenderRoles(nextProps: Partial<React.ComponentProps<typeof AdminRolesSection>>) {
      result.rerender(<AdminRolesSection {...props} {...nextProps} />);
    },
  };
}

describe("AdminRolesSection permissions", () => {
  beforeEach(() => {
    confirmMock.mockReset();
    authMock.permissions = { "admin.roles.manage": true };
  });

  it("presents every capability from the shared permission contract", () => {
    renderRolesSection();

    for (const permission of PERMISSIONS) {
      expect(screen.getByText(permission)).toBeInTheDocument();
    }
  });

  it("lets a role manager grant every defined permission without holding those permissions", async () => {
    const onUpdateRole = vi.fn().mockResolvedValue(roles[0]);
    renderRolesSection({ onUpdateRole });

    for (const permission of PERMISSIONS) {
      const toggle = screen.getByRole("button", { name: permission });
      expect(toggle).toBeEnabled();
      if (toggle.getAttribute("aria-pressed") === "false") fireEvent.click(toggle);
    }
    fireEvent.click(screen.getByRole("button", { name: "roles.save" }));

    await waitFor(() => expect(onUpdateRole).toHaveBeenCalledWith("admin", expect.objectContaining({
      permissions: Object.fromEntries(PERMISSIONS.map((permission) => [permission, true])),
    })));
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("lets the actor edit their D1 role while preventing self-deletion", () => {
    renderRolesSection();

    expect(screen.getByRole("textbox", { name: "roles.field.name" })).toBeEnabled();
    expect(screen.getByRole("spinbutton", { name: "roles.field.level" })).toBeEnabled();
    const deleteButtons = screen.getAllByRole("button", { name: "roles.delete" });
    expect(deleteButtons).toHaveLength(2);
    expect(deleteButtons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    const masterDelete = within(document.querySelector(".admin-md__master") as HTMLElement)
      .getByRole("button", { name: "roles.delete" });
    expect(masterDelete.closest(".admin-md__row")).not.toBeNull();
    expect(masterDelete.closest(".admin-md__item")).toBeNull();
  });

  it("allows full editing of a different same-level role without exceeding the actor's level", async () => {
    const peerRole = {
      ...roles[0]!,
      id: "peer-admin",
      name: "Peer Admin",
      permissions: { ...permissions, "admin.importantNotices.manage": false },
    };
    const onUpdateRole = vi.fn().mockResolvedValue(peerRole);
    renderRolesSection({
      roles: [peerRole],
      onUpdateRole,
    });

    const nameInput = screen.getByRole("textbox", { name: "roles.field.name" });
    const levelInput = screen.getByRole("spinbutton", { name: "roles.field.level" });
    const colorInput = screen.getByRole("textbox", { name: "roles.field.color" });
    expect(nameInput).toBeEnabled();
    expect(levelInput).toBeEnabled();
    expect(colorInput).toBeEnabled();
    fireEvent.change(nameInput, { target: { value: "Peer Guild Manager" } });
    fireEvent.change(colorInput, { target: { value: "#336699" } });
    fireEvent.change(levelInput, { target: { value: "1000" } });
    expect(levelInput).toHaveValue(999);
    fireEvent.change(levelInput, { target: { value: "998" } });
    expect(screen.getAllByRole("button", { name: "roles.delete" }).every((button) => button.hasAttribute("disabled"))).toBe(true);

    const noticePermission = screen.getByRole("button", { name: /admin\.importantNotices\.manage/ });
    expect(noticePermission).toBeEnabled();
    fireEvent.click(noticePermission);
    fireEvent.click(screen.getByRole("button", { name: "roles.save" }));

    await waitFor(() => expect(onUpdateRole).toHaveBeenCalledWith("peer-admin", {
      expected_revision_token: peerRole.revision_token,
      name: "Peer Guild Manager",
      level: 998,
      color: "#336699",
      permissions: expect.objectContaining({ "admin.importantNotices.manage": true }),
    }));
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("can restore notice management after disabling it on the actor's role and refreshing authorization", async () => {
    authMock.permissions["admin.importantNotices.manage"] = true;
    const disabledRole = {
      ...roles[0]!,
      revision_token: "admin-role-v2",
      permissions: { ...permissions, "admin.importantNotices.manage": false },
    };
    const onUpdateRole = vi.fn()
      .mockResolvedValueOnce(disabledRole)
      .mockResolvedValueOnce({ ...roles[0]!, revision_token: "admin-role-v3" });
    confirmMock.mockResolvedValueOnce(true);
    const { rerenderRoles } = renderRolesSection({ onUpdateRole });

    fireEvent.click(screen.getByRole("button", { name: /admin\.importantNotices\.manage/ }));
    fireEvent.click(screen.getByRole("button", { name: "roles.save" }));
    await waitFor(() => expect(onUpdateRole).toHaveBeenCalledWith("admin", expect.objectContaining({
      permissions: expect.objectContaining({ "admin.importantNotices.manage": false }),
    })));

    authMock.permissions["admin.importantNotices.manage"] = false;
    rerenderRoles({ roles: [disabledRole] });
    const noticePermission = screen.getByRole("button", { name: /admin\.importantNotices\.manage/ });
    await waitFor(() => {
      expect(noticePermission).toHaveAttribute("aria-pressed", "false");
      expect(noticePermission).toBeEnabled();
    });
    fireEvent.click(noticePermission);
    fireEvent.click(screen.getByRole("button", { name: "roles.save" }));

    await waitFor(() => expect(onUpdateRole).toHaveBeenLastCalledWith("admin", expect.objectContaining({
      expected_revision_token: "admin-role-v2",
      permissions: expect.objectContaining({ "admin.importantNotices.manage": true }),
    })));
    expect(onUpdateRole).toHaveBeenCalledTimes(2);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it("keeps higher-level roles read-only", () => {
    const { onUpdateRole } = renderRolesSection({
      roles: [{ ...roles[0]!, id: "higher-admin", level: 1_000 }],
    });

    expect(screen.getByRole("textbox", { name: "roles.field.name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /admin\.importantNotices\.manage/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "roles.save" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "roles.delete" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(onUpdateRole).not.toHaveBeenCalled();
  });

  it("does not expose permission editing without role-management permission", () => {
    authMock.permissions = { "admin.importantNotices.manage": true };
    renderRolesSection();

    expect(screen.getByRole("alert")).toHaveTextContent("adminOnly");
    expect(screen.queryByRole("button", { name: /admin\.importantNotices\.manage/ })).not.toBeInTheDocument();
  });

  it("renders granular storage permission controls in the permissions page", () => {
    renderRolesSection();

    expect(screen.getByText("roles.category.storage")).toBeInTheDocument();
    expect(screen.getByText("admin.storage.structure")).toBeInTheDocument();
    expect(screen.getByText("admin.storage.items")).toBeInTheDocument();
    expect(screen.getByText("admin.storage.stock")).toBeInTheDocument();
  });

  it("renders site config and important-notice controls in the system permission group", () => {
    renderRolesSection();

    expect(screen.getByText("roles.category.adminSystem")).toBeInTheDocument();
    expect(screen.getByText("admin.siteConfig.manage")).toBeInTheDocument();
    expect(screen.getByText("admin.importantNotices.manage")).toBeInTheDocument();
    expect(screen.getByText("admin.badges.manage")).toBeInTheDocument();
  });

  it("requires explicit confirmation before removing a permission from the actor's current role", async () => {
    const onUpdateRole = vi.fn().mockResolvedValue(roles[0]);
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderRolesSection({ onUpdateRole });

    fireEvent.click(screen.getByRole("button", { name: /admin\.roles\.manage/ }));
    fireEvent.click(screen.getByRole("button", { name: "roles.save" }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "roles.confirmSelfLockTitle",
    })));
    expect(onUpdateRole).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "roles.save" }));
    await waitFor(() => expect(onUpdateRole).toHaveBeenCalledWith(
      "admin",
      expect.objectContaining({
        expected_revision_token: "admin-role-v1",
        permissions: expect.objectContaining({ "admin.roles.manage": false }),
      }),
    ));
  });

  it("keeps an A/B stale role draft and its form-open revision after a background refetch", async () => {
    const user = await import("@testing-library/user-event").then(({ default: userEvent }) => userEvent.setup());
    const onUpdateRole = vi.fn().mockResolvedValue(null);
    const { rerenderRoles } = renderRolesSection({ onUpdateRole });
    const nameInput = screen.getByRole("textbox", { name: "roles.field.name" });

    await user.clear(nameInput);
    await user.type(nameInput, "A's Admin");
    rerenderRoles({ roles: [{ ...roles[0]!, name: "B's Admin", revision_token: "admin-role-v2" }] });

    expect(nameInput).toHaveValue("A's Admin");
    await user.click(screen.getByRole("button", { name: "roles.save" }));
    await waitFor(() => expect(onUpdateRole).toHaveBeenCalledWith("admin", expect.objectContaining({
      name: "A's Admin",
      expected_revision_token: "admin-role-v1",
    })));
  });

  it("opens a focused, cancellable form and creates only after a valid name is submitted", async () => {
    const onCreateRole = vi.fn().mockResolvedValue(true);
    renderRolesSection({ onCreateRole });

    fireEvent.click(screen.getByRole("button", { name: "roles.create" }));

    expect(onCreateRole).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "roles.createTitle" });
    const nameInput = within(dialog).getByRole("textbox", { name: /roles\.field\.name/ });
    await waitFor(() => expect(nameInput).toHaveFocus());
    expect(within(dialog).getByRole("button", { name: "roles.create" })).toBeDisabled();

    fireEvent.change(nameInput, { target: { value: "Raid Lead" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "roles.create" }));

    await waitFor(() => expect(onCreateRole).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Raid Lead", level: 100 }),
    ));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "roles.createTitle" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "roles.create" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "roles.createTitle" }))
      .getByRole("button", { name: "roles.cancel" }));

    expect(onCreateRole).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "roles.createTitle" })).not.toBeInTheDocument(),
    );
  });

  it("scopes delete pending to the target role and mirrors it in the detail pane", async () => {
    const user = await import("@testing-library/user-event").then(({ default: userEvent }) => userEvent.setup());
    const onDeleteRole = vi.fn();
    renderRolesSection({
      roles: customRoles,
      isRoleDeletePending: (roleId) => roleId === "raid-lead",
      onDeleteRole,
    });

    const raidRow = screen.getByText("Raid Lead").closest(".admin-md__row") as HTMLElement;
    const diplomatRow = screen.getByText("Diplomat").closest(".admin-md__row") as HTMLElement;
    const raidDelete = within(raidRow).getByRole("button", { name: "roles.delete" });
    const diplomatDelete = within(diplomatRow).getByRole("button", { name: "roles.delete" });
    const detailDelete = within(document.querySelector(".admin-md__detail") as HTMLElement)
      .getByRole("button", { name: "roles.delete" });

    expect(raidDelete).toBeDisabled();
    expect(detailDelete).toBeDisabled();
    expect(diplomatDelete).toBeEnabled();

    await user.click(raidDelete);
    await user.click(raidDelete);
    expect(onDeleteRole).not.toHaveBeenCalled();
  });
});
