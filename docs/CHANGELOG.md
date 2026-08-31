# Changelog

[Documentation home](../README.md)

This file records the project's notable changes.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Release versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Consolidated the completed 0000–0017 migration chain into one final-state `0000_core.sql` and one Drizzle snapshot. Fresh databases no longer execute historical table rebuilds or data conversions. Existing production databases require an explicitly verified, maintenance-gated application-ledger adoption; business tables, credentials, media and Wrangler migration history are preserved. No runtime compatibility branch or automatic ledger rewrite is introduced.
- Removed the supplemental spaces/Unicode/numbers explanation below password requirements in both languages; the individual requirement checks and password policy are unchanged.
- Wiki version history now compares complete rich-text documents, reports formatting and table-column width changes, and displays full read-only before/after previews. The responsive dialog separates version selection, comparison actions and scrolling content; failed history requests offer retry instead of appearing empty. Stored revisions and restore concurrency checks are unchanged.

## [0.1.0] - 2026-08-30

Refreshed public release. This release replaces the earlier `v0.1.0` source snapshot with the reviewed current implementation.

### Latest refresh: password and save-flow reliability

#### Changed

- New passwords use one shared policy across registration, changes, and resets: 8–128 characters, uppercase, lowercase, a special character, and common-password rejection. Each form displays a responsive side checklist with live per-rule and confirmation feedback. Spaces/Unicode remain supported, spaces do not satisfy the special-character rule, and numbers are optional. Existing login credentials are unaffected.
- Role managers can edit their own, same-level, or lower-level roles and configure any defined permission without holding the delegated permission themselves, including restoring notice management after disabling it. Edits cannot raise a role above the operator's level. New lower-level roles follow the same permission-delegation rule, and role managers can read the role catalog without a separate view grant. Creation levels, deletion, member-role assignment, concurrent-edit, audit, authorization-refresh, and last-active-role-manager protections remain in place.

#### Fixed

- Announcement, event/template, role, storage, member-catalog, and guild-war saves return transaction-owned snapshots or CAS-verified command state rather than starting fallible response reads after commit. Fault-injection regressions verify snapshot-query failures roll back the business changes and audit rows together.
- Wiki and announcement saves accept the current editor's table-cell alignment attributes, zero-width placeholders in merged cells, and bounded link titles while retaining the rich-text attribute and CSS safety allowlists. Regression tests now submit actual editor-generated links and merged-table JSON through both content schemas.
- Profile and profile-media writes return the committed profile revision in their validated JSON responses, so a missing or transformed HTTP ETag cannot turn a successful save into a client error or leave the next save using an old revision. Strong If-Match checks remain required, and no-op media deletions return the verified current revision.
- Save conflicts show one localized notification with request metadata instead of duplicate global and page notifications; timed-out requests now show their error instead of being silently discarded.
- Gallery uploads, account changes, catalog saves/reorders, and audit downloads share network-error feedback without duplicate toasts; incorrect current-password errors retain their account-specific message.
- Password changes identify length, character-composition, common-password, and confirmation errors accessibly instead of leaving disabled controls unexplained; invalid submissions are blocked before the confirmation step.
- Explicit upload and download cancellations retain their abort reason without reporting a false network timeout; downloads now honor the caller's cancellation signal.
- Notifications stack below the page header instead of covering bottom save controls, so a successful profile save cannot block the next save.
- Local release linting excludes ignored backup bundles, matching the repository's source-control boundary.
- Wiki and announcement details place the title above category/status badges and use outlined back buttons with balanced, wrapping action bars, including when no management actions are available.

### Earlier snapshot included in this release

### Added

