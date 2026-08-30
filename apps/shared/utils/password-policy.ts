import { LIMITS } from "../config/limits";

export const PASSWORD_RULES = ["length", "uppercase", "lowercase", "special", "uncommon"] as const;
export type PasswordRule = typeof PASSWORD_RULES[number];

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "password1!", "12345678", "123456789", "1234567890",
  "123456789012", "administrator", "letmeinplease", "password1234", "qwertyuiop12",
]);

export function passwordRuleChecks(password: string): Readonly<Record<PasswordRule, boolean>> {
  return {
    length: password.length >= LIMITS.content.password.min && password.length <= LIMITS.content.password.max,
    uppercase: /\p{Lu}/u.test(password),
    lowercase: /\p{Ll}/u.test(password),
    special: /[\p{P}\p{S}]/u.test(password),
    uncommon: !COMMON_PASSWORDS.has(password.toLocaleLowerCase("en-US")),
  };
}

export const PASSWORD_RULE_MESSAGES: Readonly<Record<PasswordRule, string>> = {
  length: `Password must be between ${LIMITS.content.password.min} and ${LIMITS.content.password.max} characters`,
  uppercase: "Password must contain an uppercase letter",
  lowercase: "Password must contain a lowercase letter",
  special: "Password must contain a special character (not a space)",
  uncommon: "Password is too common",
};
