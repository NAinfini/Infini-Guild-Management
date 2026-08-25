import { AppError } from "@guild/kernel";
import { LIMITS } from "@guild/shared/config/limits";

export function assertPasswordPolicy(password: string): void {
  if (password.length < LIMITS.content.password.min || password.length > LIMITS.content.password.max) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: `Password must be between ${LIMITS.content.password.min} and ${LIMITS.content.password.max} characters`,
    });
  }
}
