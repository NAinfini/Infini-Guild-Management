import { PERMISSIONS, type AdminRole, type Permission, type User } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminRolesSection } from "./AdminRolesSection";

const confirmMock = vi.hoisted(() => vi.fn());

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
        username: "admin",
        role: "admin",
        role_name: "Guild Admin",
        role_color: "#ef4444",
        role_level: 999,
        permissions: { "admin.roles.manage": true } as Record<Permission, boolean>,
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

  render(
    <MantineProvider>
      <AdminRolesSection {...props} />
    </MantineProvider>,
  );

  return props;
}

describe("AdminRolesSection storage permissions", () => {
  it("presents every capability from the shared permission contract", () => {
    renderRolesSection();

    for (const permission of PERMISSIONS) {
      expect(screen.getByText(permission)).toBeInTheDocument();
    }
  });

  it("lets the actor edit their D1 role while preventing self-deletion", () => {
    renderRolesSection();

    expect(screen.getByRole("textbox", { name: "roles.field.name" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "roles.field.level" })).toBeEnabled();
    const deleteButtons = screen.getAllByRole("button", { name: "roles.delete" });
    expect(deleteButtons).toHaveLength(2);
    expect(deleteButtons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    const masterDelete = within(document.querySelector(".admin-md__master") as HTMLElement)
      .getByRole("button", { name: "roles.delete" });
    expect(masterDelete.closest(".admin-md__row")).not.toBeNull();
    expect(masterDelete.closest(".admin-md__item")).toBeNull();
  });

  it("keeps a different same-level role read-only", async () => {
    renderRolesSection({
      roles: [{ ...roles[0]!, id: "peer-admin", name: "Peer Admin" }],
    });

    await waitFor(() => expect(screen.getByRole("textbox", { name: "roles.field.name" })).toBeDisabled());
    expect(screen.getByRole("textbox", { name: "roles.field.level" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "roles.delete" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
  });

  it("renders granular storage permission controls in the permissions page", () => {
    renderRolesSection();

    expect(screen.getByText("roles.category.storage")).toBeInTheDocument();
    expect(screen.getByText("admin.storage.structure")).toBeInTheDocument();
    expect(screen.getByText("admin.storage.items")).toBeInTheDocument();
    expect(screen.getByText("admin.storage.stock")).toBeInTheDocument();
  });

  it("renders site config permission control in the system permission group", () => {
    renderRolesSection();

    expect(screen.getByText("roles.category.adminSystem")).toBeInTheDocument();
    expect(screen.getByText("admin.siteConfig.manage")).toBeInTheDocument();
    expect(screen.getByText("admin.badges.manage")).toBeInTheDocument();
  });

  it("requires explicit confirmation before removing a permission from the actor's current role", async () => {
    const onUpdateRole = vi.fn().mockResolvedValue(true);
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
        permissions: expect.objectContaining({ "admin.roles.manage": false }),
      }),
    ));
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
