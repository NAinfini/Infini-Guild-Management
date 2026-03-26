# Permission-Based RBAC Migration

## Problem

Backend routes use hardcoded `hasRoleAtLeast(user.role, "moderator")` for all authorization.
The `roles` + `role_permissions` tables exist and the admin console can create custom roles with granular permissions, but:

1. `resolveSession` returns only `{ id, role }` where `role` is `"admin" | "moderator" | "member"` enum
2. No route ever queries `role_permissions` — custom role permissions are ignored
3. `users.role` column has a Drizzle enum constraint limiting to 3 builtin values
4. `batchRoleChangeSchema` restricts `new_role` to `["member", "moderator"]` — custom roles can't be assigned
5. Frontend already checks permissions via `hasAnyPermission(roles, roleId, permissions)` but backend doesn't enforce them

Custom roles created in admin are **display-only** — zero functional effect on access control.

## Goal

Make the backend respect the permission system that already exists in the data model. When admin assigns a custom role with specific permissions to a user, those permissions (and only those) should determine what endpoints the user can access.

## Requirements

### R1: Session Hydration
- `resolveSession` must return `{ id, roleId, roleLevel, role, permissions: Set<Permission> }`
- Join `users` → `roles` → `role_permissions` in one query path
- Per-request memoization (not persisted cache) to avoid N+1
- `role` field (BuiltinRole) derived from `roleId` for legacy compat: builtin stays as-is, custom maps via level

### R2: Permission Middleware
- New `requirePermission(c, "events.manage")` → resolves session, checks permission set
- New `requireAnyPermission(c, ["perm1", "perm2"])` → same, any match
- Existing `requireRole`/`requireRoleOrError` kept for backward compat during migration
- All in `apps/worker/middleware/rbac.ts`

### R3: New Permissions
Add 4 missing permissions to `PERMISSIONS` array:
- `admin.roles.view` — view roles list (currently hardcoded moderator+)
- `admin.analytics.view` — view analytics settings
- `admin.analytics.manage` — update analytics settings
- `gallery.manage` — delete/batch-delete gallery items (vs `gallery.upload` for upload)

### R4: Route Migration
Every protected route switches from role-level check to permission check. Full mapping:

**Admin (`/api/admin`)**
| Endpoint | Current | Target Permission |
|---|---|---|
| GET /invite-links, /invite-links/stats | moderator | `admin.invite.view` |
| POST /invite-links, DELETE /invite-links/:id, DELETE /invite-links/:id/permanent | admin | `admin.invite.manage` |
| PATCH /users/batch/role, PATCH /users/:id/role | admin | `admin.users.role` |
| PATCH /users/batch/deactivate, /batch/reactivate, /:id/deactivate, /:id/reactivate | admin | `admin.users.activate` |
| PATCH /users/batch/delete | admin | `admin.users.delete` |
| POST /users | admin | `admin.users.edit` |
| POST /users/:id/reset-password | admin | `admin.users.password` |
| GET /roles | moderator | `admin.roles.view` |
| POST /roles, PATCH /roles/:id, DELETE /roles/:id | admin | `admin.roles.manage` |
| GET /bot-settings, /bot-settings/discord/channels | moderator | `admin.bot.view` |
| PATCH /bot-settings, POST /bot-settings/test | admin | `admin.bot.manage` |
| GET /status | moderator | `admin.status.view` |
| GET /analytics-settings | moderator | `admin.analytics.view` |
| PATCH /analytics-settings | admin | `admin.analytics.manage` |
| GET /audit-archive/months, /:month, GET /audit-log | moderator | `admin.audit.view` |
| GET /audit-archive/download, GET /audit-log/export | moderator | `admin.audit.export` |
| GET /audit-archive/download/file | token-only | unchanged |

**Events (`/api/events`)**
| Endpoint | Current | Target Permission |
|---|---|---|
| GET /, POST /batch-details, GET /image, GET /:id | public | unchanged |
| POST /, PATCH /:id, DELETE /:id, DELETE /:id/destroy | moderator | `events.manage` |
| POST /:id/images | moderator | `events.manage` |
| POST /:id/join, DELETE /:id/leave | session | unchanged |
| POST /:id/participants, DELETE /:id/participants/:userId | moderator | `events.manage` |
| All template endpoints | moderator | `events.manage` |

