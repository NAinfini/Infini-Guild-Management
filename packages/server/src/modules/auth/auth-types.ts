import type { MemberProfile, Permission } from "@guild/shared";
import type { AuditEventWrite } from "../audit/public.js";

export type AuthUserRecord = Readonly<{
  id: string;
  displayName: string;
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
  /** 最近一次成功登录；从未登录过为 null。 */
  lastLoginAt: string | null;
}>;

export type LoginAccountRecord = AuthUserRecord & Readonly<{
  loginName: string;
  passwordHash: string;
  authRevision: number;
  temporaryPasswordExpiresAt: string | null;
  temporaryPasswordUsedAt: string | null;
}>;

export type CredentialRecord = Readonly<{
  loginName: string;
  passwordHash: string;
  authRevision: number;
}>;

export type SessionAuthorizationRecord = AuthUserRecord & Readonly<{
  tokenDigest: string;
  expiresAt: string;
  sessionCreatedAt: string;
  sessionScope: "normal" | "password_change";
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
  displayName: string;
  loginName: string;
  authRevision: number;
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

export type GuardedAuthMutationResult = "updated" | "conflict" | "last_role_manager";

export type AuthSessionResult = Readonly<{
  user: AuthUserRecord;
  profile: MemberProfile;
  session: Readonly<{
    rawToken: string;
    tokenDigest: string;
    expiresAt: string;
    stayLoggedIn: boolean;
    scope: "normal" | "password_change";
  }>;
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
    loginName: string;
    displayName: string;
    passwordHash: string;
    now: string;
  }>, audit: AuditEventWrite): Promise<"created" | "invite_unavailable" | "login_name_taken" | "display_name_taken">;
  createManagedUser(input: Readonly<{
    id: string;
    loginName: string;
    displayName: string;
    roleId: string;
    passwordHash: string;
    temporaryPasswordExpiresAt: string;
    destinationRole: RoleRecord;
    now: string;
  }>, audit: AuditEventWrite): Promise<"created" | "login_name_taken" | "display_name_taken" | "conflict">;
}

export interface AuthStore {
  findLoginAccount(normalizedLoginName: string): Promise<LoginAccountRecord | null>;
  findCredentialRecord(userId: string): Promise<CredentialRecord | null>;
  findLoginName(userId: string): Promise<string | null>;
  findUser(userId: string): Promise<AuthUserRecord | null>;
  findSessionAuthorization(tokenDigest: string): Promise<SessionAuthorizationRecord | null>;
  readLoginFailure(normalizedLoginName: string): Promise<LoginFailureRecord | null>;
  recordLoginFailure(input: Readonly<{
    normalizedLoginName: string;
    now: string;
    freeAttempts: number;
    lockSeconds: readonly number[];
  }>): Promise<LoginFailureRecord>;
  clearLoginFailures(normalizedLoginName: string): Promise<void>;
  pruneLoginFailures(before: string, now: string, limit: number): Promise<void>;
  rehashPassword(input: Readonly<{
    userId: string;
    expectedPasswordHash: string;
    expectedAuthRevision: number;
    passwordHash: string;
    now: string;
  }>): Promise<boolean>;
  openUserSession(input: Readonly<{
    userId: string;
    tokenDigest: string;
    expiresAt: string;
    createdAt: string;
    maximumSessions: number;
    scope?: "normal" | "password_change";
    expectedAuthRevision: number;
  }>): Promise<boolean>;
  renewSession(tokenDigest: string, expiresAt: string): Promise<void>;
  recordLastLogin(userId: string, at: string): Promise<void>;
  deleteSession(tokenDigest: string): Promise<void>;
  deleteSessionsForUsers(userIds: readonly string[]): Promise<void>;
  findActiveInvite(tokenDigest: string, now: string): Promise<InviteRecord | null>;
  changeOwnPassword(input: Readonly<{
    userId: string;
    expectedAuthRevision: number;
    passwordHash: string;
    now: string;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
  changeOwnLoginName(input: Readonly<{
    userId: string;
    expectedAuthRevision: number;
    previousLoginName: string;
    loginName: string;
    now: string;
    audit: AuditEventWrite;
  }>): Promise<"updated" | "login_name_taken" | "invalid">;
  setTemporaryPassword(input: Readonly<{
    target: ManagedUserTarget;
    actorUserId: string;
    expectedActorAuthRevision: number;
    temporaryLoginName: string;
    passwordHash: string;
    expiresAt: string;
    now: string;
    audit: AuditEventWrite;
  }>): Promise<"updated" | "login_name_taken" | "conflict">;
  consumeTemporaryPasswordAndOpenSession(input: Readonly<{
    userId: string;
    passwordHash: string;
    now: string;
    tokenDigest: string;
    expiresAt: string;
    maximumSessions: number;
    authRevision: number;
  }>): Promise<boolean>;
  completeTemporaryPasswordAndOpenSession(input: Readonly<{
    userId: string;
    restrictedSessionTokenDigest: string;
    previousLoginName: string;
    loginName: string;
    passwordHash: string;
    authRevision: number;
    now: string;
    tokenDigest: string;
    expiresAt: string;
    maximumSessions: number;
    audit: AuditEventWrite;
  }>): Promise<"completed" | "invalid" | "login_name_taken">;

  listInvites(input: Readonly<{
    visibility: InviteVisibility;
    limit: number;
    cursor: InviteCursor | null;
    search: string;
    exactTokenDigest?: string;
    now: string;
  }>): Promise<InvitePage>;
  getInviteStats(now: string): Promise<InviteStats>;
  findInvite(id: string): Promise<InviteRecord | null>;
  createInvite(input: Readonly<{
    id: string;
    tokenDigest: string;
    createdBy: string;
    roleId: string;
    maxUses: number;
    expiresAt: string | null;
    now: string;
  }>, audit: AuditEventWrite): Promise<InviteRecord>;
  revokeInvite(id: string, now: string, audit: AuditEventWrite): Promise<boolean>;
  deleteInvite(id: string, audit: AuditEventWrite): Promise<boolean>;

  findManagedUsers(userIds: readonly string[]): Promise<readonly ManagedUserTarget[]>;
  countActiveRoleManagers(): Promise<number>;
  countActiveRoleManagersAmong(userIds: readonly string[]): Promise<number>;
  setUsersRole(input: Readonly<{
    targets: readonly ManagedUserTarget[];
    destinationRole: RoleRecord;
    now: string;
  }>, audit: AuditEventWrite): Promise<GuardedAuthMutationResult>;
  setUsersActive(input: Readonly<{
    targets: readonly ManagedUserTarget[];
    active: boolean;
    now: string;
  }>, audit: AuditEventWrite): Promise<GuardedAuthMutationResult>;
  softDeleteUsers(input: Readonly<{
    targets: readonly ManagedUserTarget[];
    now: string;
  }>, audit: AuditEventWrite): Promise<GuardedAuthMutationResult>;
  resetUserLoginLock(target: ManagedUserTarget, audit: AuditEventWrite): Promise<
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
  }>, audit: AuditEventWrite): Promise<"created" | "conflict">;
  updateRole(input: Readonly<{
    id: string;
    name?: string;
    level?: number;
    color?: string | null;
    permissionDelta: RolePermissionDelta;
    expectedRevisionToken: string;
    expectedPermissions: readonly Permission[];
    now: string;
  }>, audit: AuditEventWrite): Promise<GuardedAuthMutationResult>;
  deleteRole(role: RoleRecord, audit: AuditEventWrite): Promise<"deleted" | "referenced" | "not_found" | "conflict" | "last_role_manager">;
}
