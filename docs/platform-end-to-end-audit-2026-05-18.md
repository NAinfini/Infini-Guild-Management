# Guild Management Portal End-to-End Audit

Date: 2026-05-18
Scope: read-only architecture, UX, security, performance, backend, Worker/runtime, database, and maintainability audit.

## Executive Summary

This platform is a Cloudflare Workers + Hono API, React 19 SPA, D1/SQLite database, R2 media store, and Durable Object WebSocket guild management portal. For a game guild with up to roughly 500 users, the core architecture is practical and appropriately lightweight. The main improvement opportunity is not enterprise-scale complexity; it is tightening staff/admin safety, reducing UI/API desynchronization, improving operational observability, and making common workflows smoother.

Current risk posture: **medium** for the intended guild use case.

Primary themes:

- The app has a clear domain split and shared Zod contracts, but authorization is spread across route guards, services, frontend permission helpers, and some boolean capability parameters.
- The permission model is intentionally simple and mostly appropriate for a 500-user guild, but role assignment and privileged-account controls need guardrails.
- The frontend has strong route-level lazy loading and a practical admin console structure, but admin data fetching and permission-driven UI state can desync.
- Audit logging exists, but critical audit writes are best-effort and can be lost without blocking the protected action.
- Cloudflare Workers, D1, R2, and Durable Objects are a good fit at this scale, but the system needs better operational health checks, backup/restore posture, and permission invalidation behavior.

## Severity Model

- **Critical**: direct compromise, irreversible data loss, or full admin takeover likely.
- **High**: privilege escalation, sensitive data exposure, major workflow breakage, or security control bypass.
- **Medium**: reliability, maintainability, UX, or operational risks that can affect normal use.
- **Low**: polish, consistency, or future-proofing improvements.

## Confirmed Must-Fix Findings

### MF-001: Custom-role grantability is controlled only by role level, not permission content

Severity: **Medium-High**

Evidence:

- `apps/worker/routes/admin.ts` protects role assignment with `admin.users.role`.
- `apps/worker/services/AdminService.ts` currently enforces role-level boundaries for single and batch role assignment.
- The service does not verify that the actor is allowed to grant every permission included in the target role beyond the role-level comparison.

Failure scenario:

A high-level custom role is configured with broad permissions but a lower numeric level than a staff actor. A user with `admin.users.role` can assign that role even if the role contains permissions the actor would not otherwise be allowed to delegate.

Impact:

Privilege delegation can become unsafe if role levels and permission contents drift. For the guild use case, this is manageable but should be made explicit.

Recommended fix:

- Keep the current `actor.level > target.level` check.
- Add a high-risk permission grantability rule: only builtin admin can assign roles containing `admin.users.password`, `admin.roles.manage`, `admin.users.delete`, `admin.audit.export`, or future security-sensitive permissions.
- Add regression tests for assigning lower-level custom roles with and without sensitive permissions.

### MF-002: Password reset is level-protected, but still needs clearer high-risk UX and policy

Severity: **Medium**

Evidence:

- `apps/worker/routes/admin.ts` protects `/users/:id/reset-password` with `admin.users.password`.
- `apps/worker/services/AdminService.ts` prevents resetting users at or above the actor's role level.
- The temporary password is returned to the caller.

Failure scenario:

A compromised staff account with password reset permission resets a lower-level user's account and signs in as that user. This is expected capability, but it should be treated as a high-risk admin action in UI and audit flows.

Impact:

Potential user account takeover within the actor's delegated authority.

Recommended fix:

- Keep the current level check.
- Require confirmation with target username and role.
- Consider requiring current-admin re-authentication for password resets.
- Add optional reason capture and notify the target user out of band when possible.
- Add tests that same-level and higher-level password reset is denied.

### MF-003: Critical audit logging is best-effort and can silently fail

Severity: **Medium-High**

Evidence:

- `apps/worker/services/audit.ts` writes audit logs with `executionCtx.waitUntil`.
- Write failures are caught and logged, but the privileged action still succeeds.
- Audit writes are not transactionally coupled to role changes, password resets, deletions, or invite changes.

Failure scenario:

A D1 transient failure, quota issue, or schema issue causes role/password/delete audit entries to be lost while the protected action succeeds.

Impact:

Incident reconstruction becomes unreliable. This is not a compliance blocker for a game guild, but it weakens admin accountability.

Recommended fix:

- For role changes, password resets, user deletion/deactivation, and permission edits, await the audit write and fail the mutation if the audit write fails.
- Longer term: use a transactional outbox table for critical audit events and process exports asynchronously.

### MF-004: Permission revocation is not immediate across Worker isolates

Severity: **Medium**

Evidence:

- `apps/worker/services/auth.ts` uses a 60-second per-isolate role permission cache.
- `clearPermissionCache()` clears only the current isolate.
- Most admin endpoints use fresh permission checks, but not all authorization paths do, and `/api/admin/status` explicitly allows cached permissions.

Failure scenario:

A demoted user can continue performing some permitted actions until cache expiry or session invalidation catches up.

Impact:

Short stale-authorization window.

Recommended fix:

- Add a role permission version or `updated_at` authz version to sessions.
- Invalidate sessions for users whose role changed or whose role permissions changed.
- Use fresh permission checks for all mutation endpoints.

### MF-005: Profile title HTML has an inconsistent sanitization path

Severity: **Medium**

Evidence:

- `apps/worker/services/UserService.ts` sanitizes `title_html` with a regex allowlist and preserves a raw `style` attribute value.
- Most frontend display paths sanitize again with DOMPurify, but `apps/portal/components/feature/guild-war/WarMemberDetailModal.tsx` renders `activeDetail.titleHtml` directly through `dangerouslySetInnerHTML`.

Attack scenario:

A member submits crafted title HTML that passes the backend regex sanitizer but abuses an allowed attribute or malformed markup. If that value reaches the guild-war member detail modal, it is inserted without the same DOMPurify client-side sanitization used elsewhere.

Impact:

Stored XSS risk is not proven from static review alone because the backend allowlist strips many tags and no script/event attributes are intentionally preserved. The remaining risk is still material because raw style attributes are retained and one render path trusts the stored HTML directly.

Recommended fix:

- Use one shared sanitizer policy for all title HTML display paths.
- Remove backend preservation of arbitrary `style` attributes; if colored titles are required, store structured style tokens instead of raw CSS.
- Add a regression test with malicious `title_html` payloads covering every render path that uses `dangerouslySetInnerHTML`.

### MF-006: Uploaded media validation trusts declared MIME type

Severity: **Medium**

Evidence:

- `apps/worker/services/UserService.ts` checks `file.type` against allowed image/audio types and file size limits.
- `apps/worker/services/media.ts` writes the object to R2 using the caller-provided content type when present.

Attack scenario:

A user uploads a file whose declared MIME type is allowed but whose bytes are not a valid image/audio file. The object can then be served back with a misleading content type.

Impact:

For a private guild site, the likely impact is broken media, nuisance uploads, or storage of unexpected binary content. If media serving paths or browser MIME sniffing behavior change later, this can become a stronger content-injection risk.

Recommended fix:

- Add magic-byte validation for supported image/audio formats before writing to R2.
- Normalize stored content type from validated bytes, not from `file.type`.
- Keep `X-Content-Type-Options: nosniff`, which is already set globally.

### MF-007: Sessions are bearer tokens stored directly in the database

Severity: **Medium**

Evidence:

- `apps/worker/services/auth.ts` creates session IDs with `nanoid()` and stores the session ID directly in the `sessions.id` primary key.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS, which is good.

Attack scenario:

