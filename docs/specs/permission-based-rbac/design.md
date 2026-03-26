# Permission-Based RBAC — Design Document

## Architecture Overview

```
Request → sessionMiddleware (admin only) or direct resolveSession()
        → resolveSession() [memoized per-request via Symbol on Context]
            → sessions JOIN users LEFT JOIN roles → get roleId, roleLevel
            → role_permissions WHERE roleId → build Set<Permission>
            → return SessionUser { id, roleId, roleLevel, role, permissions }
        → requirePermission(c, "events.manage")
            → getRequestUser(c) → checks c.get("user") first, falls back to resolveSession()
            → user.permissions.has("events.manage") → allow or 403
```

## 1. Shared Types (`apps/shared/constants/roles.ts`)

### Changes
- Add `BuiltinRole` type alias for the 3 builtin roles
- Add `RoleId = string` for custom role references
- Add 4 new permissions: `admin.roles.view`, `admin.analytics.view`, `admin.analytics.manage`, `gallery.manage`
- Add `isBuiltinRole(roleId: string): roleId is BuiltinRole`
- Add `roleFromLevel(level: number): BuiltinRole` — maps custom role levels to compat BuiltinRole
- Add `hasPermission(granted, required)` and `hasAnyPermission(granted, required[])` operating on `Set<Permission>`
- Keep `hasRoleAtLeast` for backward compat (only operates on BuiltinRole)

### New Permission Constants (24 total, up from 20)
```
admin.users.view, admin.users.edit, admin.users.role, admin.users.activate,
admin.users.delete, admin.users.password, admin.invite.view, admin.invite.manage,
admin.audit.view, admin.audit.export, admin.bot.view, admin.bot.manage,
admin.status.view, admin.analytics.view (NEW), admin.analytics.manage (NEW),
admin.roles.view (NEW), admin.roles.manage,
guildwar.manage, guildwar.history.edit, events.manage, announcements.manage,
gallery.upload, gallery.manage (NEW), wiki.edit
```

## 2. Schema Changes (`apps/worker/db/schema/auth.ts`)

```diff
- role: text("role", { enum: ["admin", "moderator", "member"] }).notNull().default("member"),
+ role: text("role").notNull().default("member").references(() => roles.id),
```

No SQL migration needed — SQLite TEXT column already accepts any string value. The only change is TypeScript type widening: `typeof users.$inferSelect.role` becomes `string` instead of `"admin" | "moderator" | "member"`.

### Type Ripple
All code that treats `users.role` as `Role` must be updated:
- `AdminService.batchUpdateRole` / `updateUserRole`: accept `string` roleId, validate against `roles` table
- `AdminService.listRoles` count queries: remove `as Role` casts
- `batchRoleChangeSchema.new_role`: change from `z.enum(["member", "moderator"])` to `z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/)`

## 3. Session Hydration (`apps/worker/services/auth.ts`)

### Memoization
```typescript
const RESOLVED_SESSION_PROMISE = Symbol("resolved_session_promise");

type ContextWithCache = Context & {
  [RESOLVED_SESSION_PROMISE]?: Promise<ResolvedSession | null>;
};

export async function resolveSession(c: Context): Promise<ResolvedSession | null> {
  const carrier = c as ContextWithCache;
  carrier[RESOLVED_SESSION_PROMISE] ??= resolveSessionUncached(c);
  return await carrier[RESOLVED_SESSION_PROMISE]!;
}
```

### New SessionUser Type
```typescript
export type SessionUser = {
  id: string;
  roleId: string;        // actual role ID (builtin or custom)
  roleLevel: number;     // from roles.level
  role: SessionUserRole; // compat: derived BuiltinRole
  permissions: ReadonlySet<Permission>;
};
```

### Query Changes
1. Existing query: `sessions JOIN users` → add `LEFT JOIN roles ON users.role = roles.id` to get `roleLevel`
2. New query: `SELECT permission, granted FROM role_permissions WHERE roleId = ?` — one extra query per request
3. Build permissions via `buildPermissionSet(roleId, permissionRows)`:
   - Start with builtin defaults for known roles, empty for custom
   - Overlay stored `role_permissions` rows (granted=true adds, granted=false removes)

