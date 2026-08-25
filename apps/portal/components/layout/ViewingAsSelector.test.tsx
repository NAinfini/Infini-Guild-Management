import type { AdminRole } from "@guild/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewingAsSelector } from "./ViewingAsSelector";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "viewingAs.label": "Viewing As",
      "common:viewingAs.external": "External visitor",
    })[key] ?? key,
  }),
}));

vi.mock("../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: { role_level: number } }) => unknown) =>
    selector({ user: { role_level: 100 } }),
}));

const roles: AdminRole[] = [
  {
    id: "admin",
    name: "Administrator",
    level: 100,
    color: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    permissions: {} as AdminRole["permissions"],
    assigned_user_count: 1,
  },
  {
    id: "member",
    name: "Member",
    level: 1,
    color: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    permissions: {} as AdminRole["permissions"],
    assigned_user_count: 9,
  },
];

describe("ViewingAsSelector", () => {
  it("uses an accessible Base UI select and returns the selected visible role", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<ViewingAsSelector value="admin" roles={roles} onChange={onChange} />);

    const trigger = screen.getByLabelText("Viewing As");
    expect(trigger).toHaveTextContent("Administrator");

    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Member" }));

    expect(onChange).toHaveBeenCalledWith("member");
  });
});
