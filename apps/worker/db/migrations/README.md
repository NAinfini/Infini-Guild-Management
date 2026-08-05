# D1 Schema

This directory is the runtime source for Cloudflare D1 database creation.

Before the first production D1 database is created, `0000_core_schema.sql` is
the only SQL file and the only core migration that may be synchronized or
rebuilt in place. It defines the complete current schema and required built-in
records for a fresh database; database shapes from before that freeze point do
not have an upgrade path.

Use the project scripts for local verification:

```bash
pnpm db:mock:init
pnpm db:mock:rebuild
pnpm db:mock:migrations
```

The underlying Wrangler command is:

```bash
pnpm exec wrangler d1 migrations apply guild-portal-db --local --config apps/worker/wrangler.jsonc --persist-to apps/worker/.wrangler/state
```

## Source of truth

The Drizzle modules under `apps/worker/db/schema/` are the model source of truth
for runtime tables, relationships, indexes, and CHECK constraints.
`0000_core_schema.sql` must mirror that model and also declares SQLite-only
physical details such as `COLLATE NOCASE` usernames.

When changing the schema before the first production D1 database is created:

1. Update the relevant Drizzle schema module.
2. Synchronize `0000_core_schema.sql` with the final fresh-database shape.
3. Keep built-in roles, permissions, classes, and Site Config data aligned with
   the application seed.
4. Run the core-schema tests, a local D1 rebuild, and `pnpm typecheck`.

As soon as the first production D1 database is created, freeze
`0000_core_schema.sql` permanently. Every later schema change must use the next
monotonic incremental migration (`0001_...`, then `0002_...`) and a
data-preservation test.

D1 has no automatic rollback, so back up production data and verify the exact
incremental path locally before any remote migration is explicitly authorized.
