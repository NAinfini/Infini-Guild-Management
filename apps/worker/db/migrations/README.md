# D1 Migrations

This directory is the runtime source for Cloudflare D1 migrations.

Use the project scripts for local development when possible:

```bash
pnpm db:mock:init
pnpm db:mock:rebuild
pnpm db:mock:migrations
```

The underlying Wrangler command is:

```bash
wrangler d1 migrations apply guild-portal-db --local --config apps/worker/wrangler.jsonc --persist-to apps/worker/.wrangler/state
```

## Versioned Migration Policy

Production migration tracking starts at `0001_release_schema_upgrade.sql`.
`0000_core_schema.sql` is an immutable historical baseline: never edit a
migration that may already have been applied. Every schema change now receives a
new, monotonically numbered SQL file.

When changing the schema:

1. Update the relevant Drizzle schema file in `apps/worker/db/schema/`.
2. Generate or write the next incremental migration without changing older files.
3. Add an upgrade-path test that starts from the previously released schema and preserves representative data.
4. Run `pnpm db:mock:rebuild` to verify a fresh database can apply all migrations in filename order.
5. Run the migration tests and `pnpm typecheck` before handing off the change.

D1 has no automatic rollback. Back up production data and test the exact
incremental path locally before any remote migration is explicitly authorized.

## Schema Source of Truth

The Drizzle schema is split by domain:

| File | Domain |
| --- | --- |
| `apps/worker/db/schema/auth.ts` | users, roles, invite links, sessions |
| `apps/worker/db/schema/members.ts` | member profiles |
| `apps/worker/db/schema/events.ts` | events and participants |
| `apps/worker/db/schema/announcements.ts` | announcements |
| `apps/worker/db/schema/guild-war.ts` | guild war history, teams, pool members, templates |
| `apps/worker/db/schema/wiki.ts` | wiki categories and articles |
| `apps/worker/db/schema/gallery.ts` | gallery items |
| `apps/worker/db/schema/audit.ts` | audit log |

`apps/worker/db/schema/index.ts` exports the schema modules used by worker code.

## Existing Migration Files

- `0000_core_schema.sql`: immutable v1 baseline already used by existing installations.
- `0001_release_schema_upgrade.sql`: production-ready incremental upgrade to the current Drizzle runtime schema. It preserves legacy onboarding records under `legacy_*` table names, normalizes ordered relations, backfills exact media references, and leaves resumable media-domain checkpoints unset.

Migration tests discover `NNNN_*.sql` files, sort them by filename, and execute
the complete sequence. `release-schema-upgrade.test.ts` separately verifies both
the existing-database path (`0000` data followed by `0001`) and an empty-database
build (`0000` + `0001`).
