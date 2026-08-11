# Contributing to Infini Guild Management

Thank you for contributing. Start with [SETUP.md](./SETUP.md) and [AGENTS.md](./AGENTS.md). Keep changes focused, evidence-based, and aligned with the modular backend.

## Ground rules

1. Discuss major features, cross-system redesigns, infrastructure changes, and new dependencies before implementation.
2. Keep one concern per pull request and preserve unrelated shared-workspace changes.
3. Do not add a second business implementation for Cloudflare or VPS. Both runtimes must compose the same contracts, services, stores, routes, and migration.
4. Keep `apps/shared`, backend packages, runtime adapters, and Portal consumers synchronized when a wire contract changes.
5. Never commit secrets, private migration SQL, populated environment files, databases, blob data, generated runtime state, or build artifacts.

## Branches and commits

Branch from `main` with a descriptive prefix such as `feat/`, `fix/`, `docs/`, or `chore/`. Use clear imperative commit subjects. Conventional Commit style is welcome but not required.

## Architecture boundaries

### Shared and domain code

- Put runtime-neutral Zod schemas, permission IDs, built-in roles, limits, and utilities in `apps/shared/`.
- `packages/kernel/` owns errors, immutable request/authorization context, and ports.
- `packages/server/` owns domain services and authorization policy. It cannot import Hono, Drizzle, Cloudflare, or Node runtime adapters.
- Mutating services require an audit mutation and persist it atomically with the business change.
- Static event/guild-war rules stay in source; do not add a dynamic game-rules table.

### Persistence and HTTP

- `packages/persistence-sqlite/` owns the shared Drizzle schema and concrete stores for both D1 and VPS SQLite.
- `packages/transport-http/` owns parsing, presenters, route factories, mutation security, body limits, ranges, ETags, and error envelopes.
- Routes consume the injected `RequestContext`; they do not parse sessions or duplicate permission checks.
- Collections must be bounded and use stable keyset pagination or a documented small hard limit. Add query-plan assertions for hot paths.

### Runtime adapters

- `packages/application/` is the single composition root.
- `apps/cloudflare/` implements D1, R2, Durable Object, Cloudflare rate-limit, assets, and scheduled-event adapters.
- `apps/vps/` implements Node SQLite, filesystem BlobStore, in-process WebSockets/rate limits/scheduler, static files, and bounded shutdown.
- Runtime adapters may implement ports but cannot fork business rules.

### Portal

- Components consume data through existing services and hooks, not raw HTTP modules.
- TanStack Query owns server state; Zustand owns established client/session/UI state.
- Route behavior lives in `apps/portal/router.tsx`; navigation metadata lives in `apps/portal/components/layout/route-metadata.ts`.
- Add every user-facing string in English and Chinese. Preserve accessibility, themes, reduced motion, responsive task parity, and the established design system.

### Media

- Follow [the canonical media architecture](./docs/media-architecture.md).
- Domain code goes through `MediaService`; storage keys/listings never determine ownership, authorization, or quota.
- Cloudflare R2 and the VPS filesystem implement the same streaming `BlobStore`, including integrity metadata and byte ranges.
- Database links and lifecycle state change atomically with domain data and audit; staged upload failures are reclaimed by bounded garbage collection.

### Schema and migrations

- Drizzle modules in `packages/persistence-sqlite/src/schema/` are the relational source of truth; named SQL files contain required triggers and table options.
- Before the first release, regenerate the single `0000_core.sql` baseline from an empty generated directory and run `pnpm db:assemble`.
- Keep Node SQLite and local D1 parity tests green. Do not add runtime-specific schema variants.
- Never apply a remote migration without explicit authorization, a verified backup, and a tested recovery path.
- Existing credential migration is an explicit offline conversion into the new self-describing password format; runtime dual-read compatibility is forbidden.

## Changing behavior

For an API change:

1. update the shared request/response schema;
2. update the domain service and authorization/audit behavior;
3. update the store transaction and route/presenter;
4. verify both runtime composition paths;
5. update Portal consumers only when the product contract changes.

For a schema change:

1. update the Drizzle schema and any named invariant SQL;
2. regenerate and assemble the core migration while the project is pre-release;
3. run schema parity, Node SQLite, and local workerd D1 tests;
4. update shared contracts and domain/store tests.

## Validation

Choose checks in proportion to risk:

| Change | Minimum validation |
| --- | --- |
| Documentation only | `git diff --check` plus targeted path/link search |
| Shared/domain contract | focused tests and affected package typechecks |
| Portal behavior/styles | focused component tests, typecheck, and relevant visual/accessibility review |
| Store/schema | focused store tests, schema parity, Node SQLite and local D1 migration tests |
| Runtime adapter | its conformance tests and runtime typecheck |
| Release candidate | `pnpm release:check` |

Useful commands:

```bash
pnpm typecheck
pnpm lint
pnpm test -- <focused paths>
pnpm build:portal
pnpm cloudflare build
pnpm vps build
pnpm config:check --runtime cloudflare --config apps/cloudflare/wrangler.example.jsonc --allow-placeholders
pnpm config:check --runtime vps --config scripts/templates/vps.env.example --allow-placeholders
pnpm release:check
```

`release:check` is local-only. CI does not authenticate to Cloudflare, deploy, or mutate remote D1/R2.

## Pull request checklist

- [ ] The diff addresses one concern and preserves unrelated work.
- [ ] Shared contracts, domain rules, persistence, HTTP, and both runtimes are synchronized.
- [ ] Authorization, audit, concurrency, media, and cleanup invariants have focused negative tests.
- [ ] Relevant typechecks/tests pass and the PR states exactly what ran.
- [ ] English/Chinese docs or UI resources are synchronized when shared facts change.
- [ ] No secrets, private SQL, production identifiers, databases, blobs, or test artifacts are tracked.
- [ ] No deploy or remote migration is hidden in CI or a release-check script.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](./LICENSE).
