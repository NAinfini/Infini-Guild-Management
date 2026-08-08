# D1 Migrations

This directory is the runtime source for Cloudflare D1 migrations.

## Production sequence

- `0000_core_schema.sql` is the immutable schema baseline: the squashed end
  state of the historical chain (core schema → release schema upgrade →
  dynamic role authority). It retains the production-only `game_data`,
  `onboarding_config`, and `member_onboarding_state` tables.
- Seed rows leave `created_at` / `updated_at` to the column default, so every
  database records its own creation time rather than the day this file was
  generated.
- The baseline seeds only deployment-neutral data (classes, roles,
  permissions). Site identity is not seeded: the worker creates the
  `site_config` row on first use from the `SITE_NAME` / `SITE_LOGO_URL` vars
  (`SiteConfigService.ensureSiteRow`).

Deployments initialized before the squash are unaffected: their `d1_migrations`
table already holds the three historical filenames, `0000_core_schema.sql`
among them, so `migrations apply` finds nothing to run. A fresh database
reaches the identical schema in one step.

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
`core-schema-parity.test.ts`, `core-schema-constraints.test.ts`,
`core-schema-indexes.test.ts`, and `core-schema-query-plans.test.ts` verify the
resulting database against the Drizzle schema, the declared constraints, the
declared indexes, and the query plans the runtime depends on.

D1 has no automatic rollback. Back up production and test the exact incremental
path locally before any remote migration is explicitly authorized.
