import { describe, expect, it } from "vitest";
import { loginLockErrorDetailsSchema } from "./auth";

describe("login lock error details", () => {
  it("accepts only the strict snake_case duration contract", () => {
    const details = {
      retry_after_seconds: 30,
      locked_until: "2026-08-09T12:00:30.000Z",
    };
    expect(loginLockErrorDetailsSchema.parse(details)).toEqual(details);
    expect(loginLockErrorDetailsSchema.safeParse({ ...details, retryAfterSeconds: 30 }).success).toBe(false);
  });
});