If D1 data is exposed through backup leakage, admin console abuse, compromised tooling, or accidental export, session IDs can be replayed until expiration or invalidation.

Impact:

Database read access becomes account access. This is a common hardening gap rather than an immediate exploit path.

Recommended fix:

- Store only a SHA-256/HMAC hash of the session token in D1.
- Keep the raw token only in the cookie.
- On session lookup, hash the presented cookie and compare against stored hashes.

### MF-008: Password hashing parameters are weak for modern password storage

Severity: **Medium**

Evidence:

- `apps/worker/services/auth.ts` uses PBKDF2-SHA256 with `PBKDF2_ITERATIONS = 10_000`.

Attack scenario:

If password hashes are leaked, low iteration count reduces the cost of offline guessing.

Impact:

Guild users may reuse passwords elsewhere. Even if the portal itself is low-scale, weak password hashing increases user harm after database compromise.

Recommended fix:

- Raise PBKDF2 iterations substantially if staying with WebCrypto PBKDF2.
- Store a hash version/parameters field so future logins can upgrade hashes opportunistically.
- Consider a Worker-compatible stronger KDF only if the runtime and dependency footprint remain practical.

## Confirmed Enhancement Opportunities

### EO-001: Keep the permission model simple, but define practical guild admin tiers

Area: backend, UI, role management

The current flat permission list is appropriate for a 500-user guild. Do not add tenant isolation, temporary permissions, ABAC/PBAC, or a policy engine unless the product direction changes. Instead, formalize a small hierarchy:

- Member
- Moderator
- Officer/custom staff
- Guild Leader/Admin

Recommended enhancement:

- Add visible role-level descriptions in the admin UI.
- Add warning badges for high-risk permissions: role assignment, password reset, audit export, delete users, delete content.
- Add a role preview: "Users with this role can..."

### EO-002: Separate "view invite links" from "view invite codes"

Area: backend, UI, security

`admin.invite.view` allows viewing invite link records, including codes. For guild operations, moderators may need stats without seeing reusable codes.

Recommended enhancement:

- Split into `admin.invite.view` and `admin.invite.secret.view`, or redact codes unless `admin.invite.manage` is present.
- In the UI, show masked codes for view-only staff.

### EO-003: Make admin member actions discoverable without relying on right-click

Area: UI, admin UX

Evidence:

- `apps/portal/components/feature/admin/AdminUsersSection.tsx` places major actions such as role change, activation/deactivation, reset password, create member, and delete inside a context menu.
- Double-click opens detail, but primary destructive/admin actions are hidden behind row context interactions.

User scenario:

A guild leader or officer on a laptop trackpad or mobile viewport may not discover that right-click opens the action menu. The admin table looks like a passive list even though it contains important workflows.

Impact:

Lower task completion rate and higher support burden for common staff tasks.

Recommended enhancement:

- Add an explicit row action button or kebab menu in the table.
- Keep right-click as a power-user shortcut.
- Add a bulk action toolbar that appears after selecting users.
- Show disabled actions with short permission explanations rather than hiding all affordances.

### EO-004: Tighten admin tab/query enablement to match actual permissions

Area: frontend data flow, UX, API noise

Evidence:

- `apps/portal/hooks/data/useAdminData.ts` enables users, invite links, invite stats, and audit log queries whenever `isModerator` is true.
- Some narrower permission checks exist for status and audit archive, but most admin tabs still load based on broad admin access.
- Backend authorization protects the APIs, but the UI can trigger avoidable 403s.

Failure scenario:

A custom role with only one admin permission can enter the admin shell and cause unrelated admin queries to fire, generating banners/errors for sections the user should not use.

Impact:

Confusing permission-denied feedback, noisy logs, and poor perceived reliability.

Recommended enhancement:

- Drive each tab and query from the exact permission required for that section.
- Hide or disable tabs the user cannot access.
- Add a lightweight `/api/auth/me` or `/api/admin/capabilities` response that returns authoritative capabilities for the current user.

### EO-005: Role and permission cache should not be `staleTime: Infinity` in admin UX

Area: frontend permissions, state synchronization

Evidence:

- `apps/portal/hooks/useEffectivePermissions.ts` and `apps/portal/components/layout/AppShell.tsx` fetch roles with `staleTime: Infinity`.
- Role edits invalidate some role queries, but changes made by another admin or another browser session can remain stale.

Failure scenario:

An admin removes a permission from a role. Another open browser tab still displays old affordances and navigation until manual refresh or a mutation invalidates that query.

Impact:

UI permission desync. Server-side checks still protect the backend, but users see actions that fail.

Recommended enhancement:

- Use a finite stale time for role permission data.
- Invalidate roles on WebSocket `entity_changed` for role or user permission updates.
- Include a permission version in `/api/auth/me` and refresh when it changes.

### EO-006: Invite creation modal should keep open until mutation success

Area: UX, error recovery

Evidence:

- `apps/portal/components/feature/admin/AdminInviteSection.tsx` closes the create modal immediately after `onCreateInvite()`.

Failure scenario:

Invite creation fails due to permissions, validation, network timeout, or backend error. The modal is already closed, so the user must reopen it and re-enter values.

Impact:

Avoidable admin friction.

Recommended enhancement:

- Close the modal only after successful mutation.
- Keep input values and show inline error on failure.
- Disable the submit button while the request is pending.

### EO-007: Add explicit high-risk permission UX

Area: UI, permissions, safety

The roles UI allows toggling high-impact permissions, but role editing would benefit from stronger risk communication for a guild staff audience.

Recommended enhancement:

- Group permissions into "Content", "Member management", "Security-sensitive", and "System".
- Add danger labels for `admin.users.password`, `admin.users.role`, `admin.users.delete`, `admin.roles.manage`, `admin.audit.export`.
- Show a confirmation when saving a role that adds any high-risk permission.
- Show assigned user count and affected usernames before saving permission changes.

### EO-008: Persist admin tab state in the URL

Area: UI, navigation

Evidence:

- `apps/portal/components/pages/AdminPage.tsx` stores `activeTab` as local React state initialized to `"member"`.
- The page reads the `member` search parameter, but not the selected admin tab.

User scenario:

An officer opens the audit tab, refreshes the page, or shares the link with another admin. The recipient lands back on the member tab and must rediscover the intended section.

Impact:

Low security impact, but clear workflow friction for admin operations.

Recommended enhancement:

- Add a `tab` search parameter for admin tabs.
- Preserve existing `member` deep-link behavior.
- Use URL state for admin audit filters that users are likely to share.

### EO-009: Label "view as" as a UI preview, not an authorization mode

Area: UI, permissions

Evidence:

- `apps/portal/components/layout/ViewingAsSelector.tsx` lets admins change the frontend permission lens.
- `apps/portal/hooks/useEffectivePermissions.ts` applies the selected role to frontend permission checks.

Risk scenario:

An admin may misunderstand the selector as a real impersonation or backend authorization context. It is only a UI preview; API calls still execute as the logged-in admin.

Impact:

Potential admin confusion during testing and support. This is not a backend bypass because server-side authorization still uses the session.

Recommended enhancement:

- Rename the control to "Preview UI as".
- Add subtle helper text in the selector tooltip, not a large in-app explanation.
- Never include preview role data in API requests.

### EO-010: Make admin mobile workflows first-class

Area: UI, responsive UX

Evidence:

- Major member actions are attached to `onRowContextMenu` in `apps/portal/components/feature/admin/AdminUsersSection.tsx`.
- Admin user management is table-first and action-dense.

User scenario:

