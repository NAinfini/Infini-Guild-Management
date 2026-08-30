# Production D1 upgrade and release runbook

Status: **Deployed under an explicit one-release CI waiver — the latest tested application is live and maintenance is disabled. Local release validation passed; the CI Browser E2E failure remains a separate open diagnosis.**

This runbook is the handoff authority for upgrading the existing Cloudflare D1 database through the current `0000_core`–`0017_notice_delivery` chain. It does not itself authorize a remote migration, deployment, restore, or production configuration write.

## Goal and non-negotiable outcomes

- Preserve every production business row and every referenced R2 object.
- Keep the site working after each maintenance window.
- Keep PBKDF2-HMAC-SHA256 at the `10000` default and minimum for the Cloudflare Workers CPU limit. Site owners may explicitly raise it through `IG_PBKDF2_ITERATIONS` after measuring the target runtime, up to `10000000`.
- Upgrade the existing production database with the current ordered chain and retain that released history.
- Keep the released `0000_core.sql` frozen. Later schema changes add the next contiguous ordinal migration; they never rewrite the baseline or introduce runtime compatibility branches.
- Never edit Wrangler's `d1_migrations` table manually.

## Current checkpoint

- The latest tested application is deployed and maintenance is disabled. `/api/health`, public site config, browser navigation to `/` and `/login`, and the SPA index returned `200`.
- An authenticated production-browser smoke check exercised roster and recurring events with two templates; event-scene images loaded and media avatars were readable. This is scoped evidence, not an all-features claim; a separate ordinary-member login pass was not recorded.
- The reported recurring-route `500` and missing event background are not currently reproduced by browser and asset checks. Hover audio returned `200 audio/ogg`; audible playback remains unconfirmed and is still under diagnosis.
- Both production migration ledgers contain the exact completed `0000`–`0017` chain, with no pending migration; the repository contains the same 18 contiguous migrations.
- Local SQLite and workerd D1 upgrade/parity tests pass. On 2026-08-30, the real production export was restored into isolated workerd D1 and upgraded with Wrangler `4.127.1`: all 17 pending migrations passed, all 68 application tables matched the exact expected row contents, and tables/indexes/triggers plus both ledgers matched.
- A full post-deploy export confirms all 85 login names/password hashes, 56 media assets, 104 media variants, all media links, and both exact 18-entry ledgers are unchanged. `integrity_check` passed and foreign-key checks returned zero; no business row was deleted.
- R2 was reverified at 2026-08-30 21:43:23Z: 108 objects, 68,480,122 bytes, all 104 D1 references, and all 108 object SHA values are unchanged. These are checkpoint values, not permanent expected counts.
- Normal post-live activity changed sessions from 44 to 43 (three removed and two added), updated `users.last_login_at`, and made one site-description and one profile-power update. Those two normal updates added two audit rows (694 to 696) and changed no other business rows.
- Local release checks passed 2,315 tests (6 skipped) and 251 E2E tests. The failed CI Browser E2E run is covered only by the release owner's explicit one-release waiver; it remains open and is not a general CI bypass.
- The deployed application is the previously locally tested artifact; this status update includes no application-source change.

## Hard stop conditions

Stop without deploying or mutating production if any of these is true:

- Cloudflare account, database name, database ID, or deployment target is not independently confirmed.
- `app_migrations` and `d1_migrations` are not the same exact prefix of the checked-in migration chain.
- A migration ID, ordinal, filename, or checksum is unknown, missing, duplicated, or out of order.
- Any production password hash has a cost above the intended runtime value of `10000` and no explicit credential migration has been completed. A 10k Worker intentionally rejects stored hashes above its configured budget.
- The D1 export, Time Travel bookmark, R2 backup, or restore rehearsal is missing.
- The real-data scratch D1 rehearsal fails, approaches a D1 execution limit, changes unexpected row counts, or leaves a foreign-key error.
- The production Wrangler configuration, release gate, build, or E2E suite fails. The sole recorded exception is this release's explicitly approved CI Browser E2E waiver after independent local validation; it neither waives another stop condition nor creates a general CI bypass.
- Maintenance mode has not been verified before an incompatible schema or ledger transition.
- The rollback target crosses a Durable Object class lifecycle migration, or the previous code/assets cannot be restored with the current class identities.

