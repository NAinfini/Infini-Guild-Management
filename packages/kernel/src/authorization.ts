import { AppError } from "./errors.js";

export type PermissionId = string;

export type AuthenticatedActor = Readonly<{
  userId: string;
  sessionId: string;
  roleId: string;
  roleLevel: number;
  permissions: ReadonlySet<PermissionId>;
  sessionScope: "normal" | "password_change";
}>;

export type AuthenticatedActorInput = Omit<AuthenticatedActor, "permissions" | "sessionScope"> & {
  permissions: Iterable<PermissionId>;
  sessionScope?: "normal" | "password_change";
};

class ImmutablePermissionSet implements ReadonlySet<PermissionId> {
  readonly #values: Set<PermissionId>;

  constructor(values: Iterable<PermissionId>) {
    this.#values = new Set(values);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  has(value: PermissionId): boolean {
    return this.#values.has(value);
  }

  entries(): SetIterator<[PermissionId, PermissionId]> {
    return this.#values.entries();
  }

  keys(): SetIterator<PermissionId> {
    return this.#values.keys();
  }

  values(): SetIterator<PermissionId> {
    return this.#values.values();
  }

  forEach(
    callbackfn: (value: PermissionId, value2: PermissionId, set: ReadonlySet<PermissionId>) => void,
    thisArg?: unknown,
  ): void {
    for (const value of this.#values) callbackfn.call(thisArg, value, value, this);
  }

  [Symbol.iterator](): SetIterator<PermissionId> {
    return this.values();
  }

  get [Symbol.toStringTag](): string {
    return "Set";
  }
}

function requiredIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function normalizeActor(input: AuthenticatedActorInput): AuthenticatedActor {
  if (!Number.isSafeInteger(input.roleLevel) || input.roleLevel < 0) {
    throw new TypeError("roleLevel must be a non-negative safe integer");
  }
  const permissions = new Set<PermissionId>();
  for (const permission of input.permissions) {
    permissions.add(requiredIdentifier(permission, "permission"));
  }
  return Object.freeze({
    userId: requiredIdentifier(input.userId, "userId"),
    sessionId: requiredIdentifier(input.sessionId, "sessionId"),
    roleId: requiredIdentifier(input.roleId, "roleId"),
    roleLevel: input.roleLevel,
    permissions: new ImmutablePermissionSet(permissions),
    sessionScope: input.sessionScope ?? "normal",
  });
}

export class AuthorizationContext {
  readonly actor: AuthenticatedActor | null;

  private constructor(actor: AuthenticatedActor | null) {
    this.actor = actor;
    Object.freeze(this);
  }

  static anonymous(): AuthorizationContext {
    return new AuthorizationContext(null);
  }

  static authenticated(actor: AuthenticatedActorInput): AuthorizationContext {
    return new AuthorizationContext(normalizeActor(actor));
  }

  isAuthenticated(): this is AuthorizationContext & { actor: AuthenticatedActor } {
    return this.actor !== null;
  }

  has(permission: PermissionId): boolean {
    return this.actor?.permissions.has(permission) ?? false;
  }

  requireAuthenticated(): AuthenticatedActor {
    if (!this.actor) {
      throw new AppError({
        code: "UNAUTHORIZED",
        status: 401,
        message: "Authentication required",
      });
    }
    return this.actor;
  }

  require(permission: PermissionId): AuthenticatedActor {
    const actor = this.requireAuthenticated();
    if (!actor.permissions.has(permission)) {
      throw new AppError({
        code: "FORBIDDEN",
        status: 403,
        message: "Permission denied",
        details: { permission },
      });
    }
    return actor;
  }
}

export function createAuthorizationContext(
  actor: AuthenticatedActorInput | null,
): AuthorizationContext {
  return actor ? AuthorizationContext.authenticated(actor) : AuthorizationContext.anonymous();
}
