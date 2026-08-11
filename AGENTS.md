# AGENTS.md — Repository Agent Guide

This file defines the stable working contract for coding agents in this repository. Read the relevant implementation before editing; this guide points to authorities instead of duplicating a file inventory.

## Repository baseline

- Infini Guild Management is a bilingual React portal with one modular backend and two deployment adapters.
- Deployments choose either Cloudflare Workers (D1, R2, Durable Objects) or one VPS Node process (SQLite, filesystem blobs, in-process WebSockets). Business behavior must never branch by runtime.
- The Portal uses React, TypeScript, Vite, Mantine, TanStack Router/Query, Zustand, and TipTap. There is no Tailwind layer.
- Supported Node, pnpm, and dependency versions are declared in `package.json`.

## Authority map

- `apps/shared/`: wire schemas, permission IDs, built-in roles, hard limits, and runtime-neutral utilities.
- `packages/kernel/`: errors, request/authorization context, and platform ports.
- `packages/server/`: domain services and authorization policies. It cannot import an HTTP or runtime adapter.
- `packages/persistence-sqlite/`: the shared Drizzle model, stores, SQLite invariants, and the single migration chain used by D1 and VPS.
- `packages/transport-http/`: HTTP parsing, presenters, security middleware, and route factories.
- `packages/application/`: one composition root for the Portal API and scheduled jobs.
- `apps/cloudflare/`: D1/R2/DO/rate-limit/static/scheduled adapters and the Cloudflare root handler.
- `apps/vps/`: Node SQLite/filesystem/WebSocket/scheduler/static adapters and the VPS runtime.
- `apps/portal/`: the SPA. `router.tsx` owns routing; `components/layout/route-metadata.ts` owns navigation; services/hooks own orchestration.
- `packages/persistence-sqlite/src/migrations/generated/0000_core.sql`: the core pre-release schema assembled from Drizzle plus named invariant SQL.
- `SETUP.md` and `SETUP.zh.md`: deployment, migration, bootstrap, credential import, backup, and recovery procedures.

Use `rg --files` and targeted symbol search before editing. Do not maintain a second exhaustive file list.

## Common commands

```bash
pnpm dev
pnpm cloudflare dev
pnpm vps dev
pnpm dev:portal
pnpm build:portal
pnpm cloudflare build
pnpm vps build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm db:generate
pnpm db:assemble
pnpm db:migrate:cloudflare:local
pnpm db:migrate:vps --database <path>
pnpm config:check --runtime cloudflare --config apps/cloudflare/wrangler.jsonc
pnpm config:check --runtime vps --config apps/vps/.env
pnpm release:check
```

Use the narrowest validation that covers a change. `release:check` is local-only and must never deploy or mutate a remote database or blob store.

## Working rules

1. Inspect exact symbols and tests before editing.
2. Preserve unrelated dirty work. Never reset, clean, or overwrite a shared worktree.
3. Fix the root cause; do not add compatibility branches, silent fallbacks, duplicate services, or placeholder success paths.
4. Keep dependency flow one-way: shared/kernel → server → persistence/transport → application → runtime adapters.
5. Add the smallest relevant test for non-trivial behavior and report exactly what ran.
6. Do not commit, push, publish, deploy, or mutate production infrastructure without explicit authorization.
7. Never apply a remote migration without explicit authorization, a verified backup, and a tested recovery path.

## Contracts and authorization

- Request/response validation belongs in `apps/shared/schemas/`; infer TypeScript types from those schemas.
- Route factories parse HTTP and call a service. Business policy and authorization belong in domain services; Portal permission gates are UX only.
- Every request receives one immutable `RequestContext`. `AuthorizationContext` comes only from the server-resolved session. A Portal “view as” choice must never enter authorization or persistence queries.
- Protected mutations write their audit row in the same SQL transaction as the business change. Blob bytes may be staged first; attachment and lifecycle state are database-owned.
- Mutations require an allowed `Origin` and `X-Requested-With: XMLHttpRequest`. Keep body limits, rate limits, ETags, security headers, session resolution, and feature gates centralized.
- `site_owner` is the trust root above admin. Multiple owners are allowed, peer-owner actions require both `admin.owners.manage` and the concrete permission, and the database preserves the final active owner.
- Login locking is persistent and progressive. Locked requests must be rejected before account lookup or PBKDF2 work; lock inspection/reset is permission-gated and audited.

