// @vitest-environment jsdom
import type { AdminRole, Permission, User } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
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

function renderRolesSection() {
  render(
    <MantineProvider>
      <AdminRolesSection
        rolesLoading={false}
        rolesError={false}
        roles={roles}
        createRolePending={false}
        updateRolePending={false}
        deleteRolePending={false}
        onCreateRole={vi.fn()}
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
});
