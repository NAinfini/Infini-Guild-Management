# Permission-Based RBAC — Implementation Tasks

## Group 1: Shared Types (R3, R6)
> File: `apps/shared/constants/roles.ts`

- [x] 1.1 Add 4 new permissions to `PERMISSIONS` array: `admin.roles.view`, `admin.analytics.view`, `admin.analytics.manage`, `gallery.manage`
- [x] 1.2 Add `BuiltinRole` type alias (`"admin" | "moderator" | "member"`)
- [x] 1.3 Add `RoleId = string` type alias
- [x] 1.4 Add `isBuiltinRole(roleId: string): roleId is BuiltinRole` type guard
- [x] 1.5 Add `roleFromLevel(level: number): BuiltinRole` helper
- [x] 1.6 Add `hasPermission(granted: ReadonlySet<Permission>, required: Permission): boolean`
- [x] 1.7 Add `hasAnyPermission(granted: ReadonlySet<Permission>, required: Permission[]): boolean` (Set-based overload)
- [x] 1.8 Add `MODERATOR_DEFAULT_PERMISSIONS` and `MEMBER_DEFAULT_PERMISSIONS` constant Sets
- [x] 1.9 Keep existing `hasRoleAtLeast` for backward compat

## Group 2: Schema Widening (R5)
> File: `apps/worker/db/schema/auth.ts`, `apps/shared/schemas/admin.ts`

- [x] 2.1 Widen `users.role` from `text("role", { enum: [...] })` to `text("role").notNull().default("member").references(() => roles.id)`
- [x] 2.2 Update `batchRoleChangeSchema.new_role` from `z.enum(["member", "moderator"])` to `z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/)`
- [x] 2.3 Fix all TypeScript errors from type widening (`users.role` is now `string` not `Role`)

## Group 3: Auth Service — Session Hydration (R1, R6)
> File: `apps/worker/services/auth.ts`

- [x] 3.1 Define `SessionUser` type with `{ id, roleId, roleLevel, role, permissions }`
- [x] 3.2 Add Symbol-based per-request memoization (`RESOLVED_SESSION_PROMISE`)
- [x] 3.3 Refactor `resolveSession` to `resolveSession` (memoized) + `resolveSessionUncached`
- [x] 3.4 Add `LEFT JOIN roles ON users.role = roles.id` to session query
- [x] 3.5 Add `role_permissions` query: `SELECT permission, granted FROM role_permissions WHERE roleId = ?`
- [x] 3.6 Implement `buildPermissionSet(roleId, permissionRows)` — builtin defaults + overlay
- [x] 3.7 Implement `resolveCompatibilityRole(roleId, roleLevel)` — BuiltinRole derivation
- [x] 3.8 Duplicate `MODERATOR_DEFAULT_PERMISSIONS` / `MEMBER_DEFAULT_PERMISSIONS` in auth.ts (avoid circular dep)
- [x] 3.9 Update `ResolvedSession` return type to include `SessionUser`

## Group 4: RBAC Middleware (R2)
> File: `apps/worker/middleware/rbac.ts`

- [x] 4.1 Add `getRequestUser(c)` — hybrid: check `c.get("user")` first, fall back to `resolveSession`
- [x] 4.2 Add `requirePermission(c, permission)` → returns `SessionUser | Response`
- [x] 4.3 Add `requireAnyPermission(c, permissions[])` → returns `SessionUser | Response`
- [x] 4.4 Update existing `requireRole()` to use `getRequestUser()` internally
- [x] 4.5 Keep `requireRoleOrError()` for backward compat during migration

## Group 5: Index.ts Variables (R1)
> File: `apps/worker/index.ts`

- [x] 5.1 Update `Variables.user` type from `{ id: string; role: "admin" | "moderator" | "member" } | null` to `SessionUser | null`
- [x] 5.2 Update `sessionMiddleware` to set `SessionUser` on context

## Group 6: AdminService + Security Guards (R5, Security 10.1/10.2)
> File: `apps/worker/services/AdminService.ts`

