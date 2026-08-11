# Self-hosting setup guide

This is the canonical guide for the modular backend. Choose exactly one runtime for each deployment:

| Runtime | Database | Blobs | Realtime and schedules | Process model |
| --- | --- | --- | --- | --- |
| Cloudflare | D1 | One `BLOBS` R2 bucket | Durable Object and Cron Triggers | Cloudflare managed |
| VPS | One local SQLite file | One filesystem root | In-process WebSocket hub and scheduler | One Node.js process |

Both runtimes use the same application services, HTTP routes, Drizzle schema, and core migration. Never point Cloudflare and VPS at copies of data that are being edited independently and later try to merge them.

Chinese version: [SETUP.zh.md](./SETUP.zh.md)

## Requirements

- Node.js 24.18.0 or newer
- pnpm 11.17.0
- Git or a source archive
- For Cloudflare: a Cloudflare account with Workers, D1, R2, Durable Objects, Cron Triggers, and Rate Limiting available
- For VPS: a current 64-bit Linux host, persistent disk, TLS reverse proxy, and a service manager such as systemd

Install dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

## Command map

| Purpose | Command |
| --- | --- |
| Create local config | `pnpm setup:local --runtime cloudflare` or `pnpm setup:local --runtime vps` |
| Develop | `pnpm dev` (Cloudflare), `pnpm cloudflare dev`, or `pnpm vps dev` |
| Build the shared portal | `pnpm build:portal` |
| Build Cloudflare locally | `pnpm cloudflare build` |
| Build VPS locally | `pnpm vps build` |
| Type-check both runtimes | `pnpm typecheck` |
| Run tests | `pnpm test` |
| Generate Drizzle SQL | `pnpm db:generate` |
| Assemble the pre-release core migration | `pnpm db:assemble` |
| Initialize/verify a VPS database | `pnpm db:migrate:vps --database <sqlite-path>` |
| Verify a VPS database/blob snapshot | `pnpm verify:data:vps --database <sqlite-path> --blobs <blob-root>` |
| Apply reviewed private SQL to VPS | `pnpm db:migrate-private:vps --database <sqlite-path> --migration <sql-path>` |
| Prepare a first site owner | `pnpm prepare:site-owner -- ...` |
| Prepare old two-column credentials | `pnpm prepare:credential-import -- ...` |
| Start VPS | `pnpm start:vps` |
| Local release gates | `pnpm release:check` |
| Deploy Cloudflare | `pnpm deploy:cloudflare` |

`release:check` is local-only: it scans tracked content, validates both templates, type-checks both runtimes, runs tests, and builds the portal. It does not create, migrate, deploy, or modify remote resources. `deploy:cloudflare` is intentionally separate and is a real remote mutation.

## Local development

### Cloudflare

```bash
pnpm dev
```

`pnpm dev` defaults to `pnpm cloudflare dev`. It creates any missing ignored local configuration and independent local secrets without overwriting existing files, applies the shared migration and local development seed to D1, starts Wrangler on port 8787, and starts Vite on port 5173. No Cloudflare login or remote resource is needed.

Open `http://localhost:5173`.

### VPS

```bash
pnpm vps dev
```

The command creates a missing ignored `apps/vps/.env` from `scripts/templates/vps.env.example` with two independent local secrets without overwriting an existing file. It initializes or verifies `data/infini-guild.sqlite`, applies the same local development seed used by Cloudflare, then starts the backend on port 8787 and Vite on port 5173. Open `http://localhost:5173`.

The development seed runs only when the database is pristine, is safe to rerun, and never becomes part of the production migration. Use password `admin123` with `admin`, `moderator_01`, or any seeded `member_01`–`member_08` account to exercise the owner, moderator, and member flows. It covers every event type, invite and announcement states, recurring events, polls, raffles, Wiki revision/restore history, storage transaction modes, active and win/loss/draw guild wars, gallery entries, audit/error records, and real local WebP/Ogg media objects. If a database already contains a non-development user, seeding is skipped instead of mixing mock data into that site.

## Shared schema and migrations

The canonical pre-release baseline is:

```text
packages/persistence-sqlite/src/migrations/generated/0000_core.sql
packages/persistence-sqlite/src/migrations/generated/manifest.json  # exactly one 0000 entry
```

Cloudflare D1 and VPS SQLite consume the same `0000_core.sql` bytes. `app_migrations` is the application's ordinal/checksum ledger and is the authority used at runtime startup. Cloudflare additionally maintains `d1_migrations` so Wrangler knows which file it has applied. These ledgers serve different owners and must both remain present; an empty, unknown, or mismatched schema is refused rather than silently repaired.

Schema authors use this pre-release sequence only after changing the shared Drizzle schema:

```bash
pnpm db:generate
pnpm db:assemble
pnpm test
```

During pre-release development, regenerate `0000_core.sql` from an empty local generated-migration directory, then run `db:assemble` to add the reviewed invariants, canonical seed, application-ledger row, and one-entry manifest. `db:assemble` is not a production migration command. Until the first public release, approved changes replace the baseline; after that release, applied files become immutable and later changes require new numbered migrations.

