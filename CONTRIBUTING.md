# Contributing to Infini Guild Management

Thank you for your interest in contributing. Start with [SETUP.md](./SETUP.md), and ask for help through the setup issue form if the local environment does not start.

## Ground rules

1. **Discuss large changes first.** Bug fixes and small documentation improvements can go directly to a pull request. Open an issue before major features or architectural changes.
2. **One concern per PR.** Each pull request must address exactly one feature, bug fix, or refactor. Do not bundle unrelated changes.
3. **Full-stack consistency.** Changes to the worker API must include corresponding updates to shared schemas and portal queries/mutations. Changes to the database schema must include matching SQL migrations.

## Branch strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready, always deployable |
| `feat/<name>` | New feature or page |
| `fix/<name>` | Bug fixes |
| `chore/<name>` | Tooling, CI, docs, dependencies |

- Branch from `main`. Rebase onto `main` before requesting review.
- Keep the branch focused and up to date with `main`.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/) strictly:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Allowed types:** `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `test`, `perf`, `ci`

**Scope** must be one of: `worker`, `portal`, `shared`, `db`, `build`, `deps`, `docs`

Examples:
```
feat(worker): add batch event detail endpoint
fix(portal): resolve dashboard blank page with RevealOnScroll
chore(db): add enum constraints to Drizzle schema
refactor(shared): extract war team validation into dedicated schema
```

Commits that do not follow this format will be rejected by CI.

## Code standards

### TypeScript
- **Strict mode** — no `any`, no `@ts-ignore`, no `@ts-expect-error` without a linked issue number.
- Use shared Zod-inferred types when a schema exists.
- Follow the existing file's type style; component props use `type` aliases.

### React (Portal)
- Function components only — no class components.
- Use co-located CSS and existing Mantine/theme tokens.
- No `useEffect` for derived state — use `useMemo` or computed values.
- Components receive data through hooks or services; do not import the raw API client directly.

### Backend (Worker)
- All request validation must use Zod schemas from `apps/shared/schemas/`.
- Route handlers should be thin — delegate business logic to `apps/worker/services/`.
- All mutations must write to `audit_log` via `writeAuditLog()`.
- Use `nanoid()` for all ID generation.
- **Permission cache:** Role permission rows are cached per-isolate for 60 seconds. After changing a role's permissions via admin, other isolates may serve stale data until TTL expires. For sensitive permission checks (delete, role change), pass `{ freshPermissions: true }` to `resolveSession()`.

### Database
- Drizzle schema is the source of truth. SQL migrations must match exactly.
- Each domain gets its own schema file with a domain header comment.
- All `text()` columns with constrained values must use `{ enum: [...] }`.
- Foreign keys that represent ownership (e.g., `event_participants.event_id`) should use `{ onDelete: "cascade" }`.
- Run `pnpm db:generate` after any schema change.

### Shared schemas
- Zod schemas live in `apps/shared/schemas/` and are the single source of validation for both worker and portal.
- TypeScript types are inferred from Zod schemas using `z.infer<>`.
- Do not define types manually if a Zod schema exists.

## Project structure

```
apps/
├── shared/        # Zod schemas, types, constants (shared contract)
├── worker/        # Cloudflare Worker (Hono API + D1 + R2)
│   ├── routes/    # API route handlers
│   ├── services/  # Business logic (15 services)
│   ├── middleware/ # Auth, RBAC, rate-limit, ETag, security-headers
│   ├── crons/     # Scheduled jobs (5 jobs)
│   ├── tests/     # Integration and contract tests
│   └── db/        # Drizzle schema + SQL migrations
└── portal/        # React SPA (TanStack Router + Query + Mantine)
    ├── api/       # HTTP client, queries, mutations
    ├── components/ # Pages, layout, shared, feature, dashboard
    ├── services/  # Portal service layer (3 services)
    ├── stores/    # Zustand stores (auth, preferences, notifications, guildWar)
    ├── hooks/     # Custom hooks (data, guild-war, feature-specific)
    ├── utils/     # Utility functions
    └── i18n/      # Translations (en, zh — 14 namespaces each)
```

## Adding a new feature

### Backend (Worker)

1. Add Zod schema(s) in `apps/shared/schemas/<domain>.ts`.
2. Add/update types in `apps/shared/types/`.
3. Add database table if needed (see Database section above).
4. Add route handler in `apps/worker/routes/<domain>.ts`.
5. Add service logic in `apps/worker/services/` for complex business rules.
6. Write audit log entries for all mutations.
7. Update `AGENTS.md` file index if new files were added.

### Frontend (Portal)

1. Add TanStack Query fetcher in `apps/portal/api/queries/`.
2. Add mutation hook in `apps/portal/api/mutations/` if write operation.
3. Add portal service in `apps/portal/services/` to encapsulate API interaction logic.
4. Create page component in `apps/portal/components/pages/` or feature component in `apps/portal/components/feature/`.
5. Add data hook in `apps/portal/hooks/data/` for complex data fetching patterns.
6. Add route in `apps/portal/router.tsx`.
7. Add i18n keys in `apps/portal/i18n/en/` and `zh/`.
8. Update `CHANGELOG.md` under `[Unreleased]`.

## Testing

- Run `pnpm typecheck` before pushing — zero errors required.
- For portal changes, visually verify under **at least two themes** and **two motion levels** (`full` and `off`).
- For worker changes, test endpoints with `pnpm dev:worker`.
- For database changes, verify with `pnpm db:mock:rebuild`.

## Pull request checklist

Before requesting review, confirm:

- [ ] Related issue is linked when one exists
- [ ] Branch is rebased on latest `main`
- [ ] `pnpm typecheck` passes with zero errors
- [ ] Commit messages follow Conventional Commits
- [ ] No unjustified `any`, `@ts-ignore`, or hardcoded design values
- [ ] Shared schemas updated if API contract changed
- [ ] SQL migration generated if schema changed (`pnpm db:generate`)
- [ ] i18n keys added for new UI text (both `en/` and `zh/`)
- [ ] Portal tested under >= 2 themes and >= 2 motion levels
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] No unrelated changes included

## What will get your PR rejected

- Bundling multiple concerns
- Breaking existing API contracts
- Zod schema / Drizzle schema / SQL migration desync
- Introducing dependencies without prior discussion
- Ignoring TypeScript strict mode
- Hardcoded styles instead of design tokens
- Missing i18n translations
- Missing audit log entries for mutations
- Incomplete changelog entry

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
