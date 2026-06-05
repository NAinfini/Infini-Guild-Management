# Migration Strategy

## Current State: v1-dev-baseline

All schema is defined in a single file: `0000_core_schema.sql`, which uses `CREATE TABLE IF NOT EXISTS` throughout.

**Limitations of this approach:**

- Cannot represent incremental schema changes (column additions, renames, drops) without rebuilding from scratch.
- Wrangler tracks which migration files have been applied by filename hash — once `0000_core_schema.sql` is applied to a live database, editing it will not re-apply on that database.
- No rollback path exists for schema changes applied against a live D1 database.
- Not suitable for production once the database holds real data.

The `versions.json` file documents the current mode as `v1-dev-baseline`.

---

## Switching to Versioned Production Migrations

When the project is ready to track schema changes incrementally (i.e., production data must be preserved):

1. **Freeze `0000_core_schema.sql`** — stop editing it. It remains the baseline for fresh databases.

2. **Generate new migration files** using drizzle-kit:

   ```bash
   pnpm db:generate
   ```

   This compares the current Drizzle schema (`apps/worker/db/schema/`) against the last known snapshot and outputs a new SQL file (e.g., `0001_add_column_foo.sql`) into this directory.

3. **Review the generated SQL** before applying. Drizzle-kit may emit destructive statements (`DROP COLUMN`, `ALTER TABLE RENAME COLUMN`) — verify they are correct.

4. **Apply migrations locally first:**

   ```bash
   pnpm db:mock:migrations
   ```

   Or directly with Wrangler:

   ```bash
   wrangler d1 migrations apply guild-portal-db --local \
     --config apps/worker/wrangler.jsonc \
     --persist-to apps/worker/.wrangler/state
   ```

5. **Apply to staging before production:**

   ```bash
   wrangler d1 migrations apply guild-portal-db-staging --env staging --config apps/worker/wrangler.jsonc
   wrangler d1 migrations apply fanghuazhaoyun-db --env production --config apps/worker/wrangler.jsonc
   ```

   Wrangler tracks which files have been applied (by filename) and only executes new ones.

6. **Update `versions.json`** to reflect the new mode and current version.

---

## Rollback Strategy

D1 has no built-in rollback. The strategy is manual rollback scripts.

For every forward migration file `XXXX_description.sql`, create a corresponding `XXXX_rollback.sql` in this directory. Rollback files are **not auto-executed** — they are applied manually only if a migration must be reversed.

**Naming convention:**

```
0001_add_column_foo.sql         ← forward migration (auto-applied by Wrangler)
0001_rollback.sql               ← rollback script (manual only, never auto-applied)
```

**To roll back a migration manually:**

```bash
# Apply to local
wrangler d1 execute guild-portal-db --local \
  --config apps/worker/wrangler.jsonc \
  --file apps/worker/db/migrations/0001_rollback.sql

# Apply to staging
wrangler d1 execute guild-portal-db-staging --env staging \
  --config apps/worker/wrangler.jsonc \
  --file apps/worker/db/migrations/0001_rollback.sql

# Apply to production
wrangler d1 execute fanghuazhaoyun-db --env production \
  --config apps/worker/wrangler.jsonc \
  --file apps/worker/db/migrations/0001_rollback.sql
```

After manually executing a rollback, Wrangler's applied-migrations record still shows the forward migration as applied. You must also delete or rename the forward migration file, or manually remove its entry from the D1 migrations table (`d1_migrations`) if you want Wrangler to re-apply it in the future.

---

## Testing Migrations Locally

Always test on a local D1 instance before applying to staging or production.

1. Make schema changes in `apps/worker/db/schema/`.
2. Run `pnpm db:generate` to produce the migration SQL.
3. Rebuild local DB from scratch to verify no conflicts:

   ```bash
   pnpm db:mock:rebuild
   ```

4. Apply only the new migration against an existing local state:

   ```bash
   pnpm db:mock:migrations
   ```

5. Run `pnpm typecheck` to verify Drizzle types match the updated schema.

---

## Quick Reference

| Task | Command |
|---|---|
| Generate migration from schema diff | `pnpm db:generate` |
| Apply all pending migrations (local) | `pnpm db:mock:migrations` |
| Rebuild local DB from baseline | `pnpm db:mock:rebuild` |
| Apply to staging | `wrangler d1 migrations apply guild-portal-db-staging --env staging --config apps/worker/wrangler.jsonc` |
| Apply to production | `wrangler d1 migrations apply fanghuazhaoyun-db --env production --config apps/worker/wrangler.jsonc` |
| Execute rollback script (staging) | `wrangler d1 execute guild-portal-db-staging --env staging --config apps/worker/wrangler.jsonc --file apps/worker/db/migrations/XXXX_rollback.sql` |
