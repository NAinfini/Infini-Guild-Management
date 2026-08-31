# Production D1 upgrade and core-consolidation runbook

The 0.1.0 refresh folds the completed `0000`–`0017` chain into one final-state `0000_core.sql`. This explicitly authorized one-time cutover does not authorize automatic ledger repair. The application still accepts exactly one manifest.

**Release checkpoint (2026-08-30):** the owner requested Git/release publication only after consolidation. Production remains on commit `250544ba` with its completed 18-entry application ledger; no production adoption or deployment was performed for this source refresh. Do not deploy the consolidated source to that database until the maintenance-gated adoption below is complete.

## Choose the correct path

- **Fresh database:** initialize from the consolidated core: 68 application tables, 152 named indexes, 90 triggers and canonical seeds, without historical table rebuilds.
- **Complete former 18-entry database:** do not execute the new core. Verify structural equivalence and adopt its application ledger under maintenance as described below.
- **Partial or older database:** stop; first finish the old chain using tag `archive/pre-core-20260830`, with separate backup and rehearsal.
- **Already consolidated database:** an exact match with the checked-in manifest needs no adoption.

Freeze the consolidated core after this cutover. Future schema changes append contiguous ordinals with new filenames; never reuse any historical filename for different SQL. Git preserves the removed migration history.

## Ledger ownership

`app_migrations` is the exact application ordinal/checksum contract. Only this ledger changes from 18 entries to one during adoption.

`d1_migrations` is Wrangler-owned filename history. **Keep all existing rows and timestamps.** Wrangler considers current directory filenames; old rows may remain after their files are removed. The existing `0000_core.sql` name prevents replay, but does not update the application ledger. Never bypass the schema gate or introduce a second compatible manifest.

## Required evidence before production

1. Confirm the account, Worker, D1 and R2 bindings. Keep PBKDF2 at `10000` by default/minimum for the Worker CPU budget; owners may explicitly increase it after measuring their runtime. Never change existing password hashes for consolidation.
2. Record the commit, release tag, Worker version, D1 Time Travel bookmark, protected D1 export and verified R2 backup. Verify every media reference and object hash.
3. Restore the actual export into isolated SQLite and workerd D1. Create all tables first, insert rows with deferred foreign keys, then install exact indexes/triggers. Preserve complete trigger bodies when splitting SQL.
4. Compare every object, column, foreign key, CHECK, index and trigger with a fresh core. Formatting or equivalent inline/table CHECK spelling must be explicitly reviewed; unexplained differences stop the cutover.
5. Generate private, database-specific adoption and inverse SQL with exact ledger and schema guards. Only temporarily remove the two `app_migrations_immutable_*` triggers, replace the verified application-ledger rows, and restore the exact triggers. Do not modify business tables or Wrangler history.
6. Rehearse adoption and inverse operations as individual transactions. Require unchanged hashes for every non-ledger table, unchanged schema, integrity OK and zero foreign-key errors. Inject failure after mutation and prove complete rollback, including triggers.
7. Verify fresh-core initialization, the new manifest gate, both runtime builds and local release checks. Confirm the adopted D1 copy has no pending Wrangler migration. Record private artifacts and hashes outside source control.

There is no automatic public adopter. The reviewed one-time SQL belongs with the exact protected backup. VPS adoption requires its own stopped-database-copy rehearsal and canonical schema validation; the ordinary private-bootstrap command is not an adoption command.

## Production window

After explicit authorization and successful rehearsal:

1. Enable the configured Worker secret `IG_MAINTENANCE_MODE=on`. Verify page/API 503 and the maintenance marker at `/api/health`.
2. Drain requests and scheduled leases. Maintenance blocks new entry points; it is not a database lock.
3. Take a fresh export/bookmark, reverify R2, and regenerate/rehearse guards against that exact frozen export.
4. Import the guarded adoption atomically via the official file-import path:

   ```bash
   node node_modules/wrangler/bin/wrangler.js d1 execute <verified-database-name> --remote --config <protected-config> --file <protected-adoption.sql>
   ```

   Do not substitute independent query calls. Retain maintenance on failure.
5. Export again and require the new application ledger, unchanged complete Wrangler history, schema and all business rows/hashes, integrity OK and zero foreign-key errors.
6. Deploy the tested commit while retaining maintenance, bindings, Durable Object identities, cron schedules and limits.
7. Disable maintenance; request `/api/site-config` or another non-health API to exercise the schema gate. Check login/authenticated reads, events/templates, roster, notices, Wiki, storage and media. Record actual coverage: health alone is not login or all-features evidence.
8. Verify remote branch/tag and production assets match the release; preserve the scoped results in the protected handoff.

Ordinary future code-only deployments need no maintenance; this incompatible ledger transition does.

## Failure and rollback

Retain or restore maintenance first. Only if adoption changed the verified ledger alone and no subsequent migration ran may the rehearsed inverse transaction restore the old application ledger/triggers, paired with the recorded matching Worker/assets. Verify schema, all business hashes and Wrangler history before reopening.

Otherwise stop for a reviewed recovery from paired D1/R2 backups or Time Travel. Never blindly overwrite later user writes with an old bookmark. A Worker rollback alone cannot repair a ledger mismatch. Preserve Durable Object classes/namespaces; do not roll back across their lifecycle changes.

CI remains separate under the owner's explicit local-validation waiver for this release, not a waiver of data, backup or login checks. Successful media HTTP responses do not establish audible hover-audio playback; this cutover does not claim to fix that separate report.

## Official references

- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