A guild officer using a phone or tablet needs to reset a password, reactivate a member, or change a role during a game session. Right-click/context-menu interactions are not discoverable or ergonomic on touch devices.

Impact:

Admin work becomes desktop-dependent even though the guild use case is likely mobile-heavy.

Recommended enhancement:

- Add an explicit row action button.
- On narrow screens, switch member rows into compact cards with the same action menu.
- Keep bulk actions available but collapse them into a bottom action bar for selected users.

### EO-011: Align admin loading and error states to exact section permissions

Area: frontend data flow

Evidence:

- `apps/portal/hooks/data/useAdminData.ts` enables role, users, invite, and audit queries based on broad `isModerator`.
- Tabs in `apps/portal/components/pages/AdminPage.tsx` are mostly always visible once `isModerator` is true.

Failure scenario:

A custom staff role with a narrow admin permission sees admin tabs whose backing queries return 403 or load warnings. The backend is correct, but the UX feels broken.

Impact:

Avoidable confusion and noisy denied requests.

Recommended enhancement:

- Gate each query by the exact permission required by that API endpoint.
- Gate each tab by the exact section capability.
- Add empty/disabled states saying which permission is required when a user can enter the admin shell but lacks a specific section.

### EO-012: Cloudflare Cache API rate limiting is acceptable but not authoritative

Area: Worker runtime, abuse prevention

Evidence:

- `apps/worker/middleware/rate-limit.ts` documents that Cache API counters are shared within the same colo and eventually consistent across colos.
- The middleware itself recommends Cloudflare native rate limiting for absolute guarantees.

Attack scenario:

A distributed attacker can send login or mutation attempts from multiple regions and exceed the intended global limit.

Impact:

For a private 500-user guild, this is acceptable as an application-level throttle, but it should not be treated as the only production abuse control.

Recommended enhancement:

- Add Cloudflare WAF/rate-limit rules for login, register, upload, and mutation-heavy paths.
- Keep app-level limits for user-friendly error responses.
- Add alerting on `RATE_LIMITED` response spikes.

### EO-013: ETag middleware hashes every successful JSON GET response

Area: Worker performance

Evidence:

- `apps/worker/middleware/etag.ts` clones every successful JSON GET response and hashes the full response body with SHA-256.
- The middleware is mounted globally for `/api/*` in `apps/worker/index.ts`.

Failure scenario:

Large roster, gallery, audit, or war-history responses pay full serialization plus clone plus hash cost on every GET, even for endpoints where client/query caching already provides most of the benefit.

Impact:

At 500 users this is unlikely to break the system, but it is unnecessary CPU and memory pressure on Worker requests.

Recommended enhancement:

- Apply ETags selectively to high-value list/detail endpoints.
- Skip ETag generation for large paginated/export-like responses.
- Consider data-version ETags based on `updated_at` or table version rather than hashing full JSON.

### EO-014: WebSocket capacity is capped at 500 total connections, not users

Area: Worker realtime, reliability

Evidence:

- `apps/worker/durable-objects/WebSocketDO.ts` rejects connections when `getWebSockets().length >= 500`.
- The target platform size is up to about 500 people.
- Browser tabs, multiple devices, and reconnect overlap can create more than one connection per user.

Failure scenario:

During a busy event, enough users open the site in multiple tabs or devices to exhaust the global Durable Object connection cap. Later users lose realtime updates and fall back to polling.

Impact:

Realtime freshness degrades near the intended maximum guild size.

Recommended enhancement:

- Raise the global cap above expected user count or enforce a per-user/per-tab connection policy.
- Attach authenticated user metadata to accepted WebSockets so connection accounting is user-aware.
- Emit metrics for connection count, rejection count, and fallback polling rate.

### EO-015: Push notifications are best-effort and have no delivery semantics

Area: realtime, reliability

Evidence:

- `apps/worker/services/push.ts` catches publish failures and logs them without failing the original mutation.
- `apps/portal/hooks/useNotificationSync.ts` has fallback polling, which is good.

Failure scenario:

A role change, announcement, or event update succeeds, but the push publish fails. Open clients can remain stale until polling or manual refresh.

Impact:

Acceptable for non-critical guild notifications, but not suitable for security-sensitive revocation UX.

Recommended enhancement:

- Keep non-critical push best-effort.
- For permission or role changes, explicitly invalidate frontend queries and sessions through authoritative fetch/version checks rather than relying on push.
- Track publish failure counts in the admin status area.

### EO-016: Staging deployment is not production-ready

Area: DevOps, environment readiness

Evidence:

- `apps/worker/wrangler.jsonc` has a staging D1 `database_id` placeholder: `STAGING_DB_ID_HERE`.
- The root `wrangler.jsonc` is marked as legacy while package scripts use `apps/worker/wrangler.jsonc`.

Failure scenario:

A maintainer deploys staging using incomplete config or edits the legacy root config expecting it to affect actual deployments.

Impact:

Deployment confusion, broken staging, and environment drift.

Recommended enhancement:

- Complete the staging D1 binding before relying on staging.
- Add a deployment preflight script that rejects placeholder IDs.
- Document the canonical Worker config path in README and developer docs.

### EO-017: Audit archive process needs verification and restore tooling

Area: operations, auditability

Evidence:

- `apps/worker/crons/audit-archive.ts` exports a whole month to a gzipped NDJSON object and manifest in R2, then deletes matching D1 rows.
- If the R2 object already exists, the cron deletes matching D1 rows without revalidating the manifest content.

Failure scenario:

An incomplete or stale archive object exists in R2. The cron treats it as archived and deletes local audit rows.

Impact:

For a guild app, this is an operational integrity risk rather than a compliance blocker. It still affects incident review and admin accountability.

Recommended enhancement:

- Verify manifest row count and checksum before deleting D1 rows.
- Store a checksum in the manifest.
- Add a restore/readback tool for archive months.
- Chunk large months if audit volume grows.

### EO-018: Database model is good for guild scale, but role listing has avoidable O(R x P) processing

Area: database, backend maintainability

Evidence:

- `apps/worker/services/AdminService.ts` loads roles and role permission rows, then filters permission rows per role when mapping role payloads.
- Current scale makes this harmless.

Impact:

Low. This will not matter for a handful of guild roles, but it is an easy cleanup if role management grows.

Recommended enhancement:

- Pre-group permission rows by `role_id` before mapping roles.
- Keep the existing normalized `roles` and `role_permissions` tables.
- Do not add role hierarchy graphs, wildcard permissions, or inheritance for this product size.

### EO-019: Testing should add targeted security and admin UX regressions

Area: QA, maintainability

Evidence:

- The repository already includes route permission mapping tests, router access-policy tests, frontend service tests, event tests, cron tests, and component tests.

Recommended enhancement:

- Add backend tests for assigning a lower-level custom role that contains high-risk permissions.
- Add tests denying same-level and higher-level password resets.
- Add tests that admin queries are not enabled without their exact permission.
- Add a UI test that invite creation modal stays open on mutation failure.
- Add sanitizer tests for `title_html` across all display components.
- Add WebSocket tests for multi-tab connection behavior and rejection fallback.

## Architecture Critique

The platform is correctly biased toward a pragmatic monolith-on-Workers model. For a private guild portal, Hono + D1 + R2 + Durable Objects is a better fit than microservices, external policy engines, or enterprise IAM tooling. The current system should stay simple.

The main architectural weakness is not lack of enterprise complexity. It is inconsistent ownership of authorization and safety behavior:

- Backend routes enforce permissions with middleware, but business-level constraints live in service methods.
- Frontend route access, tab access, query enablement, and "view as" preview all perform their own permission interpretation.
- Audit logging is treated as an async side effect even for security-sensitive admin actions.
- Realtime invalidation is helpful for UX, but it is not authoritative enough for role revocation or security state.

