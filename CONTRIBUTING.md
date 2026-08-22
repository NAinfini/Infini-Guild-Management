# Contributing to Infini Guild Management

Thanks for helping improve the project. Read [SETUP.md](./SETUP.md) and [AGENTS.md](./AGENTS.md) first. Keep your change focused, work from evidence, and respect the modular backend boundaries.

## Ground rules

1. Discuss major features, cross-system redesigns, infrastructure changes, and new dependencies before writing the implementation.
2. Keep one concern per pull request and do not overwrite unrelated work in a shared workspace.
3. Do not build separate business implementations for Cloudflare and VPS. Both runtimes compose the same contracts, services, stores, routes, and migrations.
4. When a wire contract changes, keep `apps/shared`, backend packages, runtime adapters, and Portal consumers in sync.
5. Never commit secrets, private migration SQL, populated environment files, databases, blob data, generated runtime state, or build artifacts.

## Branches and commits

Branch from `main` with a descriptive prefix such as `feat/`, `fix/`, `docs/`, or `chore/`. Write clear, imperative commit subjects. Conventional Commit style is welcome, but not required.

## Architecture boundaries

### Shared and domain code

- Put runtime-neutral Zod schemas, permission IDs, built-in roles, limits, and utilities in `apps/shared/`.
- `packages/kernel/` owns errors, immutable request/authorization context, and ports.
- `packages/server/` owns domain services and authorization policy. It must not import Hono, Drizzle, Cloudflare, or Node runtime adapters.
- Every mutating service needs an audit mutation, persisted atomically with the business change.
- Static event/guild-war rules stay in source; do not add a dynamic game-rules table.

### Persistence and HTTP

- `packages/persistence-sqlite/` owns the shared Drizzle schema and the concrete stores used by both D1 and VPS SQLite.
- `packages/transport-http/` owns parsing, presenters, route factories, mutation security, body limits, ranges, ETags, and error envelopes.
- Routes use the injected `RequestContext`; they do not parse sessions or repeat permission checks.
- Collections must be bounded and use stable keyset pagination or a documented small hard limit. Add query-plan assertions for hot paths.

### Runtime adapters

- `packages/application/` is the single composition root.
- `apps/cloudflare/` implements D1, R2, Durable Object, Cloudflare rate-limit, assets, and scheduled-event adapters.
- `apps/vps/` implements Node SQLite, filesystem BlobStore, in-process WebSockets, rate limits, scheduler, static files, and bounded shutdown.
- Runtime adapters may implement ports, but they must not fork business rules.

### Portal

- Components get data through existing services and hooks, not raw HTTP modules.
- TanStack Query owns server state; Zustand owns the established client, session, and UI state.
- Route behavior belongs in `apps/portal/router.tsx`; navigation metadata belongs in `apps/portal/components/layout/route-metadata.ts`.
- Add every user-facing string in English and Chinese. Preserve accessibility, themes, reduced motion, responsive task parity, and the established design system.

### Media

- Domain code goes through `MediaService`; storage keys and listings never decide ownership, authorization, or quota.
- Cloudflare R2 and the VPS filesystem implement the same streaming `BlobStore`, including integrity metadata and byte ranges.
- Database links and lifecycle state change atomically with domain data and audit records. Bounded garbage collection reclaims failed staged uploads.

### Schema and migrations

- Drizzle modules in `packages/persistence-sqlite/src/schema/` are the relational source of truth. Named SQL files contain required triggers and table options.
- The `0000_core.sql` baseline is frozen. Each schema change needs a new contiguous ordinal migration with a manifest checksum entry; never edit an applied migration.
- Keep Node SQLite and local D1 parity tests passing. Do not add runtime-specific schema variants.
- Do not apply a remote migration without explicit authorization, a verified backup, and a tested recovery path.
- Passwords exist only in the self-describing hash format. Runtime dual-read of any other credential format is forbidden.

## Changing behavior

For an API change:

1. Update the shared request/response schema.
2. Update the domain service and its authorization and audit behavior.
3. Update the store transaction and route/presenter.
4. Verify both runtime composition paths.
5. Update Portal consumers only when the product contract changes.

For a schema change:

1. Update the Drizzle schema and any named invariant SQL.
2. Add the next contiguous ordinal migration and its manifest checksum entry.
3. Run schema parity, Node SQLite, and local workerd D1 tests.
4. Update shared contracts and domain/store tests.

## Validation

Run checks that match the risk of the change:

| Change | Minimum validation |
| --- | --- |
| Documentation only | `git diff --check` plus targeted path/link search |
| Shared/domain contract | Focused tests and affected package typechecks |
| Portal behavior/styles | Focused component tests, typecheck, and relevant visual/accessibility review |
| Store/schema | Focused store tests, schema parity, Node SQLite, and local D1 migration tests |
| Runtime adapter | Its conformance tests and runtime typecheck |
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

`release:check` runs locally only. CI does not authenticate with Cloudflare, deploy, or modify remote D1/R2.

## Pull request checklist

- [ ] The diff addresses one concern and preserves unrelated work.
- [ ] Shared contracts, domain rules, persistence, HTTP, and both runtimes stay synchronized.
- [ ] Authorization, audit, concurrency, media, and cleanup invariants have focused negative tests.
- [ ] Relevant typechecks/tests pass, and the pull request says exactly what ran.
- [ ] English/Chinese docs or UI resources stay synchronized when shared facts change.
- [ ] No secrets, private SQL, production identifiers, databases, blobs, or test artifacts are tracked.
- [ ] No deploy or remote migration is hidden in CI or a release-check script.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](./LICENSE).
