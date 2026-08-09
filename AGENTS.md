# AGENTS.md — Repository Agent Guide

This file defines the stable working contract for coding agents in this repository. Read the relevant source before editing; this guide points to authorities instead of duplicating a file inventory.

## Repository baseline

- Infini Guild Management is a bilingual guild operations portal.
- The portal is a React 19.2 SPA built with TypeScript 6, Vite 8.2, Mantine 9.5, TanStack Router/Query, Zustand, and TipTap.
- The API is a Hono application on Cloudflare Workers, with D1 through Drizzle ORM, one R2 bucket, and a Durable Object for WebSocket delivery.
- pnpm 11 is the package manager. The supported Node and pnpm ranges are in `package.json` and `.node-version`.
- There is no Tailwind dependency or Tailwind styling layer.

## Authority map

Use these locations as the source of truth:

- `package.json`: scripts, dependency versions, and runtime requirements.
- `apps/shared/`: cross-runtime constants, Zod contracts, inferred types, configuration limits, and shared utilities.
- `apps/portal/router.tsx`: route tree, route guards, lazy page loading, and search validation.
- `apps/portal/components/layout/route-metadata.ts`: navigation grouping, labels, feature gates, and content-width modes.
- `apps/portal/api/`: raw HTTP client plus TanStack Query fetchers and mutations.
- `apps/portal/services/`, `apps/portal/hooks/`, and `apps/portal/stores/`: portal orchestration and client state.
- `apps/portal/components/`: pages, layout, shared behavior, and feature UI.
- `apps/portal/styles/` and `apps/portal/providers/ThemeProvider.tsx`: visual tokens and Mantine theme bridge.
- `DESIGN.md`: design rules; source CSS wins if exact values ever drift.
- `apps/worker/index.ts`: bindings type, middleware order, route mounting, asset handling, WebSocket entry, and cron dispatch.
- `apps/worker/routes/`: HTTP boundary and permission checks.
- `apps/worker/services/`: business rules, transactions, audit writes, and storage logic.
- `apps/worker/db/schema/`: Drizzle model truth.
- `apps/worker/db/migrations/`: executable D1 SQL and migration policy.
- `apps/worker/wrangler.jsonc`: the untracked per-deployment Worker configuration for assets, D1, R2, Durable Objects, variables, production bindings, and schedules; `wrangler.example.jsonc` is its tracked template. There is no root `wrangler.jsonc`.
- `apps/portal/e2e/` and `playwright.config.ts`: end-to-end isolation and cleanup contract.

Prefer directory-level discovery with `rg --files` and targeted symbol search. Do not maintain a second exhaustive file list here.

## Common commands

```bash
pnpm dev
pnpm dev:portal
pnpm dev:worker
pnpm build
pnpm build:worker
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm config:check -- --env=production
pnpm check:secrets
pnpm db:mock:init
pnpm db:mock:rebuild
pnpm db:mock:seed
pnpm db:mock:status
pnpm release:check
```

Use the narrowest validation that covers the change. `pnpm release:check` is the release gate, not the default check for every scoped edit; it includes security/config checks, audit, typecheck, lint, unit tests, E2E, and the Worker production dry-run.

## Working rules

1. Inspect the exact symbols and tests before editing.
2. Keep the change limited to the requested concern. Do not refactor, rename, reformat, or update dependencies incidentally.
3. Treat the working tree as shared and potentially dirty. Preserve unrelated staged, unstaged, and untracked work; never reset, clean, checkout, or overwrite it.
4. Prefer editing existing files. Do not add wrappers, abstractions, flags, or speculative paths.
5. Diagnose failures from evidence and fix the root cause. Do not hide errors, weaken tests, or add silent fallbacks.
6. Add or update the smallest relevant test for non-trivial behavior. Pure documentation changes need only document validation.
7. Run scoped validation once. If it fails, make one evidence-based focused repair and rerun only the failed step.
8. Review the final diff for scope, correctness, side effects, security, accessibility, and maintainability.
9. Do not commit, push, open a pull request, merge, publish, deploy, or mutate production/shared infrastructure without explicit authorization.
10. Do not delete data, rewrite history, or remove files unless the user explicitly requested it and the exact target has been verified.