Recommended architecture direction:

- Keep RBAC flat and explicit.
- Add a small "sensitive permission" registry shared by backend and frontend.
- Add an authoritative capability/session response that includes role, permissions, role version, and session expiry.
- Make privileged mutations use service-layer authorization checks even when route middleware already checked coarse permissions.
- Treat audit writes for sensitive admin actions as part of the mutation contract.

## Security Assessment

Strong points:

- Session cookies are `HttpOnly` and `SameSite=Lax`.
- Mutating API requests require `Origin` and `X-Requested-With`.
- Admin routes are protected server-side, not only hidden in the UI.
- Role-level checks exist for role changes, deletion/deactivation, and password reset.
- Security headers include `nosniff`, HSTS, frame denial, and a CSP.

Weak points:

- Custom role delegation can become unsafe when role level and permission content drift.
- Session tokens should be hashed at rest.
- Password hashing parameters need modernization.
- `title_html` sanitization is inconsistent.
- Uploaded media needs byte-level validation.
- Critical audit events should not be best-effort.

No finding in this audit proves an immediate unauthenticated full compromise path. The higher-risk items are insider/admin-abuse and compromised-staff scenarios, which are realistic for a guild staff model.

## UX Assessment

The portal has a strong page/domain structure and meaningful admin grouping. The most important UX gaps are admin workflow discoverability and state continuity:

- Admin member actions are hidden behind context-menu behavior.
- Admin tabs and filters are not URL-addressable.
- Invite creation loses form state on failure.
- Permission preview can be misunderstood as impersonation.
- Custom roles can produce confusing tabs and 403s because query enablement is broader than backend capabilities.

The UI does not need a redesign. It needs surgical workflow improvements around admin work, mobile/touch use, and permission feedback.

## Backend/API Assessment

The backend is in good shape for the target scale. Shared schemas, service classes, route permission tests, and D1 indexes are all positive signals.

The main backend improvements are:

- Make high-risk authorization checks content-aware, not just level-aware.
- Hash sessions at rest.
- Improve password hash upgrade strategy.
- Make critical audit writes durable.
- Normalize upload validation around file bytes.
- Reduce global ETag work on large JSON endpoints.

The codebase should avoid introducing microservices or a separate policy service. A clean shared permission/capability module is enough.

## Worker/Infrastructure Assessment

Cloudflare Workers are a reasonable deployment target for this portal. D1 and R2 should comfortably handle 500 users. Durable Object realtime is practical, but the current global connection cap is too close to the expected user ceiling.

Operational readiness gaps:

- Staging config is incomplete.
- Root and worker Wrangler configs can confuse maintainers.
- Cache API rate limiting is not a global abuse-control guarantee.
- Audit archive deletion needs archive verification.
- Realtime push lacks metrics and delivery visibility.

## Database Assessment

The schema is appropriately normalized for the product:

- `roles` + `role_permissions` is clear.
- `users` + `member_profiles` separates identity from profile data.
- `sessions` has expiry indexes.
- Invite and audit tables have useful indexes for expected access patterns.

There is no reason to introduce tenant partitioning, role inheritance graphs, wildcard permissions, or ABAC policy tables for this guild use case. The practical database work is mostly integrity and operations:

- Session token hashing.
- Audit archive verification.
- Role permission versioning.
- Small query/mapper cleanup in role listing.

## Priority Matrix

| Priority | Item | Severity | Area | Target |
| --- | --- | --- | --- | --- |
| P0 | Fix `title_html` sanitizer inconsistency | Medium | Security/UI | Before broader rollout |
| P0 | Add high-risk permission grantability guard | Medium-High | RBAC | Before delegating custom roles |
| P0 | Make critical audit writes durable for sensitive admin actions | Medium-High | Security/Ops | Before relying on audit trail |
| P1 | Hash sessions at rest | Medium | Auth | Next security hardening pass |
| P1 | Raise/version password hashing | Medium | Auth | Next auth migration |
| P1 | Add byte-level media validation | Medium | Uploads | Next media hardening pass |
| P1 | Add authz version/session invalidation for role changes | Medium | RBAC/Auth | Next permission pass |
| P1 | Gate admin tabs and queries by exact permission | Medium | Frontend/API | Next admin UX pass |
| P2 | Add explicit admin row actions and mobile admin cards | Medium | UX | Next UI polish pass |
| P2 | Persist admin tab/filter state in URL | Low-Medium | UX | Next navigation pass |
| P2 | Raise or redesign WebSocket connection cap | Medium | Realtime | Before 500-user events |
| P2 | Add staging/deploy preflight checks | Medium | DevOps | Before staging use |
| P3 | Optimize global ETag behavior | Low-Medium | Worker performance | When list payloads grow |
| P3 | Pre-group role permission rows | Low | Backend cleanup | Opportunistic |

## 30/60/90 Day Roadmap

### First 30 days

- Fix `title_html` sanitization and add tests.
- Add high-risk permission registry and role assignment restrictions.
- Change critical admin audit logging from best-effort to required.
- Gate admin tabs/queries by exact permissions.
- Fix invite creation modal error recovery.
- Add explicit row action menu in admin member table.

### 31-60 days

- Hash session tokens at rest.
- Add password hash parameter versioning and migration-on-login.
- Add byte-level media validation.
- Add role/session authz versioning and invalidate sessions after role changes.
- Complete staging config and add deployment preflight checks.
- Add targeted tests for RBAC, password reset boundaries, sanitizer behavior, and admin query enablement.

### 61-90 days

- Add WebSocket connection metrics and revise the global 500-connection cap.
- Add audit archive checksums, verification, and restore/readback tooling.
- Tune ETag generation for large JSON endpoints.
- Add Cloudflare WAF/rate-limit rules for auth, upload, and mutation paths.
- Improve admin mobile workflows with responsive action cards.

## Enterprise Readiness Score

For a 500-person game guild portal: **7/10**.

The system is structurally appropriate and does not need enterprise IAM complexity. It needs hardening around staff/admin safety, audit durability, and operational visibility.

For a true enterprise multi-tenant SaaS product: **4/10**.

It lacks tenant isolation, formal policy evaluation, immutable audit storage, centralized secrets/identity integration, SIEM pipelines, and stronger compliance workflows. Those are intentionally out of scope for the stated guild use case.

## Final Risk Assessment

Overall risk for the intended guild platform is **Medium**.

The most realistic threat is not anonymous internet compromise. The realistic risks are:

- Compromised moderator/officer account.
- Over-delegated custom staff role.
- Admin action without durable audit evidence.
- Stale permission state after role changes.
- Stored-content weakness through profile title HTML.
- Operational mistakes in staging/deployment or audit archive handling.

Recommended posture:

- Do not redesign into enterprise IAM.
- Do not add temporary permissions, tenant layers, ABAC/PBAC, or microservices.
- Do tighten the RBAC edges, admin UX, audit durability, session security, upload validation, and Worker operations.

## Whole-Site Supplemental Audit Pass

This section extends the first audit across the full website surface: public routes, dashboard, events, roster, guild war, gallery, wiki, command search, admin console, API read models, Worker routes, and client state.

### WS-001: Guild war export, analytics, and detail data are publicly readable

Severity: **Medium-High**

Evidence:

- `apps/worker/routes/guild-war.ts` exposes `GET /api/guild-war/export` without `requirePermission` or session checks.
- `GET /api/guild-war/analytics`, `GET /api/guild-war/history/:id`, and `POST /api/guild-war/history/batch` are also public.
- `apps/worker/services/GuildWarService.ts` export/detail methods include war teams, member stats, usernames, pool members, results, duration, notes, and analytics settings.

