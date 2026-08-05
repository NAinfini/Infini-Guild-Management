# Contributing to Infini Guild Management

Thank you for contributing. Start with [SETUP.md](./SETUP.md); keep changes focused, evidence-based, and compatible with the current architecture.

## Ground rules

1. Discuss major features, cross-system redesigns, infrastructure changes, and new dependencies before implementation. Small fixes and documentation corrections can go directly to a pull request.
2. Keep one concern per pull request. Do not bundle unrelated cleanup, renames, formatting, or dependency updates.
3. Preserve shared-workspace changes. Never reset, clean, or overwrite files outside your scope.
4. Keep contracts aligned across `apps/shared`, `apps/worker`, and `apps/portal` when behavior crosses a boundary.
5. Do not commit secrets, populated local environment files, generated runtime state, or build artifacts.

## Branches and commits

Branch from `main` using a descriptive prefix such as `feat/`, `fix/`, `docs/`, or `chore/`. Rebase or merge the latest `main` according to the maintainer's requested workflow before review.

Clear imperative commit subjects are required. Conventional Commit style is welcome, for example:

```text
fix(portal): preserve filters when reopening an event
docs(db): clarify the pre-release migration policy
```

The repository does not enforce Conventional Commits in CI, so do not rewrite otherwise clear history solely to satisfy that format.

## Architecture boundaries

### Shared contracts

- Put cross-runtime Zod schemas, constants, inferred types, limits, and utilities in `apps/shared/`.
- Infer TypeScript types from Zod when a shared schema already defines the contract.
- Keep API request/response schemas, Worker behavior, portal consumers, and tests synchronized.
- Static event and guild-war rules are source-owned. Do not move them into Site Config or dynamic D1 tables.

### Portal

- Use function components, Mantine primitives, the established semantic tokens, and co-located component styles.
- Components must consume data through existing services and hooks; they must not import the raw API client or raw query/mutation modules.
- Keep server state in TanStack Query and use Zustand only for established client/session/UI state.
- Define route behavior in `apps/portal/router.tsx` and navigation metadata in `apps/portal/components/layout/route-metadata.ts`.
- Add every user-facing string to both English and Chinese resources.
- Preserve light/dark themes, keyboard focus, reduced motion, responsive task parity, and the protected Roster member-card interaction.
- Follow [DESIGN.md](./DESIGN.md); exact token values are sourced from the CSS and theme implementation.

### Worker

- Validate request boundaries with shared Zod schemas.
- Keep route handlers focused on HTTP parsing, authorization, and response mapping; put business rules and transactions in services.
- Use `requirePermission()` for protected operations. Permissions are resolved from D1 per request and may be cached only within that request. Isolate-wide permission caches are forbidden.
- Preserve the existing middleware order for request IDs, configuration checks, CORS, security headers, mutation-origin checks, rate limits, body limits, ETags, session handling, and feature gates.
- Record audit entries for mutating operations using the established service dependencies.
- The tracked Worker configuration is `apps/worker/wrangler.jsonc`. Secrets belong in Cloudflare secrets, not tracked JSON.

### Database

- Drizzle modules in `apps/worker/db/schema/` are the runtime model source of truth.
- Follow [the migration policy](./apps/worker/db/migrations/README.md). Before the first production D1 database is created, `0000_core_schema.sql` may be synchronized or rebuilt in place. As soon as that database is created, freeze `0000` permanently; every later schema change uses monotonic incremental migrations starting at `0001_...`.
- Keep Drizzle and SQL checks, foreign keys, indexes, and required baseline rows aligned.
- Do not apply remote migrations without explicit authorization.

### Media

- Browser uploads use `convertFileForUpload()` or its batch helper from `apps/shared/utils/media.ts`.
- Worker uploads enforce the shared allowlist and verify magic bytes with `validateUploadBytes()` before any R2 write.
- Preserve media-reference, upload-lease, and compensation behavior so D1 and R2 cannot silently diverge.
- The single `MEDIA` R2 binding stores content media and audit archives.
- Tests must use bytes matching the declared MIME type.

## Adding or changing behavior

For an API change:

1. Update the shared schema or constant when the contract changes.
2. Update the Worker route and service, including authorization and audit behavior.
3. Update portal query/mutation, service/hook, and UI consumers.
4. Add the smallest relevant service, route, contract, or component test.

For a portal route:

1. Add the page and lazy route in `apps/portal/router.tsx`.
2. Update `route-metadata.ts` when it belongs in navigation.
3. Add both English and Chinese text.
4. Verify access, feature flags, loading/error/empty states, and the responsive composition.

For a schema change:

1. Update the relevant Drizzle module.
2. Synchronize the applicable SQL according to the migration phase.
3. Update shared contracts and consumers if the API shape changes.
4. Run the focused migration parity/constraint tests and rebuild a local D1 database.

## Validation

Choose checks in proportion to the change. A scoped change does not require the full release gate by default.

| Change | Minimum validation |
| --- | --- |
| Documentation only | `git diff --check` plus targeted link/path/script search |
| Shared or TypeScript contract | focused tests and `pnpm typecheck` |
| Portal behavior or styles | focused component/style tests, `pnpm typecheck`, and relevant light/dark/responsive review |
| Worker route or service | focused service/route tests and `pnpm typecheck` |
| D1 schema or SQL | focused migration tests, `pnpm db:mock:rebuild`, and `pnpm typecheck` |
| Release candidate | `pnpm release:check` |

Useful commands are defined in `package.json`:

```bash
pnpm typecheck
pnpm lint
pnpm test -- <focused paths>
pnpm build
pnpm build:worker
pnpm test:e2e
pnpm check:secrets
pnpm config:check -- --env=production
pnpm release:check
```

`pnpm test:e2e` builds the portal and runs isolated Playwright slots against Worker-served production assets. Use it for cross-layer browser behavior, not as a substitute for focused tests.

## Pull request checklist

- [ ] The diff addresses one concern and preserves unrelated workspace changes.
- [ ] Shared, Worker, portal, schema, and SQL contracts are synchronized where applicable.
- [ ] Relevant focused tests and checks pass; the PR states exactly what ran.
- [ ] Security, permission, audit, concurrency, media, and data-cleanup behavior remain intact.
- [ ] New UI text exists in English and Chinese.
- [ ] English/Chinese documentation pairs are synchronized when their shared facts change.
- [ ] `CHANGELOG.md` is updated for notable behavior, security, data, or operational changes.
- [ ] No secrets or unreviewed production binding changes are included.
- [ ] No unrelated generated files, test artifacts, or build output are included.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](./LICENSE).
