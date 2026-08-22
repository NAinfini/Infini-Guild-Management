# Changelog

This file records the project's notable changes.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Release versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-16

First public release. The entries below describe the shipped product.

### Added

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
- Admin API tests that record exact artifacts, errors, and reversible before-images, then clean up with compare-and-swap. The shared scheduled-job coordinator reclaims abandoned runs.
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

### Security

- Both runtimes resolve immutable authorization context on the server. Before any domain route runs, middleware enforces request IDs, strict CORS, mutation origin and `X-Requested-With` checks, per-purpose rate limits, body-size limits, ETags, session and permission checks, feature gates, and structured error envelopes.
- Self-describing PBKDF2-SHA256 password storage, with 10,000 iterations by default for the Cloudflare free-plan CPU budget, a reviewed deployment override up to 10,000,000, and sign-in upgrades only for lower-cost stored hashes.
- Server-side validation of announcement and wiki rich text against a strict node/mark allowlist, plus one shared sanitizer for member-authored inline HTML such as profile titles and badge labels.
- Audit records committed atomically with every mutation. Aged audit data is archived to integrity-checked R2 objects with signed access rather than exposed directly.
- Focused coverage for CSP, HSTS with `includeSubDomains`, frame denial, content-type protection, referrer policy, permissions policy, invite/login lockout behavior, and hashed session tokens. Both the content security policy and session-cookie allowlist have one shared source module used by both runtimes.
- Production configuration that keeps secrets outside tracked files and generates the untracked deployment manifest from a template. Cloudflare local configuration is rejected unless D1 and R2 bindings explicitly set `remote: false`; CI and `release:check` never authenticate, deploy, or mutate production resources.
- An always-available, permission-gated admin system-test console that cleans up fixtures by exact ID.
- A locked dependency tree that pins `nanoid` to its patched release line; `pnpm audit`, including `--prod`, reports zero known vulnerabilities.

### Database

- Modular Drizzle schemas that define the shared SQLite model applied identically to Cloudflare D1 and VPS SQLite, including mirrored named checks, foreign keys, indexes, ordered relation tables, and baseline role, permission, and class records in `0000_core.sql`.
- A migration manifest with one frozen `0000_core` baseline and runtime validation of the exact ledger. Later schema changes use contiguous ordinal migrations. The application intentionally has no runtime legacy schema, dual-read, or backward-compatibility layer, so a database with a mismatched ledger needs a reviewed, data-preserving rebaseline before it can use the current manifest.
- Deployment-neutral baseline seeds; site identity comes from environment variables on first boot rather than being baked into the schema.
- `media_assets`, `media_variants`, and `media_links` that make logical assets, blob objects, quotas, authorization, and cleanup reconcilable without parsing object paths.
- Persisted plain-text search projections for announcements and wiki articles in the core schema. Runtime writes keep those projections canonical, and global search reads the column instead of scanning JSON bodies.

### Tooling

- Frontend baseline: React 19.2, TypeScript 6, Vite 8.2, Mantine 9.5, TanStack Router/Query, Zustand, TipTap 3, and ECharts 6. The project does not use Tailwind CSS.
- Vitest coverage for shared contracts, portal components, hooks and styles, backend services, routes and middleware, and Drizzle/SQL parity and constraints across both runtimes.
- Playwright portal builds and Worker-served-asset tests in isolated slots. Each slot has its own Worker, D1, R2, client identities, tracked cleanup, and post-run data-fingerprint verification.
- `pnpm release:check` runs local secret/config and boundary checks, typechecking, lint, unit tests, and builds. It does not authenticate, deploy, migrate, audit dependencies, run E2E, or dry-run production infrastructure.
