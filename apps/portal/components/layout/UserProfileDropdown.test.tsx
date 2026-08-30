import type { User } from "@guild/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UserProfileDropdown } from "./UserProfileDropdown";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "profile.menu.aria.open": "Open profile menu",
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock("../../stores/auth", () => ({
  useAuthStore: (selector: (state: { profile: null }) => unknown) => selector({ profile: null }),
}));

const user: User = {
  id: "user-1",
  display_name: "Nielsen",
  role: "admin",
  role_name: "Guild Administrator",
  role_color: "#ef4444",
  role_level: 999,
  permissions: {} as User["permissions"],
  is_active: true,
  deleted_at: null,
  created_at: "2026-07-29T00:00:00.000Z",
  updated_at: "2026-07-29T00:00:00.000Z",
  last_login_at: null,
};

describe("UserProfileDropdown", () => {
  it("includes the visible display_name in the trigger accessible name", () => {
    render(
      <UserProfileDropdown user={user} onLogout={vi.fn()} compact />,
    );

    expect(
      screen.getByRole("button", { name: "Nielsen: Open profile menu" }),
    ).toBeInTheDocument();
  });

  it("shows the embedded D1 role name in the expanded trigger", () => {
    render(
      <UserProfileDropdown user={user} onLogout={vi.fn()} />,
    );

    expect(screen.getByText("Guild Administrator")).toBeInTheDocument();
    expect(screen.queryByText("admin")).not.toBeInTheDocument();
  });

  it("opens the profile actions and calls logout", async () => {
    const onLogout = vi.fn();
    const userEventInstance = userEvent.setup();

    render(<UserProfileDropdown user={user} onLogout={onLogout} />);

    await userEventInstance.click(
      screen.getByRole("button", { name: "Nielsen: Open profile menu" }),
    );

    expect(await screen.findByRole("menuitem", { name: "profile.menu.profile" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "profile.menu.settings" })).toBeInTheDocument();

    await userEventInstance.click(screen.getByRole("menuitem", { name: "action.logout" }));

    expect(onLogout).toHaveBeenCalledOnce();
  });
});
