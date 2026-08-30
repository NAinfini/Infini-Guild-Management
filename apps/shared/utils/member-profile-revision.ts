const MEMBER_PROFILE_ETAG_PREFIX = "member-profile-";

export function memberProfileMediaRevisionToken(auditEventId: string): string {
  return `profile-${auditEventId}`;
}

export function memberProfileRevisionEtag(revisionToken: string): string {
  return `"${MEMBER_PROFILE_ETAG_PREFIX}${revisionToken.replaceAll("\"", "")}"`;
}
