import type { LoginFailureRecord, LoginLockState } from "./auth-types";

export function projectLoginLock(failure: LoginFailureRecord | null, now: string): LoginLockState {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new TypeError("Login-lock time must be a valid timestamp");

  const lockedUntilMs = failure?.lockedUntil ? Date.parse(failure.lockedUntil) : Number.NaN;
  const isLocked = Number.isFinite(lockedUntilMs) && lockedUntilMs > nowMs;
  return {
    failCount: failure?.failCount ?? 0,
    lockedUntil: failure?.lockedUntil ?? null,
    isLocked,
    retryAfterSeconds: isLocked ? Math.ceil((lockedUntilMs - nowMs) / 1_000) : 0,
  };
}
