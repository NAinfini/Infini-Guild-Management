/*
 * Markers for the fixtures the admin API test console creates.
 *
 * A daily cron (apps/worker/crons/system-test-cleanup.ts) permanently deletes
 * rows carrying these markers, so they have to name a space no real member can
 * occupy: SYSTEM_TEST_USERNAME_PREFIX is rejected at registration
 * (AuthService.register), at admin-created accounts (AdminService.createMember),
 * and at username change (UserService.changeUsername). Without that
 * reservation the cron could delete a real account that merely happened to
 * pick the prefix.
 */
export const SYSTEM_TEST_USERNAME_PREFIX = "systemtest_";
export const SYSTEM_TEST_CONTENT_MARKER = "[systemtest]";

export const SYSTEM_TEST_HEADER = "X-System-Test";
export const SYSTEM_TEST_HEADER_VALUE = "admin-console-api";

/**
 * True when a username sits in the reserved system-test namespace.
 * Case-insensitive, because usernames are matched case-insensitively elsewhere.
 */
export function isReservedSystemTestUsername(username: string): boolean {
  return username.toLowerCase().startsWith(SYSTEM_TEST_USERNAME_PREFIX);
}
