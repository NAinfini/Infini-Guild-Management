# Contributing to Infini Guild Management

[Documentation home](../README.md) · [中文版本](./CONTRIBUTING.zh.md)

Thanks for helping improve the project. Read [SETUP.md](./SETUP.md) and [AGENTS.md](../AGENTS.md) first. Keep your change focused, work from evidence, and respect the modular backend boundaries.

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

### Reproduce CI

Run commands from a Git checkout's root. CI uses **Ubuntu 24.04**; GitHub maintains its OS image updates. Node and pnpm are exact requirements, enforced during installation. Use the committed lockfile rather than resolving new versions.

CI runs on pushes to `main` and pull requests targeting `main`, avoiding duplicate push/PR runs for the same feature branch.

| Tool | Version used by this release | Authority |
| --- | --- | --- |
| Node.js | 26.5.1 | `.node-version` and `package.json` engines |
| pnpm | 11.17.0 | `package.json` packageManager and engines |
| TypeScript compiler | Native 7.0.2 | `@typescript/native` alias; scripts call its compiler explicitly |
| TypeScript library | 6.0.2 | `typescript` alias to `@typescript/typescript6`; used by ESLint and other tooling |
| ESLint | 10.9.1 | Root `eslint.config.js`; legacy `.eslintrc` files are not used |
| Vitest / Vite | 4.1.11 / 8.2.2 | Root `package.json` and `pnpm-lock.yaml` |
| Playwright | 1.62.1 | Installs Chromium 151.0.7922.34, revision 1234, from its bundled browser manifest |
| Wrangler / Miniflare | 4.127.1 / 5.20260828.0-alpha | Pinned together for local workerd configuration mapping |
| All other packages | Exact resolved versions | `pnpm-lock.yaml`, including transitive dependencies |

Select Node 26.5.1 with your Node version manager, then run:

```bash
npm install --global pnpm@11.17.0
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm release:check
# Linux: installs Chromium and its required system libraries (may request sudo).
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

On Windows or macOS, use `pnpm exec playwright install chromium` for browser installation. No global TypeScript, ESLint, Vitest, Vite or Wrangler installation is needed. CI uses SHA-pinned Actions and no production secrets. It splits the complete browser suite across three independent runners with `pnpm test:e2e --shard=1/3`, `--shard=2/3` and `--shard=3/3`; the command without `--shard` runs the complete suite locally. No tests are sampled or skipped by sharding. When changing tool versions, update the manifest, lockfile and this table together; also update `.node-version` when changing Node. Reinstall Playwright's browser after changing Playwright.

`pnpm typecheck` checks the workspace (including test/config files), Cloudflare and VPS. The runtime configurations deliberately use different ambient types. `pnpm lint` rejects warnings as well as errors. `release:check` executes those checks and all Vitest projects, builds the Portal once, then creates both runtime bundles. Standalone `pnpm cloudflare build` and `pnpm vps build` still perform their own checks and Portal build; `bundle:*` commands are internal artifact steps, not substitutes for validation.

Vitest separates Portal/jsdom, a process-isolated timezone/DST test, shared/scripts Node tests, and backend/runtime tests. POSIX filesystem-mode tests run on POSIX hosts; the Windows-specific case runs on Windows. These conditional cases are intentional platform coverage. Similar Cloudflare and VPS tests protect different adapters and must remain. E2E has guest, member and admin projects, with no automatic retries; it builds the Portal and Worker before starting two isolated local database/blob slots. Tests must restore the database/blob baseline, and a cleanup failure fails the run.

Useful focused commands:

```bash
pnpm test --project=portal
pnpm test apps/portal/components/pages/StoragePage.test.tsx
pnpm test:e2e --project=admin apps/portal/e2e/specs/admin/profile-account.spec.ts
pnpm test:e2e:ui
```

E2E owns ports **8787–8788** and inspector ports **9329–9330** by default. Stop your local dev server first, or select free ports. For example, on Linux/macOS:

```bash
E2E_PORT_BASE=8887 E2E_INSPECTOR_PORT_BASE=9429 pnpm test:e2e
```

In PowerShell:

```powershell
$env:E2E_PORT_BASE = '8887'
$env:E2E_INSPECTOR_PORT_BASE = '9429'
pnpm test:e2e
```

`E2E_SLOTS=1` runs one isolated slot when local resources are limited; each CI shard keeps two. Do not run two E2E commands in the same checkout concurrently: their ignored state, artifact and log directories are shared. Startup refuses occupied ports and missing/stale bundles; use `pnpm test:e2e` to rebuild. Worker access logs go to `apps/portal/e2e/.logs/` instead of flooding the console; errors remain visible. Failures retain diagnostics under `.artifacts/` and `.logs/`; each failed CI shard uploads its own `playwright-report/` and full server logs for seven days. Do not commit these generated files.

### Test policy

- Test durable user behavior, business rules, authorization, security, data integrity, accessibility, and runtime parity.
- Do not test exact pixels, spacing, border widths, colours, CSS class names, source-code strings, or which file owns a style. Those are design-review concerns, not stable product contracts.
- Prefer one focused test at the lowest useful layer. Add browser coverage only when it protects a real cross-page workflow, browser behavior, or integration boundary that a unit test cannot cover.
- Keep migration and hostile-input tests when they protect real data or security, even if their fixtures are described as legacy. Delete compatibility tests only after the compatibility path itself is intentionally removed.
- A test should fail because a supported outcome became wrong, not because an equivalent implementation was refactored.

Run checks that match the risk of the change:

| Change | Minimum validation |
| --- | --- |
| Documentation only | `git diff --check` plus targeted path/link search |
| Shared/domain contract | Focused tests and affected package typechecks |
| Portal behavior/styles | Focused component tests, typecheck, and relevant visual/accessibility review |
| Store/schema | Focused store tests, schema parity, Node SQLite, and local D1 migration tests |
| Runtime adapter | Its conformance tests and runtime typecheck |
| Release candidate | `pnpm release:check` and `pnpm test:e2e` |

Useful commands:

```bash
pnpm typecheck
pnpm lint
pnpm test <focused paths>
pnpm build:portal
pnpm cloudflare build
pnpm vps build
pnpm test:e2e
pnpm config:check --runtime cloudflare --config apps/cloudflare/wrangler.example.jsonc --allow-placeholders
pnpm config:check --runtime vps --config scripts/templates/vps.env.example --allow-placeholders
pnpm release:check
```

`release:check` runs locally only and intentionally excludes browser E2E. CI runs it alongside three isolated Chromium E2E shards; no job authenticates with Cloudflare, deploys, or modifies remote D1/R2.

## Pull request checklist

- [ ] The diff addresses one concern and preserves unrelated work.
- [ ] Shared contracts, domain rules, persistence, HTTP, and both runtimes stay synchronized.
- [ ] Authorization, audit, concurrency, media, and cleanup invariants have focused negative tests.
- [ ] Relevant typechecks/tests pass, and the pull request says exactly what ran.
- [ ] English/Chinese docs or UI resources stay synchronized when shared facts change.
- [ ] No secrets, private SQL, production identifiers, databases, blobs, or test artifacts are tracked.
- [ ] No deploy or remote migration is hidden in CI or a release-check script.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](../LICENSE).
