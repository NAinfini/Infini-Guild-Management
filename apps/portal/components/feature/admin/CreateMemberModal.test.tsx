import type { AdminRole } from "@guild/shared";
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
      display_name: "new_member",
      temporary_login_name: "new-login",
      temporary_password: "temporary-password",
    });

    render(
      <CreateMemberModal
        opened
        onClose={vi.fn()}
        onCreateMember={onCreateMember}
        creating={false}
        roles={roles}
      />,
    );

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /member\.create\.loginNameLabel/ }), "new_login");
    await user.type(within(dialog).getByRole("textbox", { name: /member\.create\.displayNameLabel/ }), "new_member");
    expect(within(dialog).getByRole("button", { name: "member.create.submit" })).toBeDisabled();

    await user.click(within(dialog).getByRole("combobox", { name: /member\.create\.roleLabel/ }));
    await user.click(await screen.findByRole("option", { name: "Raid Lead", hidden: true }));
    await user.click(within(dialog).getByRole("button", { name: "member.create.submit" }));

    await waitFor(() => expect(onCreateMember).toHaveBeenCalledWith({
      login_name: "new_login",
      display_name: "new_member",
      notes: "",
      roleId: "raid-lead",
    }));
    expect(await screen.findByRole("textbox", { name: "member.create.temporaryLoginName" })).toHaveValue("new-login");
    expect(screen.getByRole("textbox", { name: "member.create.temporaryPassword" })).toHaveValue("temporary-password");
  });
});