## Phase A — upgrade the existing production D1 to `0017`

Do not squash or delete migrations during this phase.

### 1. Establish identity and read-only evidence

Use the stable database name rather than the `DB` binding when issuing remote D1 commands.

```powershell
$config = "apps/cloudflare/wrangler.jsonc"
$database = "<verified production database_name>"

pnpm exec wrangler whoami
pnpm exec wrangler deployments list --config $config
pnpm exec wrangler versions list --config $config
pnpm exec wrangler d1 info $database --config $config
pnpm exec wrangler d1 migrations list $database --remote --config $config
pnpm exec wrangler d1 execute $database --remote --config $config --command "SELECT id, ordinal, checksum FROM app_migrations ORDER BY ordinal"
pnpm exec wrangler d1 execute $database --remote --config $config --command "SELECT * FROM d1_migrations ORDER BY id"
```

Archive the raw outputs with the release record and compare them with the verified checkpoint above. Any drift requires a new review.

### 2. Verify credential cost before switching to the 10k runtime

```sql
WITH credential_costs AS (
  SELECT
    user_id,
    CAST(substr(password_hash, 15, instr(substr(password_hash, 15), '$') - 1) AS INTEGER) AS iterations
  FROM user_credentials
  WHERE password_hash GLOB 'pbkdf2-sha256$*$*$*'
)
SELECT iterations, count(*) AS credentials
FROM credential_costs
GROUP BY iterations
ORDER BY iterations;
```

Every production credential must report `10000` before deploying a Worker configured for `10000`. A higher-cost hash cannot be converted without the user's password. If one exists, stop and use an explicit password-reset or credential-migration operation; do not add a silent downgrade or a legacy authentication path.

### 3. Back up and rehearse

1. Record the current Worker version and a D1 Time Travel bookmark.
2. Export the production D1 database to protected temporary storage.
3. Back up R2 and record an object inventory because database media rows authorize exact blob keys.
4. Import the production export into an isolated scratch D1 database.
5. With the repository's pinned Wrangler and exact migration directory, apply every pending migration to scratch.
6. Record each migration duration and verify:

   - `app_migrations` contains the exact 18-row manifest;
   - Wrangler reports no pending migration;
   - `PRAGMA foreign_key_check` returns no rows;
   - `PRAGMA integrity_check` reports `ok` where supported;
   - every business-table row count matches the expected conversion;
   - media metadata still resolves to the same R2 objects;
   - administrator and member login, events, notices, invitations, Wiki, gallery, storage, guild wars, audit, and media reads work.

Do not enter the production window unless the scratch rehearsal can be repeated from a fresh export.

For this export, preserve complete trigger bodies when importing: Wrangler `4.127.1`'s general SQL splitter combines several exported CASE-bearing triggers. The verified local restore parsed the export with SQLite, created tables before inserting rows with deferred foreign keys, and then installed the exact indexes/triggers. It compared every restored row before applying the unchanged migration files. D1 does not authorize `PRAGMA integrity_check`; run that check on the closed, persisted local D1 SQLite file instead, while retaining the live D1 foreign-key check.

### Remote transport for CASE trigger migrations

For a released `CREATE TRIGGER` body containing `CASE`/`BEGIN`/`END`, a local migration pass is not sufficient proof that remote `migrations apply` will work. The local path splits compound statements before execution, while the remote path sends SQL through the service query endpoint. A read-only probe verified that the remote query endpoint rejects a valid CASE trigger with `incomplete input`, while the same SQL succeeds through remote `--file`; the rejected probe did not apply a migration.

Before an authorized production write, use a reviewed, read-only `EXPLAIN` comparison of a non-conflicting equivalent trigger through remote `--command` and remote `--file`. It establishes the transport/parser behavior without executing DDL or changing data.

For initialization or upgrade files with this grammar:

1. Keep the released migration bytes and manifest unchanged, and verify that both ledgers are the exact preceding prefix.
2. Use a reviewed generator outside source control to create a protected composite file: the migration's original UTF-8 bytes as an untouched prefix, followed by the exact standard `d1_migrations` suffix generated by the pinned Wrangler `buildMigrationQuery` for that filename and configured ledger table.
3. After explicit authorization, import one composite file at a time through the official file-import path:

   ```bash
   pnpm exec wrangler d1 execute <verified-database-name> --remote --config <protected-config> --file <protected-composite-file>
   ```

   The migration and the standard Wrangler ledger entry are then one atomic D1 import. Do not import a bare migration and append a ledger row afterward.