This pre-release fold replaces the abandoned `0000`–`0002` history. Any existing D1 or VPS database whose `app_migrations` ledger already contains that chain cannot be deployed with the current exact manifest. Before the next deployment, back it up and either rebuild it from the current `0000_core.sql` or perform an explicitly planned and verified rebaseline. The application intentionally has no runtime compatibility branch or automatic remote-ledger rewrite, and repository commands never modify remote D1 unless an operator separately runs an explicitly authorized `--remote` Wrangler command.

Initialize or verify VPS SQLite:

```bash
pnpm db:migrate:vps --database /srv/infini/data/infini-guild.sqlite
```

The command applies the baseline only to an empty database. It refuses unknown non-empty databases, then verifies the exact `app_migrations` ledger, every canonical schema object, SQLite integrity, and all foreign keys.

Verify a stopped VPS deployment, restored snapshot, or prepared transfer without modifying either data store:

```bash
pnpm verify:data:vps --database /srv/infini/data/infini-guild.sqlite --blobs /srv/infini/data/blobs
```

The verifier opens SQLite read-only and uses the same manifest and Blob inventory services as the application. It emits JSON findings for missing objects, metadata mismatches, and orphan candidates older than 24 hours, then exits nonzero when any finding exists. Stop application writes or run it against a paired snapshot so the two stores cannot change during the scan. The command has no copy or delete capability.

For Cloudflare, first back up the target, review the exact migration and binding, then explicitly authorize the remote Wrangler operation yourself:

```bash
pnpm exec wrangler d1 migrations apply DB --remote --config apps/cloudflare/wrangler.jsonc
```

This repository's setup, CI, tests, and release checks never run that remote command.

## Configuration and secrets

`IG_PBKDF2_ITERATIONS` defaults to `10000` on both runtimes and accepts integers through `10000000`. Stored hashes include their cost. Raising the configured value upgrades an older valid hash after the user's next successful login. Benchmark the chosen value on the actual runtime before production; never lower it below 10000.

### Cloudflare production

1. Copy `apps/cloudflare/wrangler.example.jsonc` to ignored `apps/cloudflare/wrangler.jsonc`.
2. Fill your `DB`, `BLOBS`, `ASSETS`, `NOTIFICATIONS`, and all five rate-limiter bindings: `AUTH_RATE_LIMITER`, `READ_RATE_LIMITER`, `MUTATION_RATE_LIMITER`, `UPLOAD_RATE_LIMITER`, and `WEBSOCKET_RATE_LIMITER`.
3. Set the public HTTPS origin, allowed origins, routes, and cron configuration.
4. Put both secrets into Cloudflare secret storage; never place them in `vars`:

```bash
pnpm exec wrangler secret put IG_INVITE_TOKEN_SECRET --config apps/cloudflare/wrangler.jsonc
pnpm exec wrangler secret put IG_AUDIT_DOWNLOAD_SECRET --config apps/cloudflare/wrangler.jsonc
```

5. Validate locally:

```bash
pnpm config:check --runtime cloudflare --config apps/cloudflare/wrangler.jsonc
```

Real account IDs, database IDs, bucket names, domains, and secrets must stay in the ignored deployment config or Cloudflare secret storage. Do not commit them.

### VPS production

Run setup once, then edit ignored `apps/vps/.env`:

```bash
pnpm setup:local --runtime vps
pnpm config:check --runtime vps --config apps/vps/.env
```

Set `IG_PUBLIC_URL` to the external HTTPS origin; `IG_DATABASE_PATH`, `IG_BLOB_PATH`, and `IG_STATIC_PATH` to persistent absolute paths; and both secrets to independent random values of at least 32 bytes. Bind `IG_HOST` to a private/loopback address behind a TLS reverse proxy. Set `IG_TRUSTED_PROXY_IPS` only to exact proxy IP addresses you operate.

Protect `.env`, the SQLite file, blob root, backups, and `private-migrations/` with an operating-system account dedicated to the service. Do not run multiple VPS application processes, replicas, Node cluster workers, or network-shared SQLite writers. The first VPS release supports one process on one host.

## Establish the first `site_owner`

Do this after the core schema exists and before exposing registration. Additional owners must be managed through the authenticated admin workflow.

Create the ignored working directory once with `mkdir private-migrations`.

For a new owner, set `IG_BOOTSTRAP_PASSWORD` in the current shell without putting the value in command history, optionally set `IG_PBKDF2_ITERATIONS`, then generate private SQL:

```bash
pnpm prepare:site-owner --mode create --user-id owner-1 --username Owner_1 --output private-migrations/0001_site_owner.sql
```

To promote one existing active user instead, leave `IG_BOOTSTRAP_PASSWORD` unset:

```bash
pnpm prepare:site-owner --mode promote --user-id existing-user-id --output private-migrations/0001_site_owner.sql
```

