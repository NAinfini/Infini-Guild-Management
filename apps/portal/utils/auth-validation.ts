import { completePasswordResetSchema, loginSchema, registerSchema } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import type { TFunction } from "i18next";
import { newPasswordValidationKey } from "./password-validation";

const AUTH_SCHEMAS = {
  login: loginSchema,
  register: registerSchema,
  reset: completePasswordResetSchema,
};

const FIELD_LABELS: Record<string, string> = {
  login_name: "field.loginName",
  display_name: "field.displayName",
  password: "field.password",
  new_password: "field.password",
  confirmPassword: "field.confirmPassword",
  confirm_new_password: "field.confirmPassword",
};

/** Shared schemas own validation; raw server and Zod messages never become UI copy. */
export function authValidationFieldErrors(
  mode: keyof typeof AUTH_SCHEMAS,
  values: Record<string, unknown>,
  t: TFunction<"auth">,
  details?: unknown,
): Record<string, string> {
  const schema = AUTH_SCHEMAS[mode];
  const parsed = schema.safeParse(values);
  const issues = parsed.success ? [] : parsed.error.issues;
  const serverErrors = details && typeof details === "object" && "fieldErrors" in details
    && details.fieldErrors && typeof details.fieldErrors === "object"
    ? details.fieldErrors as Record<string, unknown>
    : {};
  const errors: Record<string, string> = {};

  for (const field of Object.keys(schema.shape)) {
    const labelKey = FIELD_LABELS[field];
    if (!labelKey) continue;
    const issue = issues.find((item) => item.path[0] === field);
    const serverError = serverErrors[field];
    const hasServerError = typeof serverError === "string"
      ? serverError.trim().length > 0
      : Array.isArray(serverError) && serverError.length > 0;
    if (!issue && !hasServerError) continue;

    const value = typeof values[field] === "string" ? values[field] : "";
    const label = t(labelKey);
    let message = t("validation.fieldInvalid", { field: label });
    if (field === "login_name" || field === "display_name") {
      if (value.trim().length === 0) {
        message = t(field === "login_name" ? "validation.loginNameRequired" : "validation.displayNameRequired");
      } else if (issue?.code === "too_big") {
        message = t("validation.nameTooLong", { field: label, max: LIMITS.content.identityName.max });
      } else if (issue?.code === "invalid_format") {
        message = t("validation.nameFormat", { field: label });
      }
    } else if (field === "password" || field === "new_password") {
      if (mode === "login") {
        if (value.length === 0) message = t("validation.passwordRequired");
        else if (issue?.code === "too_big") {
          message = t("validation.passwordTooLong", { max: LIMITS.content.password.max });
        }
      } else {
        const key = newPasswordValidationKey(value);
        if (key) message = t(key, LIMITS.content.password);
      }
    } else if (issue) {
      message = t("validation.passwordMismatch");
    }
    errors[field] = message;
  }
  return errors;
}