4. Export and compare schema, rows, indexes, triggers, and both ledgers after every file. Do not use remote `migrations apply` or `--command` for trigger-bearing SQL until its exact grammar has passed the read-only parser check.

### 4. Production maintenance window

The old Worker expects the old exact application ledger and the new Worker expects all 18 rows, so there is no gradual-deployment compatibility window.

1. Deploy or enable the tested maintenance response and verify that normal pages, API writes, WebSockets, and scheduled work are blocked while `/api/health` remains observable.
   Verify the actual deployed code, not an assumed release tag. If this release adds a Durable Object class, establish a maintenance-only recovery checkpoint that retains the previous application code/assets and includes the new class identity before changing D1; verify and record that checkpoint as the rollback target.
2. Wait for in-flight work to drain.
3. Record a new Time Travel bookmark, D1 export, R2 inventory, critical table counts, credential-cost counts, current Worker version, and release commit.
4. Re-read both migration ledgers and the pending list.
5. Apply the pending production D1 migrations by verified database name. Use the audited file-import route above for trigger-bearing SQL.
6. If any migration fails, keep maintenance enabled. Export and compare both ledgers before deciding whether the failed import was atomic; do not deploy either application version or hand-edit either ledger.
7. After success, verify the 18-row application ledger, Wrangler history, foreign keys, schema objects, critical counts, credentials, media/R2 references, and role-manager invariant.
8. Deploy the same tested commit with the complete production bindings, limits, Durable Objects, and cron schedules.
9. Disable maintenance and run administrator/member smoke tests.
10. Monitor Worker exceptions and CPU, D1 errors/latency, Durable Object errors, rate-limit behavior, WebSockets, and scheduled jobs for at least one operating window.

### 5. Phase A rollback

Keep or re-enable maintenance first. Restore D1 to the recorded pre-migration bookmark, verify both ledgers and critical counts, then restore the recorded recovery Worker version with its matching application code and assets. Restore the paired R2 state if any blob write occurred after the backup. A Worker rollback alone does not restore D1 and is not a valid rollback.

Cloudflare does not permit ordinary version rollback across Durable Object class lifecycle changes. This release adds `AuthRateLimitDO`; do not target the original pre-class version with a blind `wrangler rollback`. Retain the new class and its namespace, and use the verified recovery checkpoint on the same lifecycle state. Do not delete a class, rename an existing namespace, or reuse new Portal assets with the old API as a recovery shortcut. Recovery bundles belong in protected release backups, not in application compatibility branches.

## Migration history after this release

- Keep `0000_core.sql`, `0001`–`0017`, their manifest entries, and checksums immutable. They are the data-preserving deployment history for existing installations, not a runtime legacy or backward-compatibility layer.
- Fresh D1 and VPS databases apply the same ordered bytes as upgraded databases. The exact application-ledger gate remains the single schema contract.
- Do not collapse the chain, rewrite `app_migrations`, or edit `d1_migrations`. A future schema change adds the next contiguous ordinal migration.
- Development databases that may be discarded can be recreated from the released chain. Databases that contain retained data must always be upgraded through the reviewed chain.

## Final upgrade acceptance

- The repository migration source remains the exact immutable `0000`–`0017` chain.
- Fresh SQLite, fresh workerd D1, and upgraded production are structurally identical.
- The application and Wrangler ledgers record the complete released chain without manual edits.
- Local release validation passed 2,315 tests (6 skipped) and 251 E2E tests. The CI Browser E2E failure remains an open diagnosis allowed only by this release's explicit one-release waiver; CI is not optional.
- The recorded authenticated smoke check worked with the 10k configuration; no stored credential exceeds that budget. It does not constitute a separate ordinary-member login pass.
- Critical counts, media metadata, R2 object references, and the no-deletion check remain consistent with pre-operation evidence; only the two audited normal updates above changed mutable profile/site-configuration fields.
- Maintenance is disabled with the scoped authenticated smoke evidence recorded above; no separate ordinary-member login pass is claimed for this release.

## Official Cloudflare references

- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Workers rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
