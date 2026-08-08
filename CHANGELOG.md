# Changelog

All notable changes to this project are summarized here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Release versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-08

First public release. The entries below describe the product as shipped.

### Added

- Bilingual English/Chinese guild portal with invite-only registration, session-based authentication, profile credential management, custom roles, and permission-gated administration.
- Member roster and profiles with class catalog/tags, badges, availability and absence tracking, statistics, biography, images, avatar, and audio.
- Event workflows for fixed and recurring events, visibility scheduling, capacity, class quotas, signup locking, polls, raffles, attachments, and automatic archival.
- Announcement authoring with TipTap rich text, staged images, draft/scheduled/published/archived states, expiration, and pinning.
- Guild-war workspaces for active team composition, pool management, templates, conclusions, history, per-member statistics, exports, and analytics.
- Wiki categories and revisioned rich-text articles, gallery media, storage locations/categories/items and transaction ledger, dashboard summaries, and global command search.
- Admin tools for members, roles, invite links, classes, class tags, badges, Site Config, audit/error review, system status, and isolated diagnostics.
- Cloudflare Worker API with D1 persistence, Durable Object WebSocket updates, scheduled maintenance, and one R2 `MEDIA` bucket for content media and audit archives.
- Browser media conversion plus server-side allowlist and magic-byte validation, media reference tracking, upload leases, orphan reporting/cleanup, and compensation for partial writes.
- Local setup, first-admin bootstrap, secret/config checks, production dry-run, deployment command, and English/Chinese self-hosting documentation.

### Changed

- The portal uses one responsive Mantine AppShell and route metadata registry, with a single route heading, compact tablet navigation, mobile bottom navigation, content-width modes, and accessible loading/error/permission states.
- Shared design tokens provide warm light and dark surfaces, fixed action colors, selectable identity accents, domain/status colors, typography and control scales, reduced-motion behavior, and protected Roster interaction effects.
- Reusable `SectionHeader` and container-aware `ContentFilterToolbar` compositions standardize section hierarchy and responsive search/filter controls without duplicating foundational Mantine behavior.
- TanStack Query owns server data and invalidation; focused Zustand stores own session, preferences, notification, guild-war, and catalog UI state. Session transitions clear or refresh state across login, logout, expiry, focus, and cross-tab changes.
- Conditional writes use ETags or source timestamps where concurrent editors could overwrite announcements, wiki articles, guild-war rosters, classes, or inventory state; conflicting writes return explicit refresh/retry responses.
- Storage transactions and batch operations preserve ledger consistency and idempotency, while ordered relations and database constraints protect domain invariants.
- Game rules are fixed source contracts rather than Site Config or D1-managed data: six event types, three guild-war results, shared stat definitions, and an unrounded KDA evaluator.
- Upload paths share the same browser conversion and Worker validation contract, including server-normalized content types and validation before the first R2 write in a batch.
- Media serving honors conditional requests (`304`) and byte ranges (`206`), and the daily media cleanup purges expired upload leases in both `report` and `delete` modes while destructive orphan deletion stays opt-in.

### Security

- Worker middleware enforces request IDs, strict CORS, mutation origin and `X-Requested-With` checks, per-purpose rate limits, body-size limits, ETags, session and permission checks, feature gates, and structured error envelopes.
- CSP, HSTS, frame denial, content-type protection, referrer policy, permissions policy, invite/login lockout behavior, hashed session tokens, and self-describing configurable-cost PBKDF2 password storage are covered by focused tests.
- Announcement and wiki rich text is validated server-side against a strict node/mark whitelist, and member-authored inline HTML (profile titles, badge labels) passes one shared sanitizer.
- Mutating operations emit audit records; aged audit data is archived to integrity-checked R2 objects with signed access rather than exposed directly.
- Production configuration requires secrets outside tracked files; the deployment manifest itself is untracked and generated from a template. The admin system-test console is always available, permission-gated, and cleans up its fixtures by exact ID.

### Database

- Modular Drizzle schemas define the runtime D1 model, with mirrored named checks, foreign keys, indexes, ordered relation tables, and baseline role/permission and class records in `0000_core_schema.sql`.
- `0000_core_schema.sql` is the frozen schema baseline; every schema change uses monotonic incremental migrations starting at `0001_...`. Baseline seeds are deployment-neutral, and site identity comes from environment variables on first boot instead of being baked into the schema.
- D1 media references and R2 lifecycle checks keep content rows, upload leases, cleanup checkpoints, and stored objects reconcilable.

### Tooling

- Current frontend baseline: React 19.2, TypeScript 6, Vite 8.2, Mantine 9.5, TanStack Router/Query, Zustand, TipTap 3, and ECharts 6. The project does not use Tailwind CSS.
- Vitest covers shared contracts, portal components/hooks/styles, Worker services/routes/middleware, and Drizzle/SQL parity and constraints.
- Playwright builds the portal and tests Worker-served assets in isolated slots, each with its own Worker, D1, R2, client identities, tracked cleanup, and post-run data fingerprint verification.
- `pnpm release:check` combines secret/config checks, dependency audit, typecheck, lint, unit tests, E2E, and a production Worker dry-run before deployment.