Attack/failure scenario:

Anyone who can reach the site can export up to 5000 guild war history rows or query detailed member performance data. Even if the guild wants public-facing content, bulk export and analytics are more sensitive than viewing a single public page.

Impact:

Competitive intelligence leak, member performance privacy exposure, and easy scraping of player history. This is the strongest whole-site data exposure finding.

Recommended fix:

- Require a session for guild war history detail, batch detail, analytics, and export.
- Require `guildwar.history.edit` or a new `guildwar.history.export` permission for export.
- If public history is intentional, split public summary endpoints from authenticated detail/export endpoints.
- Rate-limit export separately and audit export usage.

### WS-002: Public roster and member stats expose broad member directory data

Severity: **Medium**

Evidence:

- `apps/worker/routes/users.ts` allows unauthenticated `GET /api/users` and `GET /api/users/stats`.
- `UserService.listUsers()` returns active member usernames, roles, classes, power, media keys, bio/title fields, and badges while hiding notes/private fields for unauthenticated users.
- `RosterPage.tsx`, `DashboardPage.tsx`, and `CmdKSearch.tsx` all consume public member list data.

Attack/failure scenario:

A non-member can enumerate the guild roster and scrape member identifiers, classes, relative strength, profile metadata, and media references.

Impact:

For a guild website this may be intentional community visibility. If the portal is meant to be semi-private, this is a data-minimization issue.

Recommended fix:

- Decide explicitly whether roster is public, member-only, or external-preview-only.
- If public, expose a reduced roster DTO and keep full profile metadata behind session.
- Add a feature flag for public roster/search visibility.

### WS-003: Global command search bulk-loads cross-domain datasets

Severity: **Medium**

Evidence:

- `apps/portal/components/layout/CmdKSearch.tsx` enables `fetchSearchData()` whenever the modal opens.
- `apps/portal/api/queries/search.ts` issues parallel requests for users, events, announcements, wiki articles, guild war history, and gallery items.

Failure scenario:

Opening search triggers multiple list requests, even if the user is only looking for one item. On a populated guild, this turns a single UI action into broad API and Worker load.

Impact:

Unnecessary latency, duplicated fetches, and higher cost/noise. It also amplifies any public data exposure because search centralizes scraping targets.

Recommended fix:

- Replace bulk hydration with a backend `/api/search?q=` endpoint that enforces visibility rules centrally.
- Require at least 2 characters before broad search.
- Return scoped, redacted search results based on session/permissions.
- Cache results by query, not only by "search modal opened".

### WS-004: Dashboard overfetches full user list and batched event/war details

Severity: **Low-Medium**

Evidence:

- `apps/portal/components/pages/DashboardPage.tsx` fetches upcoming events, guild war history, all users, user stats, recent war details, and upcoming event details.
- User list data is used for mapping participant/member names and MVPs.

Failure scenario:

The dashboard becomes the most expensive default page because it aggregates multiple domains and fetches the full user list even when only a small subset is needed.

Impact:

At 500 users this is manageable, but the first authenticated page can feel slower than necessary and can create unnecessary D1 reads.

Recommended fix:

- Add a backend dashboard summary endpoint that returns exactly the cards' data.
- For event participant display, return usernames with event detail batch results.
- For war MVPs, return display names in the war detail batch.
- Keep the current implementation only if simplicity is preferred over request minimization.

### WS-005: Page access model is mixed public/private and needs a documented product decision

Severity: **Medium**

Evidence:

- Router public routes include dashboard, events, roster, announcements, guild war, gallery, wiki, settings, and tools.
- Only profile and admin are under the authenticated route branch.
- Many corresponding backend read endpoints are also public.

Failure scenario:

The product team assumes the portal is private because it has login and invite registration, but the actual information architecture exposes most read-only guild content publicly.

Impact:

Misaligned privacy expectations. This is not necessarily a bug, but it is a major product/security decision that should be explicit.

Recommended fix:

- Define route visibility classes: public, member-only, staff-only, admin-only.
- Document each route and API endpoint in a visibility matrix.
- Add route metadata and API tests that assert the intended public/private boundary.
- Consider a "public website mode" feature flag.

### WS-006: Guild war active data is hidden from guests in frontend but public in backend

Severity: **Medium**

Evidence:

- `apps/portal/hooks/data/useGuildWarData.ts` disables `activeQuery` when `hasSession` is false.
- `apps/worker/routes/guild-war.ts` allows unauthenticated `GET /api/guild-war/active`.

Attack scenario:

A guest cannot see active war data through the normal frontend flow, but can call the backend endpoint directly with an event ID.

Impact:

Hidden-but-accessible data pattern. Current active war data includes teams, pool members, and participants, which may expose tactical planning.

Recommended fix:

- Require session for `/api/guild-war/active`.
- If public history remains public, keep active war planning private.
- Add route permission tests for guest denial.

### WS-007: Important filter/navigation state is inconsistently URL-addressable

Severity: **Low-Medium**

Evidence:

- Events use URL search state for view/filter/detail.
- Guild war has partial tab/war-name search state but internal selections live in Zustand.
- Roster filters persist in localStorage, not URL.
- Admin tab state is local component state.
- Gallery filters are local component state.
- Wiki slug is URL-addressable, but filters and editor pane state are local.

Failure scenario:

Users cannot reliably share a filtered roster/gallery/admin view or return to the same operational context after refresh.

Impact:

Workflow friction and poor support/debugging ergonomics.

Recommended fix:

- Keep events as the reference pattern.
- Add URL search params for admin tab, gallery filters, roster filters, and guild-war selected tab/history.
- Keep localStorage only for personal preferences, not workflow state.

### WS-008: Feature pages perform permission checks in multiple frontend styles

Severity: **Low-Medium**

Evidence:

- Events, Wiki, Gallery, Guild War, Roster, Admin, and AppShell each compute `canManage`/visibility locally using `useEffectivePermissions()` or role-derived checks.
- Backend route middleware remains authoritative, but frontend affordances are fragmented.

Failure scenario:

A new permission or custom role is added and one page updates its UI correctly while another page still shows hidden/disabled/incorrect controls.

Impact:

Permission UX drift and avoidable 403s. Security is mostly protected server-side, but developer experience suffers.

Recommended fix:

- Add a central frontend capability map keyed by feature/action.
- Reuse it for nav, tabs, page actions, and query enablement.
- Add tests that each major page hides staff-only controls for member/external roles.

### WS-009: Admin API debug/test tooling appears in production code path

Severity: **Medium**

Evidence:

- Admin feature files include `AdminApiDebugConsole.tsx`, `AdminApiTestEngine.ts`, and status/test components.
- `AdminApiTestEngine.ts` contains broad API execution and cleanup flows.

Failure scenario:

If these tools are reachable in production admin UI, a privileged admin can run broad synthetic operations that create/delete content or stress endpoints. Even if intended for diagnostics, this is high-blast-radius tooling.

Impact:

Operational footgun and insider-risk multiplier.

Recommended fix:

- Gate debug/test tools behind `ENVIRONMENT !== "production"` or a dedicated `admin.system.test` permission.
- Clearly separate read-only status views from mutating test engines.
- Audit every use of test/debug tools.

### WS-010: Gallery upload queue is sequential and client-heavy

Severity: **Low-Medium**

Evidence:

- `GalleryPage.tsx` converts each image to WebP in the browser and uploads tasks sequentially.
- Upload progress is represented per queue item, but there is no resumable upload or batch endpoint transaction.

