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

## Current v1 Policy

The project is still in v1 development. Routine schema changes should update the baseline schema instead of adding incremental migration files.

When changing the schema:

1. Update the relevant Drizzle schema file in `apps/worker/db/schema/`.
2. Update `apps/worker/db/migrations/0000_core_schema.sql`.
3. Run `pnpm db:mock:rebuild` to verify the local database can rebuild from the baseline.
4. Run `pnpm typecheck` before handing off the change.

Do not add new incremental migration files for ordinary v1 changes unless the project explicitly starts versioned production migration tracking.

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
| `apps/worker/db/schema/game-data.ts` | equipment calculator game-data versions |

`apps/worker/db/schema/index.ts` exports the schema modules used by worker code.

## Existing Migration Files

- `0000_core_schema.sql`: active v1 baseline schema. It should contain every table needed to rebuild a fresh local D1 database.

## Future Versioned Migration Rules

When the project switches from v1 baseline editing to production migration tracking:

1. Stop editing already-applied migration files.
2. Generate a new migration with `pnpm db:generate`.
3. Review generated SQL before applying it.
4. Apply the migration to local D1 with `pnpm db:mock:init`.
5. Apply staging before production.
6. Keep Drizzle schema, SQL migrations, seed data, and shared Zod schemas in sync.

Until that switch happens, treat `0000_core_schema.sql` as the rebuildable baseline.
