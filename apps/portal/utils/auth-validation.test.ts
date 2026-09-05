import { LIMITS } from "@guild/shared/config/limits";
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import en from "../i18n/en/auth.json";
import zh from "../i18n/zh/auth.json";
import { authValidationFieldErrors } from "./auth-validation";

const validRegistration = {
  login_name: "Guild_成员", display_name: "成员_1", password: "Violets!", confirmPassword: "Violets!",
};

describe.each(["en", "zh"] as const)("auth validation in %s", (language) => {
  async function translator() {
    const i18n = createInstance();
    await i18n.init({
      lng: language, resources: { en: { auth: en }, zh: { auth: zh } },
      defaultNS: "auth", keySeparator: false, interpolation: { escapeValue: false },
    });
    return i18n.getFixedT(language, "auth");
  }

  it("distinguishes blank, overlong, and malformed names without Zod text", async () => {
    const t = await translator();
    for (const field of ["login_name", "display_name"] as const) {
      const label = t(field === "login_name" ? "field.loginName" : "field.displayName");
      for (const name of ["", "   ", "\t"]) {
        const errors = authValidationFieldErrors("register", { ...validRegistration, [field]: name }, t);
        expect(errors[field]).toBe(language === "zh"
          ? `请输入${label}`
          : `Enter your ${label.toLowerCase()}`);
      }
      const tooLong = authValidationFieldErrors("register", {
        ...validRegistration, [field]: "a".repeat(LIMITS.content.identityName.max + 1),
      }, t);
      expect(tooLong[field]).toContain("50");
      expect(tooLong[field]).toBe(t("validation.nameTooLong", { field: label, max: 50 }));
      for (const name of ["two words", "with-hyphen", "emoji😊"]) {
        const errors = authValidationFieldErrors("register", { ...validRegistration, [field]: name }, t);
        expect(errors[field]).toBe(t("validation.nameFormat", { field: label }));
        expect(errors[field]).not.toMatch(/Too small|Too big|Invalid string|expected string/);
      }
    }
    expect(authValidationFieldErrors("register", validRegistration, t)).toEqual({});
  });

  it("preserves separate login and new-password rules and localizes reset fields", async () => {
    const t = await translator();
    expect(authValidationFieldErrors("login", { login_name: "成员", password: "x" }, t)).toEqual({});
    expect(authValidationFieldErrors("login", {
      login_name: "成员", password: "x".repeat(LIMITS.content.password.max + 1),
    }, t).password).toBe(t("validation.passwordTooLong", { max: 128 }));
    const resetErrors = authValidationFieldErrors("reset", {
      login_name: "", new_password: "violets!", confirm_new_password: "Different!",
    }, t);
    expect(resetErrors).toEqual({
      login_name: t("validation.loginNameRequired"),
      new_password: t("validation.password.uppercase"),
      confirm_new_password: t("validation.passwordMismatch"),
    });
    expect(authValidationFieldErrors("register", {
      ...validRegistration, password: "A!", confirmPassword: "A!",
    }, t).password).toBe(t("validation.password.length", { min: 8, max: 128 }));
  });

  it("uses only server field names and never exposes their raw messages", async () => {
    const t = await translator();
    const errors = authValidationFieldErrors("register", validRegistration, t, {
      formErrors: ["Internal English validation details"],
      fieldErrors: {
        login_name: ["Too small: expected string to have >=1 characters"],
        display_name: "Raw reserved name details",
        password: [],
        unknown_field: ["Unknown field details"],
      },
    });
    expect(errors).toEqual({
      login_name: t("validation.fieldInvalid", { field: t("field.loginName") }),
      display_name: t("validation.fieldInvalid", { field: t("field.displayName") }),
    });
    expect(JSON.stringify(errors)).not.toMatch(/Too small|expected string|Raw reserved|Internal English|Unknown field/);
    expect(authValidationFieldErrors("register", validRegistration, t, { fieldErrors: null })).toEqual({});
  });
});
