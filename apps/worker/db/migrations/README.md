# D1 Migrations

This directory is the runtime source for Cloudflare D1 migrations.

## Production sequence

- `0000_core_schema.sql` is the immutable schema baseline captured from the
  production schema-only export. It intentionally retains the production-only
  `game_data`, `onboarding_config`, and `member_onboarding_state` tables.
- `0001_release_schema_upgrade.sql` validates the legacy data before any table
  replacement, then upgrades the baseline to the current runtime schema with
  data-preserving shadow-table rebuilds.
- The three production-only tables are not renamed, altered, updated, or
  deleted by `0001`. Media reference backfills only insert references that
  can be derived exactly from D1 rows; migrations never read or write R2.

Every future schema change must use the next monotonically numbered SQL file.
Never edit a migration after it has been applied to production.

## Local verification

Use the project scripts for local development:

```bash
pnpm db:mock:init
pnpm db:mock:rebuild
pnpm db:mock:migrations
```

The underlying local command is:

```bash
pnpm exec wrangler d1 migrations apply guild-portal-db --local --config apps/worker/wrangler.jsonc --persist-to apps/worker/.wrangler/state
```

Migration tests discover `NNNN_*.sql` files and apply them in filename order.
`release-schema-upgrade.test.ts` separately verifies the production-shaped
upgrade path, preflight failures, protected-table preservation, normalized
relations, final constraints, foreign-key integrity, and a fresh `0000` to
`0001` build.

D1 has no automatic rollback. Back up production and test the exact incremental
path locally before any remote migration is explicitly authorized.
