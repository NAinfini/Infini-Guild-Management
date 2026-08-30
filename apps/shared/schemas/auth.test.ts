import { describe, expect, it } from "vitest";
import { changePasswordSchema, completePasswordResetSchema, loginSchema, registerSchema } from "./auth";

const newPasswordInputs = [
  (password: string, confirmation = password) => registerSchema.safeParse({
    login_name: "member", display_name: "Member", password, confirmPassword: confirmation,
  }),
  (password: string, confirmation = password) => changePasswordSchema.safeParse({
    currentPassword: "existing", newPassword: password, confirmNewPassword: confirmation,
  }),
  (password: string, confirmation = password) => completePasswordResetSchema.safeParse({
    login_name: "member", new_password: password, confirm_new_password: confirmation,
  }),
];

describe("new password contracts", () => {
  it.each(newPasswordInputs)("uses the same 8–128-character policy for every new-password flow (%#)", (parse) => {
    for (const password of ["Violet7!", "Violets!", "Phrase with spaces!", "春夏秋冬Aa!云", "Aa!" + "a".repeat(125)]) {
      expect(parse(password).success).toBe(true);
    }
    for (const password of ["Short!1", "Aa!" + "a".repeat(126), "violet7!", "VIOLET7!", "Violet77", "Violet7 ", "Password1!"]) {
      expect(parse(password).success).toBe(false);
    }
    expect(parse("Violet7!", "different").success).toBe(false);
  });

  it("does not impose new-password rules on existing login credentials", () => {
    expect(loginSchema.safeParse({ login_name: "member", password: "old" }).success).toBe(true);
  });
});
