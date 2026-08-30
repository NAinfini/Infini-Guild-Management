import { AppError } from "@guild/kernel";
import { newPasswordSchema } from "@guild/shared/schemas/auth";

export function assertPasswordPolicy(password: string): void {
  const parsed = newPasswordSchema.safeParse(password);
  if (parsed.success) return;
  throw new AppError({
    code: "VALIDATION_ERROR",
    status: 400,
    message: parsed.error.issues[0]!.message,
  });
}
