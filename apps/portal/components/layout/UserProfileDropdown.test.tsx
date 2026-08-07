// @vitest-environment jsdom
import type { User } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
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
  username: "Nielsen",
  role: "admin",
  role_name: "Guild Administrator",
  role_color: "#ef4444",
  role_level: 999,
  permissions: {} as User["permissions"],
  is_active: true,
  deleted_at: null,
  created_at: "2026-07-29T00:00:00.000Z",
  updated_at: "2026-07-29T00:00:00.000Z",
};

describe("UserProfileDropdown", () => {
  it("includes the visible username in the trigger accessible name", () => {
    render(
      <MantineProvider>
        <UserProfileDropdown user={user} onLogout={vi.fn()} compact />
      </MantineProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Nielsen: Open profile menu" }),
    ).toBeInTheDocument();
  });

  it("shows the embedded D1 role name in the expanded trigger", () => {
    render(
      <MantineProvider>
        <UserProfileDropdown user={user} onLogout={vi.fn()} />
      </MantineProvider>,
    );

    expect(screen.getByText("Guild Administrator")).toBeInTheDocument();
    expect(screen.queryByText("admin")).not.toBeInTheDocument();
  });
});