### Compat Role Derivation
```typescript
function resolveCompatibilityRole(roleId: string, roleLevel: number | null): SessionUserRole {
  if (isBuiltinRole(roleId)) return roleId;
  if ((roleLevel ?? 1) >= 3) return "admin";
  if ((roleLevel ?? 1) >= 2) return "moderator";
  return "member";
}
```

## 4. RBAC Middleware (`apps/worker/middleware/rbac.ts`)

### New Functions
```typescript
async function getRequestUser(c: Context): Promise<SessionUser | null> {
  const cached = c.get("user") as SessionUser | null | undefined;
  if (cached !== undefined) return cached;  // set by sessionMiddleware for /api/admin/*
  return (await resolveSession(c))?.user ?? null;  // direct call for other routes
}

export async function requirePermission(c: Context, permission: Permission): Promise<SessionUser | Response> {
  const user = await getRequestUser(c);
  if (!user) return buildError(c, "UNAUTHORIZED", "Authentication required");
  if (!user.permissions.has(permission)) return buildError(c, "FORBIDDEN", "Insufficient permission");
  return user;
}
```

### Legacy Compat
- `requireRole()` middleware: updated to use `getRequestUser()` instead of `c.get("user")`
- `requireRoleOrError()`: kept as-is for any remaining usages during gradual migration

## 5. Index.ts Variables
```diff
- user: { id: string; role: "admin" | "moderator" | "member" } | null;
+ user: SessionUser | null;
```

## 6. Route File Migration Pattern

Each route file replaces its local auth helpers with thin wrappers around centralized `requirePermission`:

### Example: events.ts
```typescript
// BEFORE
function requireModerator(c: Context, user: SessionUser): Response | null {
  return hasRoleAtLeast(user.role, "moderator") ? null : buildError(c, "FORBIDDEN", "...");
}
eventsRoutes.post("/", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) return sessionUser;
  const roleError = requireModerator(c, sessionUser);
  if (roleError) return roleError;

// AFTER
async function requireEventManager(c: Context): Promise<SessionUser | Response> {
  return await requirePermission(c, "events.manage");
}
eventsRoutes.post("/", async (c) => {
  const sessionUser = await requireEventManager(c);
  if (sessionUser instanceof Response) return sessionUser;
```

### Route-specific wrappers
| File | Wrapper | Permission |
|---|---|---|
| events.ts | `requireEventManager` | `events.manage` |
| announcements.ts | `requireAnnouncementManager` | `announcements.manage` |
| gallery.ts | `requireGalleryUploader` | `gallery.upload` |
| gallery.ts | `requireGalleryManager` | `gallery.manage` |
| gallery.ts | `requireSessionUser` | session-only (no permission) |
| guild-war.ts | `requireGuildWarManager` | `guildwar.manage` |
| guild-war.ts | `requireGuildWarHistoryEditor` | `guildwar.history.edit` |
| wiki.ts | `requireWikiEditor` | `wiki.edit` |
| admin.ts | direct `requirePermission(c, "admin.xxx")` | per-endpoint |

### Session-optional reads (announcements, gallery)
```typescript
// BEFORE
const canReadAll = Boolean(resolved && hasRoleAtLeast(resolved.user.role, "moderator"));
// AFTER
const canReadAll = Boolean(resolved?.user.permissions.has("announcements.manage"));
```

## 7. AdminService Changes

### Role Assignment
- `batchUpdateRole(actorId, userIds, newRoleId: string)` — validate roleId exists in `roles` table
- `updateUserRole(actorId, targetUserId, newRoleId: string)` — same validation
- Remove `as Role` casts on `eq(users.role, roleId)`

### Default Permissions
Move `MODERATOR_DEFAULT_PERMISSIONS` and `MEMBER_DEFAULT_PERMISSIONS` to shared constants or keep in AdminService but ensure `auth.ts` has its own copy (to avoid circular dependency).