## Cross-layer changes

### API and shared contracts

- Request and response validation belongs in `apps/shared/schemas/`; infer TypeScript types when a shared Zod schema exists.
- Keep shared schemas, Worker route/service behavior, portal query/mutation code, and tests aligned.
- Components must not import the raw API client or `api/queries`/`api/mutations` directly. Use the established service or hook boundary.
- Keep route handlers thin. Business logic, transactions, and multi-step storage behavior belong in services.
- Mount every new route in `apps/worker/index.ts` and expose every new page through `apps/portal/router.tsx`.

### Portal routing and state

- `router.tsx` owns access and feature guards. Navigation metadata lives in `components/layout/route-metadata.ts`; do not create a second route registry in `AppShell`.
- `AppHeader` owns the single visible route `h1`. Page content must not repeat the route title.
- Server data belongs in TanStack Query. Zustand is for durable client/session/UI state already represented under `apps/portal/stores/`; do not mirror query data into another store without a demonstrated need.
- Preserve session transitions and query-cache clearing across login, logout, expiry, and cross-tab synchronization.
- Keep English and Chinese UI resources synchronized for every user-facing string.

### Portal design

- Use Mantine primitives for foundational controls and overlays; do not recreate their keyboard, focus, menu, dialog, or form behavior.
- Consume L2/L3 semantic tokens. Component CSS must not read `--palette-*` directly or introduce hard-coded colors outside the allowed source-owned rules.
- Preserve light/dark themes, all supported accents, visible keyboard focus, reduced motion, and responsive task parity.
- `AppShell` owns page offsets and scrolling. Compact navigation replaces the sidebar through tablet portrait; the phone-specific header breakpoint remains separate.
- Use `SectionHeader` for semantic in-card headings and `ContentFilterToolbar` for search/filter compositions that collapse by container width.
- Roster `MemberCard` pointer, focus, touch, reduced-motion, visual-dispersion, and audio behavior is protected product character.
- Effect boundaries and token guards are enforced by the focused style and architecture tests; update the contract before intentionally changing a foundational rule.

## Protected static game rules

Game rules are source-owned application contracts, not runtime administration data.

- Admin does not provide a game-rules editor.
- Site Config has no `game_rules` field.
- D1 has no dynamic game-rule tables.
- `EVENT_TYPES` remains exactly `weekly_mission`, `guild_war`, `social`, `poll`, `raffle`, and `other`.
- Guild-war results remain exactly `win`, `loss`, and `draw`.
- KDA is `(kills + assists) / max(deaths, 1)` and remains unrounded in the shared evaluator. Round only at a presentation boundary.
- Guild-war stat definitions use one source-owned `name` field. Do not add parallel `labels` or `precision` fields.
- Preserve the named SQL/Drizzle checks `events_type_valid`, `recurring_templates_type_valid`, and `war_history_result_valid`.
- Authorities are `apps/shared/constants/event-types.ts`, `apps/shared/constants/guild-war.ts`, `apps/shared/schemas/game-rules.ts`, and the matching Drizzle/SQL constraints.

## Worker and security boundaries

- Bindings and middleware are defined from `apps/worker/index.ts`; configuration is in `apps/worker/wrangler.jsonc`.
- Use `requirePermission()` for protected actions. Session permissions are resolved from D1 per request and may be cached only within that request. Isolate-wide permission caches are forbidden.
- Mutations require an allowed `Origin` and `X-Requested-With: XMLHttpRequest`. Keep CORS, request-size limits, rate limits, ETags, feature gates, and security headers in the existing middleware order.
- Validate untrusted input with shared schemas at the boundary. Do not trust client identifiers, MIME declarations, filenames, route permissions, or derived ownership.
- Mutating domain operations must write the appropriate audit record. Use durable audit writes where the existing service requires failure to block success.
- Keep CSP, HSTS, frame denial, content-type protection, referrer policy, and permissions policy intact unless the requested change explicitly changes the security model.
- Never commit secrets or populated local secret files. `SIGNING_SECRET` is a Cloudflare secret, not a value for tracked JSON. `apps/worker/wrangler.jsonc` is untracked by design — the repository tracks only `wrangler.example.jsonc`; template changes still require review.
- The admin system-test console is permission-gated, always available, and cleans up its fixtures by exact ID; preserve the run registry and compensation behavior when touching it.