- Gallery media now collects a required title and optional description before image upload or video creation, and owners or members with `gallery.manage` can edit that metadata from the lightbox with compare-and-swap conflict protection and atomic audit records.
- Durable per-user activity inboxes for member joins, published announcements, created events, and created wiki articles, including unread state and 3-day retention.
- Administrator-managed notices for all signed-in members or selected dynamic roles, with independent publication, withdrawal, expiry, read state, and optional blocking acknowledgement. Each account acknowledges a notice at most once for its entire lifetime: edits and republication can make it unread again, but never request another acknowledgement.
- Announcement author identity, important badges, and ordered arbitrary-format attachments with Site Config size/count limits, staged media lifecycle, opaque blob storage, and authorized forced downloads.

### Security

- Kept Cloudflare's native authentication rate-limit bindings as a first layer and added exact Durable Object counters for login source and source/login-name buckets; no account cooldown or administrator unlock path was reintroduced.
- Removed the Cloudflare Worker Cache API media fast path so every media request reaches the shared authorization and lifecycle checks before a response is served.
- Reject unauthorized multipart requests before consuming their bodies; re-evaluate live media against authoritative parent visibility and private cache policy; validate WebP structure and dimensions; require 12-character non-common passwords; and redact invite secrets from failure logs.
- Canonicalized rich-text links at both write and render boundaries so historical and newly authored external links always isolate the opener with `noopener noreferrer`, while invalid link marks are removed instead of rendered.
- Added an atomic per-owner pending-media budget and an independent, dual-dimension content-open limiter. Upload reservations now reject excessive staged assets before blob writes, while ordinary announcement and Wiki detail opens still increment once per route entry without sharing the general mutation bucket.
- Limited announcement realtime hints to member-visible state changes, and aligned announcement, Wiki, and guild-war mutations with their exact action permissions instead of broader create/manage proxies.
- Kept newly written PBKDF2-SHA256 password hashes and runtime configuration at a 10,000-iteration default and minimum for the Cloudflare Workers CPU limit, with an explicit measured deployment override through 10,000,000; authenticated media now uses `private, no-store`, CSV exports neutralize spreadsheet formulas, and rich-text images are restricted to managed same-origin media.
- Hardened the VPS data boundary on POSIX: the runtime applies its own private umask, validates the owner and write policy of every data-path ancestor, uses `0700` data directories and `0600` SQLite/blob files, rejects canonical-path redirection, and tightens only exact owned paths rather than recursively changing existing trees. Blob publication now syncs directory metadata, excludes its private temporary namespace from inventory, and performs bounded recovery of precisely named crash remnants without touching ordinary or active files.
- Split public display names from private login names, with an in-place backfill of existing usernames and no legacy authentication fallback.
- Added temporary administrator recovery credentials with a short, non-renewing password-change session and atomic permanent login-name/password completion.
- Added optional linked Google, Discord, and KOOK sign-in, optional verified email delivery through the deployment owner's Cloudflare Email Sending configuration, and independently gated OAuth settings. WeChat remains explicitly unavailable until its official callback and token rules are verified.
- Bound sessions and OAuth link challenges to an account authentication revision. Password/login-name changes, OAuth unlink, and administrator recovery now invalidate stale sessions with compare-and-swap protection; administrator recovery also removes linked OAuth identities.
- Hardened HTTPS cookies with the `__Host-` contract, rate-limited every current-password check by account and trusted source, bounded outbound OAuth/email requests, and kept business-operation `401` responses from incorrectly signing the Portal out.
- Kept email verification tokens in URL fragments and short-lived session storage rather than login return URLs or browser history.
- Removed persistent login-failure cooldowns, their database table, and administrator lock inspection/reset. Unknown, unusable, malformed, over-budget, expired-temporary-password, and wrong-password accounts now share one generic credential failure and one fixed PBKDF2 budget, while source-wide and source/login-pair throttles still run before account lookup. Throttled Portal responses use a localized generic message without exposing exact server text.

### Changed

