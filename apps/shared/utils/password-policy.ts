import { LIMITS } from "../config/limits";

export const PASSWORD_RULES = ["length", "uppercase", "lowercase", "special"] as const;
export type PasswordRule = typeof PASSWORD_RULES[number];

export function passwordRuleChecks(password: string): Readonly<Record<PasswordRule, boolean>> {
  return {
    length: password.length >= LIMITS.content.password.min && password.length <= LIMITS.content.password.max,
    uppercase: /\p{Lu}/u.test(password),
    lowercase: /\p{Ll}/u.test(password),
    special: /[\p{P}\p{S}]/u.test(password),
  };
}

export const PASSWORD_RULE_MESSAGES: Readonly<Record<PasswordRule, string>> = {
  length: `Password must be between ${LIMITS.content.password.min} and ${LIMITS.content.password.max} characters`,
  uppercase: "Password must contain an uppercase letter",
  lowercase: "Password must contain a lowercase letter",
  special: "Password must contain a special character (not a space)",
};