## Media and R2

There is one R2 binding: `MEDIA`. It stores user/content media and audit archive objects; do not invent a second bucket contract without an approved infrastructure change.

The full contract lives in `docs/media-architecture.md` and must remain singular.

1. Browser image uploads produce mandatory `full` and `view` WebP variants; profile audio becomes Ogg/Opus. SVG and GIF are rejected as images.
2. The Worker validates MIME, magic bytes, dimensions, and the complete variant set before attachment.
3. Domain code uses `MediaService`. R2 keys and listings are never sources for ownership, authorization, quotas, or entity identity.
4. D1 `media_assets`, `media_variants`, and `media_links` are authoritative; public APIs expose media IDs, never R2 keys.
5. Tests must use bytes that match the declared media type and exact variant dimensions.

R2 audit archives are integrity-checked and signed through existing services. Do not expose raw archive objects or signing material directly.

## D1 and migrations

- Drizzle modules under `apps/worker/db/schema/` define the runtime model. The applied migration chain must produce a database that mirrors that model plus SQLite-only details and required seed records.
- `apps/worker/db/migrations/0000_core_schema.sql` is the fresh pre-release baseline. Until the first release, approved schema changes fold into that single baseline with Drizzle/SQL parity coverage.
- After the first release, the baseline freezes: every schema change uses a new monotonic incremental migration with an upgrade/data-preservation test, and no applied migration may be edited.
- Keep Drizzle checks, SQL checks, foreign keys, indexes, built-in roles/permissions, classes, and Site Config seed data aligned.
- D1 has no automatic rollback. Never apply a remote migration without explicit authorization, a backup plan, and local verification of the exact path.
- For current details and validation commands, read `apps/worker/db/migrations/README.md`.

## E2E isolation contract

- `pnpm test:e2e` builds the portal first. Playwright talks to the Worker serving `apps/portal/dist` through the `ASSETS` binding; it does not use a Vite dev server.
- Each E2E slot owns a separate Wrangler process, port, inspector port, persistence directory, D1 database, and R2 state. Do not enable shared mutable state or server reuse.
- `fullyParallel` remains off so specs are the scheduling unit. Retries remain off so timing defects are not masked.
- The setup verifies bundle freshness and rate-limit identity isolation, reseeds each slot, establishes role state, starts a tracked system-test run, and records a D1/R2 fingerprint.
- Browser and API readback channels use separate client identities. Keep both `CF-Connecting-IP` and `X-Forwarded-For` in the E2E helper contract.
- Tests must register and remove created artifacts. Teardown cleans by registered primary key and fails if table counts or R2 object counts drift from the baseline.
- Do not replace teardown verification with a reseed; that would erase evidence instead of proving cleanup.
- When starting any long-running local server outside the Playwright-managed flow, check for an existing healthy process, record the PID/port/log, and stop only the process tree started for the task.

## Local process safety

- Reuse a healthy development server when it matches the required command, repository, and port.
- Before starting a server, watcher, browser automation run, or command that may leave child processes, record the relevant process baseline.
- Start task-owned background processes hidden with output redirected to a known log, then perform a bounded health check.
- Record the command, working directory, PID/process tree, port, and log path so the process can be attributed and stopped safely.
- On completion, stop the task-owned tree from leaves to root and confirm the port is released. Never kill processes by name or disturb processes that predate the task.
- If a process is continuously recreated by an IDE or another active parent, stop retrying and report the actual owner.

## Documentation and delivery

- Keep `README.md` with `README.zh.md`, and `SETUP.md` with `SETUP.zh.md`, synchronized when their shared facts change.
- Keep code examples, script names, paths, bindings, schema policy, and dependency claims grounded in the repository.
- Avoid volatile service/file/test counts, release-verification dates, machine-specific measurements, and paths that do not exist.
- Update `CHANGELOG.md` under `Unreleased` for notable behavior, security, data, or operational changes; do not use it as a build diary.
- Before handoff, run `git diff --check` and the scoped validations relevant to the files changed. Report exactly what ran and any remaining limitation.