- Updated the supported runtime baseline to Node.js 26.5.1 and refreshed every direct workspace dependency to the latest registry release available on 2026-08-30, including native TanStack Table 9, TypeScript 7 CLI, Motion 13, Hono, Zod, TipTap, Wrangler, Workers Types, and Miniflare 5 alpha migrations without legacy adapters.
- Replaced brittle visual and source-shape tests with a smaller suite focused on business behavior, security, data integrity, accessibility, keyboard/focus behavior, runtime parity, and essential browser workflows.
- Added recurring-template image uploads that become independent attachment snapshots on generated events, with a visible return-to-templates action.
- Replaced roster load-more behavior with 24-member pagination and rebuilt member details/editing with compact sections, editable display names and availability, and atomic profile/role/status saves.
- Kept notice save/publish actions visible, removed role-level clutter, compacted event/profile layouts, and removed native numeric input spinner arrows.
- Unified application tooltips with theme-aware shared overlays, including keyboard access and detailed status layouts, and corrected shared popup exit transitions that could make closed dropdowns reappear.
- Added purpose-aware browser caching for public media without restoring the Worker response-cache bypass: ID-versioned Site Config logos and class icons are immutable for one year, other public media revalidates after one hour, and authenticated, private, and ranged media remains `private, no-store`.
- Admin API system tests now preserve their server run identity while logs are visible, abort into immediate teardown when leaving Diagnostics, and remove reclaimed run-registry rows after exact artifact cleanup. The hourly job is labeled as abandoned-run recovery because successful and stopped tests clean themselves immediately.
- Bound WebSocket session revalidation to 300 distinct sessions per one-minute sweep and hydrate each production sweep with one JSON-batched D1 query. Credential, role, lifecycle, and logout mutations now publish a targeted authorization refresh so affected sockets are revalidated immediately instead of retaining a stale permission snapshot for up to five minutes.
- Rebalanced scheduled work across five Cloudflare cron triggers: announcement publication and raffle drawing remain every 15 minutes, recurrence/event archival run every 30 minutes, media cleanup and general cleanup run hourly, and audit archival remains daily. Every invocation processes one explicitly bounded batch; raffle drawing handles at most two events and media cleanup ten assets per run, while session maintenance derives remaining work from `limit + 1` windows instead of seven follow-up reads so cold-start paths stay below the D1 Free query limit.
- Added migration `0016_d1_query_indexes` and rewrote event archival, media garbage collection, and transient-auth cleanup candidate scans into index-compatible branches without `OR`/`COALESCE` sort plans. Raffle participant reads and notification authorization reads now use bounded JSON batching, and offset-paginated APIs reject pages above 10,000 before reaching storage.
- Removed duplicate Portal reads by single-flighting session resolution, skipping retries for deterministic HTTP 4xx responses, limiting realtime recovery to targeted query families, gating detail-page data by route/tab, unifying member-directory cache keys, batching gallery uploads, lazily loading class catalogs, and answering matching media conditional requests before opening blob bodies.
- Consolidated user-facing repository documentation under `docs/`, leaving the root `README.md` as the single documentation entry point with linked English and Chinese guides.
- Replaced the intermediate bearer-token invitation design with one random 10-character uppercase alphanumeric invite code that is stored directly and available to authorized administrators for manual entry or link sharing. Migration `0015` revokes active invitations from the superseded token format because their original bearer values cannot be recovered from stored digests. Signed audit-download URLs were replaced with ordinary authenticated audit file routes; audit rows move to NDJSON after three complete calendar months, and completed archives are removed after twelve months by the bounded scheduled job.
- Unified search, filter, view, summary, and collection actions across announcements, Wiki, events, recurring templates, gallery, roster, guild-war history, storage inventory, and administrator users/invites/audit. The shared toolbar now uses 44rem container-aware reflow, desktop popovers, phone drawers, active-filter counts, reset controls, wrapped action rails, 44px mobile targets, and deterministic Escape focus return. Administrator member queries now reset stale pagination, and member/invite status groups expose localized accessible names.
- Replaced the former low-resolution background set with route-specific 4K xianxia game environments, separate restrained light/dark variants, atmospheric depth, and side-weighted focal areas that keep central content legible without stretching individual objects.
- Treat announcement and Wiki view totals as raw opens: the Portal labels them as opens, no longer offers popularity sorting, and records one open for each normal detail-route entry.
- Preserved cached content during failed refreshes across settings, profile, event, and administration surfaces, with explicit retry controls; command-search debounce and storage-scope pagination now retain one authoritative request state.
- Made the authenticated shell the sole owner of route-aware document titles, so Site Config refreshes cannot erase the current route title.
- Hardened the local Playwright harness with per-slot command, process, log, and exit evidence plus exact bounded cleanup, and added representative functional browser coverage across member and administration workflows.
- Added a guarded production D1 upgrade runbook covering real-data scratch rehearsal, immutable ledger verification, maintenance mode, paired D1/R2 recovery evidence, rollback, and the full `0000`–`0017` release chain.
- Expanded browser coverage with a separately authenticated, run-tracked member project plus end-to-end checks for member event/storage/notification flows, dashboard data and retry behavior, class-tag CRUD and keyboard reordering, authentication recovery, and blocking important-notice lifecycles.
- Preserved validated same-origin return targets through temporary-credential login and mandatory password completion, while rejecting protocol-relative and fragment-bearing targets; dedicated browser coverage now exercises that lifecycle and required-notice blocking acknowledgement.
- Added a separate local-only Chromium E2E job to GitHub CI so pull requests run both `release:check` and the isolated browser suite without production credentials or remote mutations.
- Storage structure edits and destructive confirmations now use persisted compare-and-swap revisions; item revisions cover metadata, linked images, and ledger-backed quantity, so stale writes return conflicts without altering links or audit history.
- Made each administrator member-detail save one compare-and-swap transaction across profile, role, and active state; failed writes now leave all three, audit data, and affected sessions unchanged.
- Kept the simple materialized per-user notification inbox appropriate for small guilds (about 200 members), while targeting personal read-state pushes, moving retention writes to bounded scheduled maintenance, and cleaning system-test notifications by exact entity identity.
- Replaced the former Portal component runtime wholesale with source-owned shadcn/ui compositions backed by Base UI and Tailwind CSS; removed the old providers, imports, styles, package dependencies, test selectors, and compatibility paths.

