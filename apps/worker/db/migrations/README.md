# D1 Migrations

This directory is the runtime source for Cloudflare D1 migrations.

## Production sequence

- `0000_core_schema.sql` is the fresh pre-release schema baseline. It contains
  the normalized media asset/variant/link model and omits superseded media,
  onboarding, and game-data tables.
- Guild-war team objectives are nullable `own_*` / `enemy_*` REAL columns on
  `war_history`; member metrics are nullable REAL columns on
  `war_team_members`. The API assembles the existing stats objects at its
  boundary instead of persisting JSON.
- `site_config` is one checked `id = 'default'` row. Feature flags, media
  limits and quotas, storage/absence policies, and the five fixed analytics
  weights are ordinary typed columns; the primary key is the only lookup index
  needed for this singleton.
- Seed rows leave `created_at` / `updated_at` to the column default, so every
  database records its own creation time rather than the day this file was
  generated.
- The baseline seeds deployment-neutral data plus a complete authoritative
  `site_config` row named `Infini Guild`. Runtime reads never fabricate a
  missing row; logo media is attached through `media_links`.

This baseline is intentionally fresh-only: no compatibility parser, dual write,
fallback, or data-preservation migration is part of the pre-release schema.
After the first release, every schema change must use the next monotonically
numbered SQL file, and no applied migration may be edited.

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