Decision: **duplicate the sets in auth.ts** — they are small, stable, and avoiding the circular dep between `services/auth.ts` → `services/AdminService.ts` is worth 10 lines of duplication.

## 8. Frontend Impact (Minimal)

- `utils/permissions.ts` already works correctly with `AdminRole.permissions` object
- Add new permission keys to admin i18n files (`admin.roles.view`, `admin.analytics.view`, `admin.analytics.manage`, `gallery.manage`)
- `AdminPage.tsx` / `useAdminData.ts`: some `isModerator` checks should migrate to permission checks (non-blocking, can be done separately)

## 9. Performance

| Metric | Before | After |
|---|---|---|
| Queries per request (authed) | 1 (sessions JOIN users) | 2 (+ LEFT JOIN roles, + role_permissions WHERE) |
| Queries per request (unauthed) | 0 | 0 |
| Memory per request | ~50 bytes (id + role) | ~200 bytes (id + roleId + Set of 24 perms) |
| Cache invalidation | N/A | Per-request only, no stale data risk |

The extra query is a simple index scan on `role_permissions.roleId` (composite PK). D1 latency for this is ~1-2ms.

## 10. Security Guards (Must-Fix)

### 10.1 createRole Level Guard
`AdminService.updateRole` blocks `level > 2`, but `createRole` does NOT. An admin could create a custom role with `level=3`, which maps to `"admin"` via compat derivation.

**Fix**: Add `level <= 2` validation in `createRole`, matching `updateRole`'s existing guard.

### 10.2 Admin Role Assignment Guard
When `batchRoleChangeSchema.new_role` is widened from `z.enum(["member", "moderator"])` to `z.string()`, it becomes possible to submit `new_role: "admin"`. The builtin `admin` role should never be assignable via API.

**Fix**: In `AdminService.batchUpdateRole` and `updateUserRole`, reject if `newRoleId` is `"admin"`. Admin role assignment is DB-only (intentional).

```typescript
if (newRoleId === "admin") {
  throw new Error("Cannot assign builtin admin role via API");
}
```

### 10.3 Gallery Comments Auth
`GET /gallery/:id/comments` has no auth check. Decision: keep public (comments are visible content). Document as accepted.

## 11. Security Audit Summary

| Area | Status | Notes |
|---|---|---|
| Session cookie (HttpOnly, SameSite) | SECURE | Cannot be forged; DB-validated |
| Auth store (Zustand, no persist) | SECURE | Local state manipulation has no effect |
| CSRF (Origin + X-Requested-With) | SECURE | Dual-layer protection |
| Self-role-assignment | SECURE | Both batch and single-user methods block |
| Frontend router guards | SECURE | Backend enforces independently |
| createRole level guard | **FIX REQUIRED** | See 10.1 |
| Admin role assignment | **FIX REQUIRED** | See 10.2 |
| Archive download tokens | ACCEPTABLE | 15-min TTL, standard pre-signed URL |
| Public data exposure (userId, username, discord_id) | BY DESIGN | Guild management requires visibility |

## 12. Residual Risk

- **Service-layer auth branching on `role`**: Gallery comment deletion passes `sessionUser.role` to service. After migration, custom roles mapped to "member" compat role could behave differently than intended. Should be audited separately.
- **Admin self-protection**: Admins can theoretically remove their own permissions by editing their role. The `admin` builtin role hardcodes all permissions to true, so this only applies to custom admin-level roles.
- **Session invalidation on role change**: After changing a user's role, their active session keeps the old permissions until the session cookie is next resolved (next request). This is acceptable for a guild management system.

## 13. Migration Order

1. **Shared types** — add new permissions, BuiltinRole, helper functions
2. **Schema** — widen `users.role` type
3. **Auth service** — refactor `resolveSession` with memoization and permission hydration
4. **RBAC middleware** — add `requirePermission`, update `getRequestUser`
5. **Index.ts** — update Variables type
6. **AdminService** — widen role assignment methods
7. **Route files** — migrate one at a time: admin → events → announcements → gallery → guild-war → wiki
8. **Frontend i18n** — add new permission labels
9. **Tests** — update existing tests, add permission-specific test cases