### Initial public-release scope

First public release. The entries below describe the shipped product.

#### Added

- English/Chinese guild portal with invite-only registration, session-based authentication, profile credential management, custom roles, and permission-gated administration.
- Member roster and profiles with a class catalog and tags, badges, availability and absence tracking, statistics, biographies, images, avatars, and audio. Successful sign-ins record a last-login timestamp in the admin member table and on the profile card. Returning with a "stay logged in" cookie also counts as a sign-in, but each member's timestamp is refreshed no more than once an hour so reads do not become writes.
- Fixed and recurring event workflows with visibility scheduling, capacity, class quotas, signup locking, polls, raffles, attachments, and automatic archival.
- TipTap announcement authoring with staged images, draft, scheduled, published, and archived states, expiration, and pinning.
- Guild-war workspaces for active-team composition, pool management, templates, conclusions, history, per-member statistics, exports, and analytics. Rosters and standby pools show only members who can still sign in. Signups remain intact, so reactivating a member restores their exact team slot, and concluded records continue to list everyone who played.
- Wiki categories and revisioned rich-text articles, gallery media, storage locations, categories, items, and transaction ledgers, dashboard summaries, and global command search.
- Admin tools for members, roles, invite links, classes, class tags, badges, Site Config, audit and error review, system status, and isolated diagnostics.
- Local setup, first-admin bootstrap, secret and configuration checks, deployment commands, and English/Chinese self-hosting documentation for both runtimes.
- A runtime-neutral backend built from shared contracts, domain services, SQLite stores, HTTP routes, and explicit platform ports. Cloudflare and single-process VPS deployments share one SQLite schema, and conformance suites keep each port's two adapters, SQL executor, and blob store behaviorally aligned.
- Cloudflare deployment with a Worker API over D1, Durable Object WebSocket updates, scheduled maintenance, and one R2 `MEDIA` bucket for content media and audit archives. The Worker builds its dependency graph once per isolate and resolves each request's `ExecutionContext` through AsyncLocalStorage; the configuration preflight enforces the required `nodejs_als` compatibility flag.
- VPS deployment with SQLite, filesystem, WebSocket, and scheduler adapters, migration tooling, and bounded shutdown. SQLite work runs on worker threads through one writer lane and a bounded read-only pool, keeping statements off the Node event loop. The executor owns journal mode and connection PRAGMAs, while the data-verification tool opens databases strictly read-only.
- Persistent progressive login locking with exact remaining-time responses, administrator inspection and reset, and bounded scheduled cleanup.
- D1-owned editable roles with strict downward user management and database protection for the final active user whose role grants `admin.roles.manage`. Private SQL generation establishes the first active role manager without introducing a runtime compatibility path.
- Browser media conversion, server-side allowlist and magic-byte validation, media reference tracking, upload leases, orphan reporting and cleanup, and compensation for partial writes. Persisted images require browser-generated WebP `full` and `view` variants; profile audio uses Ogg/Opus; and the selected backend verifies bytes, dimensions, and the complete variant set before attachment.
- Database-owned media identity, attachment, quotas, ranges, and garbage collection behind one streaming BlobStore contract for R2 and the VPS filesystem. Media serving supports conditional requests (`304`) and byte ranges (`206`). Daily cleanup purges expired upload leases in `report` and `delete` modes, while destructive orphan deletion remains opt-in.
- A D1/R2 integrity scanner that compares one page at a time and explains why: R2 has no bulk comparison, each object costs a request, and each page stays within a request's subrequest and CPU limits.
- Wiki revisions with complete immutable snapshots for every state change, keyset pagination, historical-media retention, and atomic restoration of any recorded revision.
- Admin API tests that record exact artifacts, errors, and reversible before-images, then clean them immediately after each category or suite with compare-and-swap. The shared scheduled-job coordinator only recovers runs abandoned by a browser, network, or runtime failure.
- A shared realtime gate that returns `426 Upgrade Required` for plain HTTP requests to `/ws` before either runtime performs origin or rate-limit processing.
- One responsive Mantine AppShell and route-metadata registry, with a single route heading, compact tablet navigation, mobile bottom navigation, content-width modes, and accessible loading, error, and permission states.
- Shared design tokens for warm light and dark surfaces, fixed action colors, selectable identity accents, domain and status colors, typography and control scales, reduced-motion behavior, and protected Roster interaction effects. Reusable `SectionHeader` and container-aware `ContentFilterToolbar` compositions standardize hierarchy and responsive search/filter controls without recreating Mantine foundations.
- Theme-owned tooltips for hover hints. Native browser `title` attributes are absent from rendered DOM, and the shared theme provides the surface, arrow, and rest delay instead of per-call props.
- TanStack Query for server data and invalidation, including the class catalog and class tags. Focused Zustand stores manage session, preferences, notification, guild-war, and catalog UI state; session transitions clear or refresh that state on login, logout, expiry, focus, and cross-tab changes.
- Vertically sortable lists ignore horizontal pointer movement while dragging; the two-dimensional class grid retains full movement.
- Unique audit, permission, and API self-test labels within each rendered list, with a locale-parity test that fails on a collision.
- Conditional writes using ETags or source timestamps where concurrent editors could overwrite announcements, wiki articles, guild-war rosters, classes, or inventory state. Conflicts return explicit refresh/retry responses. Storage transactions and batch operations preserve ledger consistency and idempotency, while ordered relations and database constraints protect domain invariants.
- Fixed game-rule source contracts instead of Site Config or D1-managed data: six event types, three guild-war results, shared stat definitions, and an unrounded KDA evaluator.
- Event list reads that aggregate poll votes in SQL, cryptographically secure raffle draws, size-bounded wiki revision diffs, and no-store revalidation headers for `index.html` in both runtimes while static assets reuse precomputed ETags.
- One shared TipTap plain-text extraction utility used by the portal, both runtimes, and the search backfill; API error codes and messages have one owner in the kernel contract.