**Announcements (`/api/announcements`)**
| Endpoint | Current | Target Permission |
|---|---|---|
| GET /, GET /:id, GET /image | public (session-optional) | unchanged (use `hasPermission` for visibility) |
| POST /, PATCH /:id, DELETE /:id, POST /:id/images | moderator | `announcements.manage` |

**Gallery (`/api/gallery`)**
| Endpoint | Current | Target Permission |
|---|---|---|
| GET / | public | unchanged |
| POST /images, POST /videos | member | `gallery.upload` |
| DELETE /:id, POST /batch-delete | moderator | `gallery.manage` |
| POST /:id/like | member | session (unchanged) |
| GET /:id/comments | no auth | session or public (decision needed) |
| POST /:id/comments, PATCH, DELETE comments | member | session (unchanged) |

**Guild War (`/api/guild-war`)**
| Endpoint | Current | Target Permission |
|---|---|---|
| GET /active, /history, /analytics, /export, /templates, etc. | public | unchanged |
| POST /save-teams, /move, PATCH /role-tag, POST /post-teams | moderator | `guildwar.manage` |
| POST /templates, /templates/apply, DELETE /templates/:id | moderator | `guildwar.manage` |
| POST /post-results, /history, PATCH /history/:id, DELETE /history/:id | moderator | `guildwar.history.edit` |
| PATCH /history/:id/member-stats/* | moderator | `guildwar.history.edit` |

**Wiki (`/api/wiki`)**
| Endpoint | Current | Target Permission |
|---|---|---|
| GET /categories, /articles | public | unchanged |
| POST/PATCH categories, POST/PATCH/DELETE articles, POST images | moderator | `wiki.edit` |
| DELETE /categories/:id | admin | `wiki.edit` (or keep elevated?) |

### R5: Schema Widening
- `users.role` column: remove Drizzle enum constraint, make it `text("role").notNull().default("member").references(() => roles.id)`
- `batchRoleChangeSchema`: change `new_role` from `z.enum(["member", "moderator"])` to role ID string
- `AdminService.batchUpdateRole` / `updateUserRole`: accept string roleId, validate against `roles` table
- No SQL migration needed (SQLite TEXT column already accepts any string)

### R6: Default Permissions for Builtins
- `admin` role: all permissions always granted (hardcoded override)
- `moderator` role: default permissions as currently defined in `MODERATOR_DEFAULT_PERMISSIONS`
- `member` role: `gallery.upload` only
- Custom roles: only explicitly granted permissions in `role_permissions` table
- Move `MODERATOR_DEFAULT_PERMISSIONS` and `MEMBER_DEFAULT_PERMISSIONS` to shared constants

### R7: Frontend Alignment
- Portal already uses `hasAnyPermission(roles, roleId, permissions)` — no major changes
- `isModerator` checks in AdminPage and other places should also migrate to permission checks
- Add new permission keys to frontend i18n

## Acceptance Criteria

- [ ] `resolveSession` returns permissions set hydrated from `role_permissions`
- [ ] `requirePermission` / `requireAnyPermission` middleware exists and works
- [ ] All 4 new permissions added to `PERMISSIONS` array
- [ ] All protected routes use permission checks instead of role-level checks
- [ ] Custom roles can be assigned to users via admin console
- [ ] A custom role with `events.manage` but not `guildwar.manage` can create events but NOT access guild war management
- [ ] Built-in roles (admin/moderator/member) behave identically to before migration
- [ ] No N+1 queries — permissions loaded once per request
- [ ] TypeCheck passes
- [ ] Existing tests pass

## Non-Goals
- Permission caching beyond per-request memoization
- New UI for permission management (already exists)
- Changing the frontend permission checking approach (already correct)
- Adding new features beyond what the permission system enables

## Technical Notes
- SQLite has no real enum constraint — the Drizzle enum is TypeScript-only
- `resolveSession` already does a JOIN; adding `roles` + `role_permissions` queries is 1 extra query per request
- The `role` field on `SessionUser` is kept for backward compat but derived from `roleId`
- `internal-bot` routes use HMAC (M2M), not session auth — unaffected
- Dev seed endpoints use env gate — unaffected
