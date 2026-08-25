// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearEmailVerificationToken,
  currentReturnTo,
  isSafeReturnTo,
  readEmailVerificationToken,
  stashEmailVerificationToken,
} from "./auth-navigation";

describe("authentication navigation safety", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    window.sessionStorage.clear();
  });

  it("accepts only same-origin paths without fragments", () => {
    expect(isSafeReturnTo("/profile?tab=account")).toBe(true);
    expect(isSafeReturnTo("//attacker.example/path")).toBe(false);
    expect(isSafeReturnTo("/\\attacker.example/path")).toBe(false);
    expect(isSafeReturnTo("https://attacker.example/path")).toBe(false);
    expect(isSafeReturnTo("/verify-email#token=secret")).toBe(false);
  });

  it("never includes a fragment in the current return path", () => {
    window.history.replaceState({}, "", "/verify-email?source=message#token=secret");

    expect(currentReturnTo()).toBe("/verify-email?source=message");
  });

  it("moves an email token out of history and keeps it through a login redirect", () => {
    window.history.replaceState({}, "", "/verify-email#token=secret-token");

    expect(readEmailVerificationToken()).toBe("secret-token");
    expect(window.location.href).not.toContain("secret-token");
    window.history.replaceState({}, "", "/login?returnTo=%2Fverify-email");
    expect(readEmailVerificationToken()).toBe("secret-token");

    clearEmailVerificationToken();
    expect(readEmailVerificationToken()).toBe("");
  });

  it("removes a stashed token before an unauthenticated redirect", () => {
    window.history.replaceState({}, "", "/verify-email#token=redirect-token");

    stashEmailVerificationToken(window.location.hash);

    expect(window.location.href).not.toContain("redirect-token");
    window.history.replaceState({}, "", "/login?returnTo=%2Fverify-email");
    expect(readEmailVerificationToken()).toBe("redirect-token");
  });
});