## Portal

- Components consume server data through established services/hooks, not the raw API client.
- TanStack Query owns server state; Zustand is for established client/session/UI state.
- `router.tsx` owns route access and feature guards. Do not create a second navigation registry.
- Mantine primitives own keyboard, focus, dialog, menu, and form behavior. Consume semantic theme tokens and preserve dark/light themes, reduced motion, keyboard focus, and responsive task parity.
- Keep English and Chinese UI resources synchronized for every user-facing change.
- Follow `DESIGN.md`; source CSS wins if exact values drift.

## Static game rules

Game rules are source-owned contracts, not Site Config data:

- event types are `weekly_mission`, `guild_war`, `social`, `poll`, `raffle`, and `other`;
- guild-war results are `win`, `loss`, and `draw`;
- KDA is `(kills + assists) / max(deaths, 1)` and is rounded only at presentation;
- stat definitions use one user-entered `name`, with numeric values stored as SQLite `REAL`.

Do not add a dynamic game-rules table or a second translation/precision model.

## Media and blobs

The canonical contract is in `docs/media-architecture.md`.

- `MediaService` and D1/SQLite metadata own identity, authorization, quota, lifecycle, and attachment.
- `BlobStore` stores streams and verified metadata only. Cloudflare maps it to R2; VPS maps it to the configured filesystem root.
- API responses expose media IDs, never storage keys.
- Range/HEAD/ETag behavior must remain streaming and identical across both runtimes.
- Garbage collection considers only expired, unlinked database assets and deletes exact recorded keys; it never infers ownership from paths or scans storage as an authority.

## Schema and migrations

- Drizzle modules under `packages/persistence-sqlite/src/schema/` are the relational source of truth. Named `.sql` invariants cover behavior Drizzle cannot express.
- `0000_core.sql` is the only pre-release baseline. Generate it from an empty migration directory, then run `pnpm db:assemble`; never hand-maintain a parallel D1 schema.
- Node SQLite and local workerd D1 must apply the same bytes and pass schema/index/trigger parity tests.
- Built-in roles, permissions, Site Config defaults, and schema metadata are generated from shared constants.
- Private first-owner and credential-import SQL is generated under ignored `private-migrations/` and is never committed.
- After the first public release, applied migration files become immutable and later changes use monotonic migrations.

## System tests and cleanup

- The admin API test console uses a permission-gated run registry. Every created artifact and error is recorded by exact primary key.
- Reorders capture bounded before-images and restore with compare-and-swap; cleanup never reseeds or deletes by broad pattern.
- Cleanup/finalize is idempotent, reports conflicts explicitly, and abandoned runs are reclaimed by the bounded scheduled job.

## Runtime boundaries

- Cloudflare configuration is copied from `apps/cloudflare/wrangler.example.jsonc`; D1/R2 local bindings must keep `remote: false`. Secrets use Wrangler secret storage.
- VPS configuration is copied from `scripts/templates/vps.env.example`; secrets and data paths must be protected by filesystem permissions.
- VPS is intentionally one Node process. Do not imply multi-process safety without adding shared WebSocket delivery, rate limiting, and distributed job coordination.
- Both runtimes mount the same application routes, schema version gate, notification policy, and job coordinator. Runtime-specific code implements ports only.

## Delivery

- Keep `README.md`/`README.zh.md` and `SETUP.md`/`SETUP.zh.md` synchronized.
- Update `CHANGELOG.md` under `Unreleased` for notable security, data, or operational behavior.
- Before handoff, run `git diff --check`, relevant focused tests, both runtime typechecks, secret/config checks, and the release gate when preparing a release.
- Confirm no production identifiers, local databases, generated private SQL, secrets, or runtime state are tracked.
