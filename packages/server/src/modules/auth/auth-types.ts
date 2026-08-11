import type { MemberProfile, Permission } from "@guild/shared";
import type { AuditMutation } from "../audit/public.js";

export type AuthUserRecord = Readonly<{
  id: string;
  username: string;
  roleId: string;
  roleName: string;
  roleColor: string | null;
  roleLevel: number;
  permissions: ReadonlySet<Permission>;
  isActive: boolean;
  deletedAt: string | null;
  revisionToken: string;
  createdAt: string;
  updatedAt: string;
}>;

export type LoginAccountRecord = AuthUserRecord & Readonly<{ passwordHash: string }>;

export type SessionAuthorizationRecord = AuthUserRecord & Readonly<{
  tokenDigest: string;
  expiresAt: string;
  sessionCreatedAt: string;
}>;

export type RoleRecord = Readonly<{
  id: string;
  name: string;
  level: number;
  color: string | null;
  permissions: ReadonlySet<Permission>;
  assignedUserCount: number;
  revisionToken: string;
  createdAt: string;
  updatedAt: string;
}>;

export type InviteRecord = Readonly<{
  id: string;
  createdBy: string;
  roleId: string;
  roleName: string;
  roleColor: string | null;
  roleLevel: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}>;

export type ManagedUserTarget = Readonly<{
  id: string;
  username: string;
  roleId: string;
  roleLevel: number;
  rolePermissions: ReadonlySet<Permission>;
  revisionToken: string;
  roleRevisionToken: string;
  isActive: boolean;
  deletedAt: string | null;
}>;

export type LoginFailureRecord = Readonly<{
  failCount: number;
  lockedUntil: string | null;
}>;

export type LoginLockState = Readonly<{
  failCount: number;
  lockedUntil: string | null;
  isLocked: boolean;
  retryAfterSeconds: number;
}>;

export type InviteVisibility = "active" | "expired" | "revoked";

export type InviteCursor = Readonly<{ createdAt: string; id: string }>;

export type InvitePage = Readonly<{
  data: readonly InviteRecord[];
  nextCursor: InviteCursor | null;
  total: number;
}>;

export type InviteStats = Readonly<{ total: number; active: number; revoked: number; expired: number }>;

export type RolePermissionDelta = Readonly<{
  add: readonly Permission[];
  remove: readonly Permission[];
}>;

export type GuardedAuthMutationResult = "updated" | "conflict" | "last_owner";

export type AuthSessionResult = Readonly<{
  user: AuthUserRecord;
  profile: MemberProfile;
  session: Readonly<{ rawToken: string; tokenDigest: string; expiresAt: string; stayLoggedIn: boolean }>;
}>;

export type ResolvedSession = Readonly<{
  record: SessionAuthorizationRecord;
  renewedExpiresAt: string | null;
}>;

export interface AuthProfileReader {
  readOwnProfile(userId: string): Promise<MemberProfile | null>;
}

export interface AccountProvisioningStore {
  redeemInviteAndCreateMember(input: Readonly<{
    inviteId: string;
    tokenDigest: string;
    userId: string;
    username: string;
    passwordHash: string;
    now: string;
  }>, audit: AuditMutation): Promise<"created" | "invite_unavailable" | "username_taken">;
  createManagedUser(input: Readonly<{
    id: string;
    username: string;
    roleId: string;
    passwordHash: string;
    destinationRole: RoleRecord;
    now: string;
  }>, audit: AuditMutation): Promise<"created" | "username_taken" | "conflict">;
}

