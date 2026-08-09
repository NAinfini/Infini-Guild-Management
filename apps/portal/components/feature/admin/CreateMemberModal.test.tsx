// @vitest-environment jsdom
import type { AdminRole } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreateMemberModal } from "./CreateMemberModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

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

describe("CreateMemberModal", () => {
  it("requires an explicit assignable role and sends its D1 id", async () => {
    const user = userEvent.setup();
    const onCreateMember = vi.fn().mockResolvedValue({
      user_id: "user-1",
      username: "new_member",
      temporary_password: "temporary-password",
    });

    render(
      <MantineProvider>
        <CreateMemberModal
          opened
          onClose={vi.fn()}
          onCreateMember={onCreateMember}
          creating={false}
          roles={roles}
        />
      </MantineProvider>,
    );

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /member\.create\.usernameLabel/ }), "new_member");
    expect(within(dialog).getByRole("button", { name: "member.create.submit" })).toBeDisabled();

    await user.click(within(dialog).getByRole("combobox", { name: /member\.create\.roleLabel/ }));
    await user.click(await screen.findByRole("option", { name: "Raid Lead", hidden: true }));
    await user.click(within(dialog).getByRole("button", { name: "member.create.submit" }));

    await waitFor(() => expect(onCreateMember).toHaveBeenCalledWith({
      username: "new_member",
      notes: "",
      roleId: "raid-lead",
    }));
  });
});
