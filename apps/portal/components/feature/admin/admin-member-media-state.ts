import type { UsersListResponse } from "../../../services/UserService";

export type AdminUserRow = UsersListResponse["data"][number];

export type VideoBaseline = Readonly<{
  memberId: string | null;
  urls: readonly string[];
}>;

export type MemberMediaSnapshot = Readonly<{
  member: AdminUserRow | null;
  profileRevisionToken: string | null;
}>;

export type ProfileRevisionBaseline = Readonly<{
  memberId: string | null;
  profileRevisionToken: string | null;
  supersededProfileRevisionTokens: readonly string[];
  deferredSnapshot: MemberMediaSnapshot | null;
}>;

export type MediaUploadOwner = Readonly<{
  memberId: string;
  profileRevisionToken: string;
}>;

export type MemberMutationTarget = MediaUploadOwner;

export function requireMember(member: AdminUserRow | null): AdminUserRow {
  if (!member) throw new Error("Missing member");
  return member;
}

export function videoBaselineFor(member: AdminUserRow | null): VideoBaseline {
  return {
    memberId: member?.user.id ?? null,
    urls: [...(member?.profile.video_urls ?? [])],
  };
}

export function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
