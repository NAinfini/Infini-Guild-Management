// @vitest-environment jsdom
import type { AdminRole, Permission, User } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminRolesSection } from "./AdminRolesSection";

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
        permissions: { "admin.roles.manage": true } as Record<Permission, boolean>,
        is_active: true,
        deleted_at: null,
        created_at: "2026-06-11T00:00:00.000Z",
        updated_at: "2026-06-11T00:00:00.000Z",
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
  is_builtin: true,
  created_at: "2026-06-11T00:00:00.000Z",
  updated_at: "2026-06-11T00:00:00.000Z",
  assigned_user_count: 1,
  permissions,
}];

function renderRolesSection(onCreateRole = vi.fn()) {
  render(
    <MantineProvider>
      <AdminRolesSection
        rolesLoading={false}
        rolesError={false}
        roles={roles}
        createRolePending={false}
        updateRolePending={false}
        deleteRolePending={false}
        onCreateRole={onCreateRole}
        onUpdateRole={vi.fn()}
        onDeleteRole={vi.fn()}
      />
    </MantineProvider>,
  );
}

describe("AdminRolesSection storage permissions", () => {
  it("renders granular storage permission controls in the permissions page", () => {
    renderRolesSection();

    expect(screen.getByText("roles.category.storage")).toBeInTheDocument();
    expect(screen.getByText("admin.storage.structure")).toBeInTheDocument();
    expect(screen.getByText("admin.storage.items")).toBeInTheDocument();
    expect(screen.getByText("admin.storage.stock")).toBeInTheDocument();
    expect(screen.queryByText("admin.storage.manage")).not.toBeInTheDocument();
  });

  it("renders site config permission control in the system permission group", () => {
    renderRolesSection();

    expect(screen.getByText("roles.category.adminSystem")).toBeInTheDocument();
    expect(screen.getByText("admin.siteConfig.manage")).toBeInTheDocument();
  });

  it("opens a focused, cancellable form and creates only after a valid name is submitted", async () => {
    const onCreateRole = vi.fn().mockResolvedValue(true);
    renderRolesSection(onCreateRole);

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
});
