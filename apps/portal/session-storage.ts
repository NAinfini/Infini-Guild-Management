export const ANONYMOUS_VIEWER_ID = "anonymous";

export function viewerIdentity(userId: string | null | undefined): string {
  return userId ? `user:${userId}` : ANONYMOUS_VIEWER_ID;
}

export function userScopedStorageKey(baseKey: string, userId: string | null | undefined): string {
  return `${baseKey}:${encodeURIComponent(viewerIdentity(userId))}`;
}
