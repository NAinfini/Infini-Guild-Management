/*
 * Markers for the fixtures the admin API test console creates.
 *
 * These are readable fixture labels only. Cleanup uses the server-side run
 * registry and exact IDs/keys exclusively; it never searches by these strings.
 * The username prefix is reserved on every account-write path so automated
 * fixture names remain recognizable. It is never used as a cleanup selector.
 */
export const SYSTEM_TEST_USERNAME_PREFIX = "systemtest_";
export const SYSTEM_TEST_CONTENT_MARKER = "[systemtest]";

export const SYSTEM_TEST_HEADER = "X-System-Test";
export const SYSTEM_TEST_HEADER_VALUE = "admin-console-api";
/** Server-issued opaque identifier for one isolated admin API test run. */
export const SYSTEM_TEST_RUN_ID_HEADER = "X-System-Test-Run-Id";

/**
 * True when a username sits in the reserved system-test namespace.
 * Case-insensitive, because usernames are matched case-insensitively elsewhere.
 */
export function isReservedSystemTestUsername(username: string): boolean {
  return username.toLowerCase().startsWith(SYSTEM_TEST_USERNAME_PREFIX);
}
