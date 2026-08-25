const EMAIL_VERIFICATION_TOKEN_KEY = "portal:email-verification-token";

export function isSafeReturnTo(value: string | undefined): value is string {
  return typeof value === "string"
    && value.startsWith("/")
    && !value.startsWith("//")
    && !value.startsWith("/\\")
    && !value.includes("#");
}

export function currentReturnTo(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function stashEmailVerificationToken(hash: string): void {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  if (!token) return;
  try {
    window.sessionStorage.setItem(EMAIL_VERIFICATION_TOKEN_KEY, token);
  } catch {
    // A disabled storage area means the user must reopen the email link after login.
  }
  if (window.location.hash === hash) {
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    } catch {
      // Navigation still omits the fragment; history cleanup is best effort in restricted browser contexts.
    }
  }
}

export function readEmailVerificationToken(): string {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
  if (token) {
    stashEmailVerificationToken(window.location.hash);
    return token;
  }
  try {
    return window.sessionStorage.getItem(EMAIL_VERIFICATION_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function clearEmailVerificationToken(): void {
  try {
    window.sessionStorage.removeItem(EMAIL_VERIFICATION_TOKEN_KEY);
  } catch {
    // The token has already been consumed server-side; storage cleanup is best effort.
  }
}
