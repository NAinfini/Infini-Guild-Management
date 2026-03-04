# DB Versioning Rules

This project is currently in **v1 dev mode**.

## Current Policy (v1 dev mode)

1. Edit schema **directly** in:
   - `apps/worker/db/schema/*.ts`
   - `apps/worker/db/migrations/0000_core_schema.sql`
2. Do **not** add new incremental migration files for day-to-day v1 changes.
3. Apply changes immediately by rebuilding local DB:
   - `pnpm db:mock:rebuild`

## Snapshot Rules

1. Exactly **one snapshot file per released version**.
2. Path format:
   - `apps/worker/db/versions/snapshots/v<major>.<minor>.<patch>.sql`
3. Snapshot file must be schema-only export (`--no-data`).
4. Snapshot files are immutable after release.

Example:
- `snapshots/v1.0.0.sql`
- `snapshots/v2.0.0.sql`

## Between-Version Migration Rules

1. Create a migration file **only** between released versions.
2. One file per version pair.
3. Path format:
   - `apps/worker/db/versions/migrations/v<from>_to_v<to>.sql`
4. Migration file must contain:
   - data backfill/transform SQL,
   - constraint/index changes,
   - comments for irreversible operations.

Example:
- `migrations/v1.0.0_to_v2.0.0.sql`

## Release Workflow

1. Freeze schema for release version.
2. Export snapshot:
   - `wrangler d1 export infini-guild-db --local --config apps/worker/wrangler.jsonc --persist-to apps/worker/.wrangler/state --output apps/worker/db/versions/snapshots/vX.Y.Z.sql --no-data`
3. For next release, add one between-version migration file.
4. Verify with clean rebuild and basic query checks.