- [x] 6.1 Add `level <= 2` guard to `createRole` (matching `updateRole`)
- [x] 6.2 Add `newRoleId !== "admin"` guard to `batchUpdateRole`
- [x] 6.3 Add `newRoleId !== "admin"` guard to `updateUserRole`
- [x] 6.4 Widen `batchUpdateRole` to accept `string` roleId, validate against `roles` table
- [x] 6.5 Widen `updateUserRole` to accept `string` roleId, validate against `roles` table
- [x] 6.6 Remove `as Role` casts in `listRoles` count queries

## Group 7: Route Migration — admin.ts (R4)
> File: `apps/worker/routes/admin.ts`

- [x] 7.1 Replace all `requireRoleOrError(c, "moderator")` with `requirePermission(c, "admin.xxx.view")`
- [x] 7.2 Replace all `requireRoleOrError(c, "admin")` with `requirePermission(c, "admin.xxx.manage")`
- [x] 7.3 Map each endpoint to its specific permission per requirements table
- [x] 7.4 Remove local role-checking helpers
- [x] 7.5 Leave `GET /audit-archive/download/file` (token-only) unchanged

## Group 8: Route Migration — events.ts (R4)
> File: `apps/worker/routes/events.ts`

- [x] 8.1 Add `requireEventManager` wrapper → `requirePermission(c, "events.manage")`
- [x] 8.2 Replace all `requireModerator` calls with `requireEventManager`
- [x] 8.3 Keep public GET and session-only join/leave unchanged
- [x] 8.4 Remove local `requireSession` and `requireModerator` helpers

## Group 9: Route Migration — announcements.ts (R4)
> File: `apps/worker/routes/announcements.ts`

- [x] 9.1 Add `requireAnnouncementManager` wrapper → `requirePermission(c, "announcements.manage")`
- [x] 9.2 Replace `requireModerator` calls with `requireAnnouncementManager`
- [x] 9.3 Update session-optional reads: `canReadAll` → `permissions.has("announcements.manage")`
- [x] 9.4 Remove local role-checking helpers

## Group 10: Route Migration — gallery.ts (R4)
> File: `apps/worker/routes/gallery.ts`

- [x] 10.1 Add `requireGalleryUploader` wrapper → `requirePermission(c, "gallery.upload")`
- [x] 10.2 Add `requireGalleryManager` wrapper → `requirePermission(c, "gallery.manage")`
- [x] 10.3 Add `requireSessionUser` wrapper → session-only (no permission check)
- [x] 10.4 Replace upload endpoints: member check → `requireGalleryUploader`
- [x] 10.5 Replace delete endpoints: moderator check → `requireGalleryManager`
- [x] 10.6 Keep public GET, like, comments CRUD as-is
- [x] 10.7 Remove local `requireRole` helper

## Group 11: Route Migration — guild-war.ts (R4)
> File: `apps/worker/routes/guild-war.ts`

- [x] 11.1 Add `requireGuildWarManager` → `requirePermission(c, "guildwar.manage")`
- [x] 11.2 Add `requireGuildWarHistoryEditor` → `requirePermission(c, "guildwar.history.edit")`
- [x] 11.3 Replace team management endpoints → `requireGuildWarManager`
- [x] 11.4 Replace history endpoints → `requireGuildWarHistoryEditor`
- [x] 11.5 Keep public reads unchanged
- [x] 11.6 Remove local `requireRole` helper

## Group 12: Route Migration — wiki.ts (R4)
> File: `apps/worker/routes/wiki.ts`

- [x] 12.1 Add `requireWikiEditor` → `requirePermission(c, "wiki.edit")`
- [x] 12.2 Replace moderator checks → `requireWikiEditor`
- [x] 12.3 Replace admin check on `DELETE /categories/:id` → `requireWikiEditor`
- [x] 12.4 Remove local role-checking helpers

## Group 13: Frontend i18n (R7)
> Files: `apps/portal/i18n/en/admin.json`, `apps/portal/i18n/zh/admin.json`

- [x] 13.1 Add permission labels for `admin.roles.view`
- [x] 13.2 Add permission labels for `admin.analytics.view`, `admin.analytics.manage`
- [x] 13.3 Add permission labels for `gallery.manage`

## Group 14: TypeCheck + Tests (Acceptance Criteria)

- [x] 14.1 Run `tsc --noEmit` and fix all type errors
- [x] 14.2 Run existing test suite and fix failures
- [x] 14.3 Verify builtin roles behave identically to before migration
