# D1 Migration Runtime Folder

This folder remains the runtime source for:

```bash
wrangler d1 migrations apply infini-guild-db --config apps/worker/wrangler.jsonc --persist-to apps/worker/.wrangler/state
```

## Current v1 Policy

We are in **v1 dev mode**:

1. Edit schema directly in:
   - `apps/worker/db/schema/*.ts`
   - `apps/worker/db/migrations/0000_core_schema.sql`
2. Do not add new incremental migration files for routine v1 development.
3. Rebuild local DB after schema edits:
   - `pnpm db:mock:rebuild`

## Schema Source of Truth

Drizzle schema has been split into modules under:

- `apps/worker/db/schema/auth.ts`
- `apps/worker/db/schema/members.ts`
- `apps/worker/db/schema/events.ts`
- `apps/worker/db/schema/announcements.ts`
- `apps/worker/db/schema/guild-war.ts`
- `apps/worker/db/schema/wiki.ts`
- `apps/worker/db/schema/gallery.ts`
- `apps/worker/db/schema/audit.ts`

`apps/worker/db/schema.ts` re-exports `schema/index.ts` for module resolution (imports use `../db/schema`).

## Existing Files

- `0000_core_schema.sql` = active v1 baseline schema (all tables consolidated here).

## Snapshot + Between-Version Migration Rules