Failure scenario:

A user selects many large images on a mid-range mobile device. Client conversion blocks resources, uploads take long, and partial completion leaves mixed queue state.

Impact:

Poor mobile performance and recovery friction. Server scale is fine, but user experience can degrade sharply.

Recommended fix:

- Limit concurrent uploads to a small configurable number.
- Show per-file conversion/upload phases.
- Add retry for failed tasks.
- Consider server-side validation/transcoding only if browser conversion proves unreliable.

### WS-011: Wiki category query uses infinite stale time

Severity: **Low-Medium**

Evidence:

- `apps/portal/components/pages/WikiPage.tsx` loads categories with `staleTime: Infinity`.

Failure scenario:

One moderator changes category names/order while another user's wiki category list remains stale until refresh or manual invalidation.

Impact:

Low security impact, but content organization desync.

Recommended fix:

- Use finite stale time for categories.
- Invalidate `queryKeys.wiki.categories()` on category create/update/delete and WebSocket `wiki` entity changes.

### WS-012: Public settings/tools routes may confuse unauthenticated users

Severity: **Low**

Evidence:

- `/settings` and `/tools` are public routes in `router.tsx`.
- AppShell hides navigation only for login/register, so guests can navigate to utility pages.

Failure scenario:

Guests can change local settings or use tools before understanding that most participation actions require login.

Impact:

Low. This is mostly onboarding clarity.

Recommended fix:

- Keep public if intentional, but label unauthenticated state clearly.
- Consider moving guild-specific tools behind session if they use internal guild assumptions.

### WS-013: Backend service size and raw SQL usage concentrate risk in complex domains

Severity: **Medium**

Evidence:

- `EventService.ts` and `GuildWarService.ts` are large domain services with mixed query, validation, mutation, audit, and export responsibilities.
- `EventService.ts` uses multiple `(this.db as any)` casts.
- `GuildWarService.ts` mixes active team editing, history, analytics, export, and settings reads.

Failure scenario:

Changes to one workflow accidentally affect another because unrelated concerns share a large service class and raw SQL batching.

Impact:

Maintainability and regression risk, especially around events and guild war where workflows are central to the site.

Recommended fix:

- Split EventService into event CRUD, participants, media, polls/raffles, recurrence/templates.
- Split GuildWarService into active war, history, analytics, and export modules.
- Keep route contracts stable while refactoring internally.
- Add service-level tests around each extracted module before changing behavior.

### WS-014: Public media proxy endpoints rely only on key prefixes

Severity: **Medium**

Evidence:

- `/api/users/image`, `/api/events/image`, `/api/announcements/image`, `/api/wiki/image`, and `/api/gallery/image` check only object key prefixes before reading from R2.

Attack scenario:

Anyone who obtains or guesses a valid media key under an allowed prefix can retrieve the object, regardless of whether the owning entity is public, archived, deleted, or private.

Impact:

Media access control is coarse. This is acceptable for intentionally public media, but not for private profile/audio/event attachments or archived content.

Recommended fix:

- Decide which media classes are public.
- For private media, validate object ownership/entity visibility before R2 read.
- Use signed short-lived URLs or opaque media IDs if keys should not be direct access handles.

### WS-015: Error and notification state is mostly client-local and weak for operations

Severity: **Low-Medium**

Evidence:

- Offline banners and permission banners are client-local.
- Notification history and last-seen state are stored in localStorage.
- Admin status logs are also persisted locally in the browser.

Failure scenario:

An admin switches devices or clears storage and loses local notification/status context. Operational diagnostics are not shared across staff.

Impact:

Low for casual use, but weak for incident response.

Recommended fix:

- Keep user notification read-state local if acceptable.
- Move operational health history and system events to backend error/audit logs.
- Show backend-sourced recent error log summaries in Admin Status.

### WS-016: Route loading fallback is generic and loses page context

Severity: **Low**

Evidence:

- `router.tsx` uses a generic spinner for lazy route loading.
- Individual pages often have richer skeleton states after module load.

Failure scenario:

On slow devices/networks, users see a generic loading spinner before landing in domain-specific skeletons.

Impact:

Polish and perceived performance issue.

Recommended fix:

- Use route-level skeletons matching the target domain where practical.
- Preload likely next routes from navigation hover/focus.

### WS-017: LocalStorage state lacks user scoping

Severity: **Low-Medium**

Evidence:

- Roster filters, events view mode, notification history, preferences, admin health logs, and other local state use global localStorage keys.

Failure scenario:

Two users share the same browser. One user's view preferences, notification read state, or admin status logs affect the next user's experience.

Impact:

Mostly UX privacy and confusion. It can matter more on shared guild/officer machines.

Recommended fix:

- Prefix user-specific localStorage keys with user ID where state is account-specific.
- Keep truly device-level settings, such as theme/locale, global.

### WS-018: Read API visibility is not encoded in route tests

Severity: **Medium**

Evidence:

- Existing `permission-routes.test.ts` focuses on several protected mutation/delete mappings.
- Public/private read boundary is spread across route implementation, not a single tested matrix.

Failure scenario:

A future route is added public by default or a private route loses its guard without tests failing.

Impact:

Regression risk around broken access control.

Recommended fix:

- Add a route visibility matrix test for every API route.
- Explicitly assert anonymous access allowed/denied for each read endpoint.
- Include media, export, analytics, batch-detail, and comment endpoints.

### WS-019: Guest experience is not explicitly designed despite many public pages

Severity: **Low-Medium**

Evidence:

- Public routes include content-heavy pages, but participation actions depend on session.
- Pages such as gallery/events/roster infer guest state mostly through disabled or missing actions.

Failure scenario:

A guest browses the site but does not understand what requires registration, what is public, and how invite-only onboarding works.

Impact:

Onboarding friction and unclear conversion path for recruits.

Recommended fix:

- Add consistent guest affordances: "Sign in to join", "Invite required", and "Ask an officer for an invite."
- Keep these as compact contextual prompts, not marketing blocks.
- Ensure disabled actions explain the required state.

### WS-020: Cross-domain invalidation misses some entity types

Severity: **Low-Medium**

Evidence:

- `AppShell.handlePushMessage()` invalidates announcements, events, wiki, gallery, guild war, and member profile.
- It does not invalidate roles, badges, admin audit/status, or analytics settings on push.

Failure scenario:

Admins edit roles, badges, analytics settings, or audit-relevant state and other open clients continue to display stale data.

Impact:

State desync in admin/staff workflows.

Recommended fix:

- Add push entity types for roles, badges, analytics settings, and admin/system status.
- Invalidate exact query keys for those domains.
- Do not rely on push for security; use session/authz versioning for permissions.

## Entire Website Audit & Optimization Master Plan

This is the consolidated plan for auditing and improving the whole Guild Management Portal in one pass. It is scoped for a game guild platform of roughly 500 users, not for a multi-tenant enterprise SaaS product. The goal is a polished, secure, fast, maintainable guild portal without adding unnecessary IAM or distributed-systems complexity.

### Master Objectives

1. Establish the intended visibility model for every route and API.
2. Remove public access to data that should be member-only or staff-only.
3. Harden role, session, password, upload, audit, and permission invalidation flows.
4. Improve staff/admin workflows so common tasks are visible, fast, and mobile-usable.
5. Reduce unnecessary cross-domain overfetching on dashboard, command search, and guild war analytics.
6. Make frontend permission checks consistent and backed by exact backend capabilities.
7. Add route visibility, RBAC, sanitizer, upload, and critical workflow regression tests.
8. Improve deployment readiness, staging safety, Worker rate limits, WebSocket capacity, and audit archive integrity.