#### Security

- Both runtimes resolve immutable authorization context on the server. Before any domain route runs, middleware enforces request IDs, strict CORS, mutation origin and `X-Requested-With` checks, per-purpose rate limits, body-size limits, ETags, session and permission checks, feature gates, and structured error envelopes.
- Self-describing PBKDF2-SHA256 password storage, with 10,000 iterations by default for the Cloudflare free-plan CPU budget, a reviewed deployment override up to 10,000,000, and sign-in upgrades only for lower-cost stored hashes.
- Server-side validation of announcement and wiki rich text against a strict node/mark allowlist, plus one shared sanitizer for member-authored inline HTML such as profile titles and badge labels.
- Audit records committed atomically with every mutation. Aged audit data is archived to integrity-checked BlobStore objects exposed only through authenticated, permission-gated routes.
- Focused coverage for CSP, HSTS with `includeSubDomains`, frame denial, content-type protection, referrer policy, permissions policy, invite throttling, generic login failures, and hashed session tokens. Both the content security policy and session-cookie allowlist have one shared source module used by both runtimes.
- Production configuration that keeps secrets outside tracked files and generates the untracked deployment manifest from a template. Cloudflare local configuration is rejected unless D1 and R2 bindings explicitly set `remote: false`; CI and `release:check` never authenticate, deploy, or mutate production resources.
- An always-available, permission-gated admin system-test console that cleans up fixtures by exact ID.
- A locked dependency tree that pins `nanoid` to its patched release line; `pnpm audit`, including `--prod`, reports zero known vulnerabilities.

