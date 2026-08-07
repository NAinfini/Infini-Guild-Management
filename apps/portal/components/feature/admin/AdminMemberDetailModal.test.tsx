// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminMemberDetailModal } from "./AdminMemberDetailModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@portal/stores/auth", () => ({
  useAuthStore: (selector: (state: { user: { role_level: number } }) => unknown) =>
    selector({ user: { role_level: 999 } }),
}));

vi.mock("@portal/stores/class-catalog", () => ({
  useClassCatalogStore: () => [],
  buildClassOptions: () => [],
}));

vi.mock("../../shared/AbsenceManagerCard", () => ({
  AbsenceManagerCard: () => null,
}));

const member = {
  user: {
    id: "user-1",
    username: "Aster",
    role: "member-role",
    role_name: "Guild Member",
    role_color: null,
    role_level: 10,
    permissions: {},
    is_active: true,
  },
  profile: {
    power: 10,
    classes: [],
    title_html: null,
    bio: null,
    notes: null,
  },
  badges: [],
} as never;

const form = {
  power: 10,
  classes: [],
  titleHtml: "",
  bio: "",
  notes: "",
  role: "member-role",
  isActive: true,
};

const roles = [{
  id: "member-role",
  name: "Guild Member",
  level: 10,
  color: null,
  created_at: "2026-08-05T00:00:00.000Z",
  updated_at: "2026-08-05T00:00:00.000Z",
  permissions: {},
  assigned_user_count: 1,
}] as never;

describe("AdminMemberDetailModal permissions", () => {
  it("keeps edit, role, and activation controls independently gated", () => {
    render(
      <MantineProvider>
        <AdminMemberDetailModal
          open
          member={member}
          form={form}
          isDirty
          onClose={vi.fn()}
          onFormChange={vi.fn()}
          onSaveProfile={vi.fn()}
          saveProfilePending={false}
          mediaTab={null}
          roles={roles}
          canEditProfile={false}
          canAssignRole
          canActivate={false}
        />
      </MantineProvider>,
    );

    const [roleSelect] = screen.getAllByRole("combobox");
    expect(roleSelect).toHaveClass("mantine-Select-input");
    expect(roleSelect).toBeEnabled();
    expect(screen.getByLabelText("detail.field.power")).toBeDisabled();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("tab", { name: "detail.tab.media" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "detail.saveProfile" })).toBeEnabled();
  });
});