### Route And Page Coverage Plan

| Area | Current Role | Main Risks | Required Plan |
| --- | --- | --- | --- |
| Login | Public auth entry | Weak brute-force posture if only app rate limit is used | Keep public; add Cloudflare WAF/rate limit; improve lockout/alerting if abuse occurs |
| Register | Invite-only public | Invite code exposure, poor failed-invite recovery | Keep public; rate-limit verify/register; redact invite details; clarify expired/revoked states |
| Dashboard | Public root route | Overfetches users/events/war data; privacy ambiguity | Decide public vs member-only; add dashboard summary endpoint; reduce full roster dependency |
| Announcements | Public read, staff write | Draft/scheduled visibility correctness depends on service logic | Keep public only for published; add visibility tests for draft/scheduled/archived states |
| Events | Public read, member interaction, staff management | Public event detail may expose planning; duplicated detail fetching | Define which event fields are public; keep join/vote/session-gated; add summary/detail split |
| Roster | Public read | Member enumeration and profile scraping | Decide public vs member-only; add redacted public roster DTO if public remains |
| Guild War Active | Frontend session-gated, backend public | Hidden active team planning can be directly fetched | Make active endpoint member-only or staff-only |
| Guild War History | Public read | War/member performance scraping | Keep summary public only if desired; require session for details, analytics, batch, export |
| Gallery | Public read, uploader write/manage | Public media scraping; client-heavy uploads | Define public media policy; add media authorization for private classes; improve upload queue |
| Wiki | Public read, staff write | Category stale data; article visibility expectations | Keep public if it is guild handbook; finite stale time; visibility tests |
| Tools | Public utility | Guest confusion if guild-specific | Either keep clearly public or move guild-specific tools behind session |
| Settings | Public local prefs | Guest can change local preferences before joining | Acceptable; clarify local-only behavior |
| Profile | Auth-only | Self-edit and media upload hardening | Keep auth-only; add upload byte validation and title sanitizer consistency |
| Admin | Staff-only | Hidden actions, exact permission mismatch, powerful debug/test tooling | Exact capability-gated tabs; explicit action menus; gate debug/test tools |

### API Visibility Plan

Create a route visibility matrix and test every route against it.

| API Group | Public Allowed | Member Required | Permission Required | Notes |
| --- | --- | --- | --- | --- |
| `/api/auth/login` | Yes | No | No | Add WAF/rate-limit rule |
| `/api/auth/register/:inviteCode` | Yes | No | No | Keep invite-only |
| `/api/auth/check-username` | Yes | No | No | Already rate-limited; monitor enumeration |
| `/api/auth/me` | No | Yes | No | Correct |
| `/api/users` | Product decision | Maybe | `admin.users.view` for private fields | Add explicit public DTO if public |
| `/api/users/:id` | No | Yes | No/self/staff rules | Correctly session-gated |
| `/api/users/*/media/*` | No | Yes | Self or admin edit | Add byte validation |
| `/api/events` read | Product decision | Maybe | Staff sees management fields | Add visibility tests |
| `/api/events/*/join`, vote | No | Yes | No | Correct |
| `/api/events` write/archive/delete | No | Yes | Event permissions | Correct |
| `/api/announcements` read | Yes for published | Maybe for drafts | Staff permissions | Add tests |
| `/api/wiki` read | Yes if handbook public | Maybe | Staff permissions for mutations | Add tests |
| `/api/gallery` read | Product decision | Maybe | Gallery upload/manage permissions for writes | Define policy |
| `/api/guild-war/active` | No | Yes or staff | `guildwar.teams.edit` for active planning if sensitive | Fix mismatch |
| `/api/guild-war/history` summary | Product decision | Maybe | No if public summary | Redact if public |
| `/api/guild-war/history/:id` | No | Yes | Optional staff for full details | Fix |
| `/api/guild-war/history/batch` | No | Yes | Optional staff | Fix |
| `/api/guild-war/analytics` | No | Yes/staff | `admin.analytics.view` or guild-war analytics permission | Fix |
| `/api/guild-war/export` | No | Yes | New `guildwar.history.export` or staff permission | Fix |
| `/api/admin/*` | No | Yes | Exact admin permissions | Mostly correct; tighten query enablement |
| Media proxy endpoints | Product decision | Depends on media class | Entity visibility check where private | Prefix-only checks are too coarse |

### UX And Navigation Plan

Guest journey:

- Add clear guest-state prompts on Events, Gallery, Roster, Wiki, and Guild War where actions require login.
- Avoid large marketing sections; use compact contextual prompts near disabled actions.
- Make invite-only onboarding explicit from Login and Register error states.
- Decide whether Dashboard should be public. If public, show a public summary; if member-only, redirect to login with return path.

Registered member journey:

- Dashboard should prioritize "my signups", upcoming events, unread announcements, and profile completion.
- Events should keep the current strong URL-driven workbench pattern.
- Roster should support shareable filters and avoid localStorage-only workflow state.
- Gallery should make upload status recoverable and retryable.
- Wiki should preserve selected article and filters through URLs where useful.

Moderator/officer journey:

- Replace hidden/right-click admin actions with visible row action buttons.
- Add mobile-friendly admin member cards or responsive table actions.
- Show disabled staff actions with exact missing-permission explanations.
- Add high-risk action confirmations for role changes, password reset, delete/deactivate, audit export, and permanent deletion.
- Add URL-addressable admin tabs and filters.

Guild leader/super admin journey:

- Add role preview: users affected, high-risk permissions, and what the role can do.
- Add role assignment warnings when a target role includes high-risk permissions.
- Add admin status summary that distinguishes production health from local browser diagnostics.
- Gate test/debug tools behind non-production or a special permission.

Support staff journey:

- Provide read-only audit/status access without exposing invite codes, password reset, or role management.
- Split "view invite stats" from "view invite secret/code".
- Mask sensitive identifiers where support does not need full values.

### Permission And RBAC Plan

Do not add role inheritance, wildcard permissions, temporary permissions, ABAC, PBAC, or a policy engine. The right model for this product is flat RBAC with clearer guardrails.

Required changes:

- Add shared high-risk permission registry:
  - `admin.users.password`
  - `admin.users.role`
  - `admin.users.delete`
  - `admin.roles.manage`
  - `admin.audit.export`
  - future export/system-test permissions
- Enforce role assignment by both role level and permission contents.
- Add exact capability mapping for admin tabs, buttons, queries, and route access.
- Add role/session authorization versioning so permission changes invalidate stale sessions.
- Add backend tests for every protected mutation and sensitive read/export endpoint.

Recommended role tiers:

- Public guest: published/read-only public content only.
- Member: profile and event participation.
- Moderator: content moderation and selected event/gallery/wiki capabilities.
- Officer: member management, guild war operations, limited admin read access.
- Guild leader/admin: roles, password reset, destructive actions, audit export, system status.

### Security Hardening Plan

Authentication/session:

- Hash session tokens at rest.
- Add session/authz version checks.
- Invalidate all sessions after password change/reset and role changes where appropriate.
- Raise PBKDF2 iterations and add password hash parameter versioning.
- Add Cloudflare WAF/rate limits for login, register, username check, uploads, and heavy mutations.

Access control:

- Make guild-war active/detail/export/analytics member-only or permission-gated.
- Add route visibility tests for all public/private reads.
- Keep backend checks authoritative; frontend hiding is UX only.
- Ensure every destructive action has service-layer validation, not only route middleware.

Input/output safety:

