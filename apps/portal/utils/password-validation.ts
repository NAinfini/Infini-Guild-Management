import { PASSWORD_RULES, passwordRuleChecks, type PasswordRule } from "@guild/shared/utils/password-policy";

export function newPasswordValidationKey(password: string): `auth:validation.password.${PasswordRule}` | null {
  const checks = passwordRuleChecks(password);
  const unmet = PASSWORD_RULES.find((rule) => !checks[rule]);
  return unmet ? `auth:validation.password.${unmet}` : null;
}