The generator refuses to overwrite a file and never prints the password or hash. Clear `IG_BOOTSTRAP_PASSWORD` from the shell immediately afterward.

On VPS, stop the service, back up both data stores, and apply with the transactional private-migration command:

```bash
pnpm db:migrate-private:vps --database /srv/infini/data/infini-guild.sqlite --migration private-migrations/0001_site_owner.sql
```

That command checks `app_migrations`, SQLite integrity, and foreign keys before and after, rejects embedded transaction control, uses `BEGIN IMMEDIATE`, and rolls back any failure.

For Cloudflare, this repository deliberately does not automate a remote private migration. After a backup, put the reviewed SQL in an untracked deployment-private migration directory, point the ignored Wrangler config's `migrations_dir` at it, and explicitly run the same authorized `wrangler d1 migrations apply ... --remote` workflow shown above. Restore the canonical migrations directory afterward. Never commit the SQL.

## Offline migration of legacy two-column passwords

The old Worker stored password material across `password_hash` and `salt`. Export only the required rows into a private JSON file:

```json
[
  { "user_id": "user-1", "password_hash": "pbkdf2-sha256$10000$...", "salt": "..." }
]
```

Generate the one-time SQL offline:

```bash
pnpm prepare:credential-import --input private-migrations/legacy-credentials.json --output private-migrations/0002_credentials.sql
```

The generator validates at most 10,000 unique users, converts the legacy format without plaintext passwords, asserts that every target user exists, and refuses to overwrite output. Apply it on VPS with `db:migrate-private:vps`; for Cloudflare, use the explicitly authorized private Wrangler migration procedure above. Keep input and output out of source control, logs, tickets, and chat, then delete or archive them in encrypted storage according to your retention policy.

## Production start and deployment

### Cloudflare

```bash
pnpm release:check
pnpm cloudflare build
# Back up, then explicitly apply reviewed remote migrations.
pnpm deploy:cloudflare
```

`deploy:cloudflare` publishes code and assets. Review the selected Cloudflare account, bindings, routes, and migration state before authorizing it.

### VPS

```bash
pnpm release:check
pnpm vps build
pnpm db:migrate:vps --database /srv/infini/data/infini-guild.sqlite
pnpm verify:data:vps --database /srv/infini/data/infini-guild.sqlite --blobs /srv/infini/data/blobs
pnpm start:vps
```

Run `start:vps` under the service manager as the dedicated user, with working directory set to the repository/release root and `apps/vps/.env` readable only by that user. Terminate TLS at the reverse proxy and forward `/api`, `/ws`, and static requests to the same Node process. Configure restart-on-failure, graceful `SIGTERM`, and persistent disk mounts before enabling traffic.

## Backup and restore

### VPS

1. Stop the single application process and confirm it exited.
2. Copy the SQLite file and the entire blob root into the same timestamped, encrypted snapshot. Preserve file permissions and metadata.
3. Restart only after both copies finish. Test restoration regularly on a separate host.

To restore, stop the service, move the damaged data aside, restore the matching SQLite and blob snapshots together, run `db:migrate:vps` and `verify:data:vps`, then start and check `/api/health`. Never restore only one side: database rows authorize exact blob keys.

### Cloudflare

Before a remote migration or deployment, export D1 with an explicitly authorized Wrangler `d1 export --remote` operation and copy every R2 object plus metadata through an S3-compatible backup tool into independent storage. Record the Worker config and resource bindings without secrets; keep secrets in a separate secret manager. Restore into new D1/R2 resources, verify counts and object metadata, update the ignored bindings, then deploy. Do not treat source control, a D1 export alone, or R2 object versioning alone as a complete backup.

## Updates and CI

For either runtime: read release notes, stop writes or schedule maintenance, take a complete backup, install with the locked pnpm version, run `release:check`, review new migrations, apply them to the selected backend, then start/deploy and verify health.

The GitHub workflow runs only local gates. It does not log in to Cloudflare, create resources, run remote D1/R2 operations, deploy, or start a production VPS.

## Troubleshooting

- Missing config: rerun `pnpm setup:local --runtime cloudflare|vps`; existing files are preserved.
- Port already in use: stop the existing service on 5173 (and the VPS backend on 8787), then rerun the command. Development ports are intentionally fixed; Cloudflare will not silently move to another port because that would invalidate configured origins and cookies.
- Schema 503/startup refusal: verify that the selected database received the shared migration and that its ordered `app_migrations` ledger matches the release. Never bypass the check.
- VPS write contention: confirm only one application process has the SQLite file open and that the file is on local persistent storage, not NFS/SMB.
- Upload failures: confirm the single `BLOBS` binding or blob root is writable and has enough capacity; do not create a second media namespace.
- Setup support: include the runtime, exact command, and redacted error. Remove passwords, cookies, invite tokens, `.env`, `.dev.vars`, private migrations, Cloudflare tokens, and guild data.