- Replace regex HTML sanitizer for `title_html` with one shared sanitizer policy.
- Remove arbitrary style preservation or store structured title style tokens.
- Ensure every `dangerouslySetInnerHTML` path sanitizes with the same policy.
- Add magic-byte validation for uploaded images/audio.
- Normalize R2 content type from validated bytes.

Media:

- Decide which media are public.
- For private media, verify entity visibility before R2 reads.
- Consider opaque media IDs or signed URLs if direct keys should not be exposed.

Audit:

- Await audit writes for role changes, password resets, user delete/deactivate, permission edits, and export actions.
- Add audit reason capture for high-risk admin actions.
- Add audit archive checksum, manifest verification, and restore/readback tooling.

### Backend And API Architecture Plan

Keep the monolith. Do not split into microservices.

Refactor targets:

- Split `EventService` into:
  - event CRUD
  - participants/signups
  - attachments/media
  - polls/raffles
  - recurrence/templates
- Split `GuildWarService` into:
  - active war team planning
  - history CRUD
  - analytics
  - export
- Add a small shared authorization/capability module used by routes and frontend metadata.
- Add a backend dashboard summary endpoint to reduce cross-domain dashboard fetching.
- Add backend search endpoint to replace command-search bulk hydration.

API response improvements:

- Define public vs authenticated DTOs.
- Avoid returning internal IDs/keys when public users do not need them.
- Add consistent pagination limits and tests for max values.
- Add consistent ETag/version strategy only on useful endpoints.

### Database And Data Integrity Plan

Keep the current D1 schema style. It is appropriate for 500 users.

Required improvements:

- Store hashed session tokens.
- Add role permission/authz version field or equivalent invalidation mechanism.
- Add audit archive checksums and restore/readback process.
- Add indexes only if query plans show scans on growing tables.
- Add route/query tests for large pagination and batch limits.

Performance-minded cleanup:

- Pre-group role permission rows when listing roles.
- Avoid full roster fetches where only names are needed.
- Add summary tables or cached computed results only if dashboard/guild-war analytics become slow.

Do not add:

- tenant partitioning
- role inheritance graph tables
- wildcard permission tables
- CQRS/event sourcing
- distributed policy database

### Frontend Architecture Plan

Frontend is structurally strong, but several pages carry too much orchestration.

Improvements:

- Keep page components as orchestrators, but move page-specific query clusters into `hooks/data`.
- Centralize capability checks and section metadata.
- Use URL state for workflow state:
  - admin tab/filter/member
  - roster search/class/sort
  - gallery type/date/search/order
  - guild-war tab/history selection
  - wiki filter/archive/pinned/category
- Scope localStorage keys by user ID where account-specific.
- Keep theme/locale device-level.
- Replace global command-search bulk loading with query-based backend search.
- Add route-specific skeleton fallbacks instead of only generic spinner.

Performance:

- Avoid dashboard full roster dependency.
- Avoid repeated all-users fetches across Dashboard, Events, Guild War, Roster, and CmdK when a smaller DTO would do.
- Keep lazy-loaded routes and heavy analytics lazy loading.
- Add bundle analysis before optimizing icons/charts; do not guess.

### Worker And Infrastructure Plan

Cloudflare stack is appropriate. Harden the edges.

Worker runtime:

- Move app-level rate limiting to "friendly throttle" role and add Cloudflare WAF/rate-limit rules for real abuse control.
- Make ETag middleware selective; skip large JSON/export-like responses.
- Raise or redesign the Durable Object WebSocket connection cap above expected user count.
- Attach authenticated user metadata to WebSocket connections.
- Add metrics for WebSocket connections, rejects, fallback polling, and publish failures.

Deployment:

- Complete staging D1 binding.
- Add preflight that fails deployment on placeholder IDs/secrets.
- Make `apps/worker/wrangler.jsonc` the only active config or clearly prevent root config misuse.
- Document production/staging deployment steps.

Operations:

- Add backend-sourced admin health history.
- Keep error logs server-side, not only browser localStorage.
- Add runbooks for D1 backup/restore, R2 audit archive restore, and incident review.

### QA And Test Plan

Add a comprehensive regression suite by risk area.

RBAC tests:

- Anonymous allowed/denied matrix for every route.
- Member/moderator/officer/admin expected access matrix.
- Custom role assignment with sensitive permissions denied unless authorized.
- Same-level and higher-level password reset denied.
- Role deletion/permission changes invalidate affected sessions.

Security tests:

- `title_html` sanitizer payloads across every render path.
- Upload magic-byte mismatch rejected.
- Session token hash lookup works and raw DB token replay is impossible.
- CSRF origin/header checks for mutations.
- Public media route visibility decisions enforced.

Workflow tests:

- Invite create modal stays open on failure.
- Admin row actions visible and keyboard accessible.
- Guest sees clear sign-in/invite prompts.
- URL state survives refresh on events/admin/gallery/roster/wiki/guild-war.

Reliability tests:

- WebSocket max connection and fallback polling behavior.
- Push failure does not break non-critical mutations.
- Critical audit failure blocks sensitive mutations.
- Audit archive verifies checksum before deleting D1 rows.
- Dashboard/search endpoints meet expected request counts.

Performance tests:

- Dashboard request count budget.
- CmdK search request count budget.
- Gallery upload queue behavior with many files.
- Guild war analytics upper-bound query sizes.

### Observability Plan

Add operational visibility without overbuilding:

- Log structured request IDs already exist; surface them consistently in UI error details.
- Track rate-limit events by route group.
- Track failed audit writes separately from normal errors.
- Track push publish failures.
- Track WebSocket connection counts/rejections.
- Track cron failures and last successful run per job.
- Add admin status view backed by server logs, not only local browser state.

### Full Priority Roadmap

#### Immediate P0

- Gate guild-war active/detail/batch/analytics/export appropriately.
- Fix `title_html` sanitizer inconsistency.
- Add high-risk permission assignment guard.
- Make critical audit writes required for sensitive admin actions.
- Gate admin debug/test tooling away from normal production admin use.

#### Short-Term P1

- Add route visibility matrix tests.
- Hash session tokens at rest.
- Raise/version password hashing.
- Add upload magic-byte validation.
- Add role/session authz versioning.
- Add exact permission-gated admin tabs and queries.
- Fix invite creation modal failure behavior.
- Add explicit admin row action menus.

#### Medium-Term P2

- Add public/member DTO split for roster/events/guild-war/gallery as needed.
- Add dashboard summary endpoint.
- Add backend search endpoint.
- Add URL state for admin, roster, gallery, wiki, and guild-war workflows.
- Improve mobile admin workflows.
- Improve WebSocket connection accounting and metrics.
- Complete staging config and deployment preflight.

#### Long-Term P3

- Split large Event/GuildWar services.
- Tune ETag strategy.
- Add audit archive checksum/restore tooling.
- Add Cloudflare WAF/rate-limit production policies.
- Add route-specific skeletons and preload likely routes.
- Add backend-sourced operational health history.

### Final Target State

The target architecture remains simple:

- One Worker/Hono backend.
- One React SPA.
- D1 for relational data.
- R2 for media/archive.
- Durable Object for realtime notifications.
- Flat RBAC with explicit sensitive-permission guardrails.
- Clear public/member/staff/admin visibility matrix.
- Exact frontend capability metadata derived from backend permissions.
- Strong tests around route access, sanitizer, upload, audit, and admin workflows.

This is the right production-grade version for a 500-person guild portal: secure enough to handle compromised staff and scraping risks, fast enough for normal guild traffic, maintainable without enterprise IAM overhead, and clear enough for admins/officers to operate under pressure.