export interface AuthStore {
  findLoginAccount(normalizedUsername: string): Promise<LoginAccountRecord | null>;
  findCredential(userId: string): Promise<string | null>;
  usernameExists(normalizedUsername: string): Promise<boolean>;
  findUser(userId: string): Promise<AuthUserRecord | null>;
  findSessionAuthorization(tokenDigest: string): Promise<SessionAuthorizationRecord | null>;
  readLoginFailure(normalizedUsername: string): Promise<LoginFailureRecord | null>;
  recordLoginFailure(input: Readonly<{
    normalizedUsername: string;
    now: string;
    freeAttempts: number;
    lockSeconds: readonly number[];
  }>): Promise<LoginFailureRecord>;
  clearLoginFailures(normalizedUsername: string): Promise<void>;
  pruneLoginFailures(before: string, now: string, limit: number): Promise<void>;
  rehashPassword(userId: string, passwordHash: string, now: string): Promise<void>;
  createSessionBounded(input: Readonly<{
    userId: string;
    tokenDigest: string;
    expiresAt: string;
    createdAt: string;
    maximumSessions: number;
  }>): Promise<void>;
  renewSession(tokenDigest: string, expiresAt: string): Promise<void>;
  deleteSession(tokenDigest: string): Promise<void>;
  deleteSessionsForUsers(userIds: readonly string[]): Promise<void>;
  findActiveInvite(id: string, tokenDigest: string, now: string): Promise<InviteRecord | null>;
  changeOwnPassword(userId: string, passwordHash: string, now: string, audit: AuditMutation): Promise<void>;
  changeOwnUsername(userId: string, username: string, now: string, audit: AuditMutation): Promise<"updated" | "username_taken">;

  listInvites(input: Readonly<{
    visibility: InviteVisibility;
    limit: number;
    cursor: InviteCursor | null;
    search: string;
    exactId?: string;
    now: string;
  }>): Promise<InvitePage>;
  getInviteStats(now: string): Promise<InviteStats>;
  createInvite(input: Readonly<{
    id: string;
    tokenDigest: string;
    createdBy: string;
    roleId: string;
    maxUses: number;
    expiresAt: string | null;
    now: string;
  }>, audit: AuditMutation): Promise<InviteRecord>;
  revokeInvite(id: string, now: string, audit: AuditMutation): Promise<boolean>;
  deleteInvite(id: string, audit: AuditMutation): Promise<boolean>;

  findManagedUsers(userIds: readonly string[]): Promise<readonly ManagedUserTarget[]>;
  countActiveOwners(): Promise<number>;
  countActiveOwnersAmong(userIds: readonly string[]): Promise<number>;
  setUsersRole(input: Readonly<{
    targets: readonly ManagedUserTarget[];
    destinationRole: RoleRecord;
    now: string;
  }>, audit: AuditMutation): Promise<GuardedAuthMutationResult>;
  setUsersActive(input: Readonly<{
    targets: readonly ManagedUserTarget[];
    active: boolean;
    now: string;
  }>, audit: AuditMutation): Promise<GuardedAuthMutationResult>;
  softDeleteUsers(input: Readonly<{
    targets: readonly ManagedUserTarget[];
    now: string;
  }>, audit: AuditMutation): Promise<GuardedAuthMutationResult>;
  resetUserPassword(
    target: ManagedUserTarget,
    passwordHash: string,
    now: string,
    audit: AuditMutation,
  ): Promise<"updated" | "conflict">;
  resetUserLoginLock(target: ManagedUserTarget, audit: AuditMutation): Promise<
    | Readonly<{ outcome: "updated"; previous: LoginFailureRecord | null }>
    | Readonly<{ outcome: "conflict" }>
  >;

  listRoles(): Promise<readonly RoleRecord[]>;
  findRole(roleId: string): Promise<RoleRecord | null>;
  createRole(input: Readonly<{
    id: string;
    name: string;
    level: number;
    color: string | null;
    permissions: readonly Permission[];
    now: string;
  }>, audit: AuditMutation): Promise<"created" | "conflict">;
  updateRole(input: Readonly<{
    id: string;
    name?: string;
    level?: number;
    color?: string | null;
    permissionDelta: RolePermissionDelta;
    expectedRevisionToken: string;
    expectedPermissions: readonly Permission[];
    now: string;
  }>, audit: AuditMutation): Promise<GuardedAuthMutationResult>;
  deleteRole(role: RoleRecord, audit: AuditMutation): Promise<"deleted" | "referenced" | "not_found" | "conflict" | "last_owner">;
}