#### Database

- Added migration `0017_notice_delivery`, replacing per-publication notice acknowledgements with one permanent read/acknowledgement receipt per notice and member, plus dynamic-role audience relations.
- Modular Drizzle schemas that define the shared SQLite model applied identically to Cloudflare D1 and VPS SQLite, including mirrored named checks, foreign keys, indexes, ordered relation tables, and baseline role, permission, and class records in `0000_core.sql`.
- A migration manifest with one frozen `0000_core` baseline and runtime validation of the exact ledger. Later schema changes use contiguous ordinal migrations. The application intentionally has no runtime legacy schema, dual-read, or backward-compatibility layer, so a database with a mismatched ledger needs a reviewed, data-preserving rebaseline before it can use the current manifest.
- Deployment-neutral baseline seeds; site identity comes from environment variables on first boot rather than being baked into the schema.
- `media_assets`, `media_variants`, and `media_links` that make logical assets, blob objects, quotas, authorization, and cleanup reconcilable without parsing object paths.
- Persisted plain-text search projections for announcements and wiki articles in the core schema. Runtime writes keep those projections canonical, and global search reads the column instead of scanning JSON bodies.

#### Tooling

- Frontend baseline: React 19.2, TypeScript 6, Vite 8.2, Mantine 9.5, TanStack Router/Query, Zustand, TipTap 3, and ECharts 6. The project does not use Tailwind CSS.
- Vitest coverage for shared contracts, portal components, hooks and styles, backend services, routes and middleware, and Drizzle/SQL parity and constraints across both runtimes.
- Playwright portal builds and Worker-served-asset tests in isolated slots. Each slot has its own Worker, D1, R2, client identities, tracked cleanup, and post-run data-fingerprint verification.
- `pnpm release:check` runs local secret/config and boundary checks, typechecking, lint, unit tests, and builds. It does not authenticate, deploy, migrate, audit dependencies, run E2E, or dry-run production infrastructure.
