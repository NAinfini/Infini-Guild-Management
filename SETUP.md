# Self-hosting setup guide

This is the canonical setup guide for the modular backend. Pick one runtime for each deployment:

| Runtime | Database | Blobs | Realtime and schedules | Process model |
| --- | --- | --- | --- | --- |
| Cloudflare | D1 | One `BLOBS` R2 bucket | Durable Object and Cron Triggers | Cloudflare managed |
| VPS | One local SQLite file | One filesystem root | In-process WebSocket hub and scheduler | One Node.js process |

The two runtimes share the application services, HTTP routes, Drizzle schema, and core migration. They are alternatives, not two independently editable copies of the same site: never modify both data sets and try to merge them later.

Chinese version: [SETUP.zh.md](./SETUP.zh.md)

## Requirements

- Node.js 24.18.0 or newer
- pnpm 11.17.0
- Git or a source archive
- For Cloudflare: a Cloudflare account with Workers, D1, R2, Durable Objects, Cron Triggers, and Rate Limiting available
- For VPS: a current 64-bit Linux host, persistent disk, TLS reverse proxy, and a service manager such as systemd

From the repository root, install the locked dependency set:

```bash
pnpm install --frozen-lockfile
```

## Command reference

| Purpose | Command |
| --- | --- |
| Create local config | `pnpm setup:local --runtime cloudflare` or `pnpm setup:local --runtime vps` |
| Develop | `pnpm dev` (Cloudflare), `pnpm cloudflare dev`, or `pnpm vps dev` |
| Build the shared portal | `pnpm build:portal` |
| Build Cloudflare locally | `pnpm cloudflare build` |
| Build VPS locally | `pnpm vps build` |
| Type-check both runtimes | `pnpm typecheck` |
| Run tests | `pnpm test` |
| Generate the next Drizzle migration | `pnpm db:generate -- --name <migration-name>` |
| Initialize/verify a VPS database | `pnpm db:migrate:vps --database <sqlite-path>` |
| Verify a VPS database/blob snapshot | `pnpm verify:data:vps --database <sqlite-path> --blobs <blob-root>` |
| Apply reviewed private SQL to VPS | `pnpm db:migrate-private:vps --database <sqlite-path> --migration <sql-path>` |
| Prepare the first administrator | `pnpm prepare:first-admin -- ...` |
| Start VPS | `pnpm start:vps` |
| Local release gates | `pnpm release:check` |
| Deploy Cloudflare | `pnpm deploy:cloudflare` |

`release:check` runs locally only. It scans tracked content, validates both templates, type-checks both runtimes, runs tests, and builds the portal. It never creates, migrates, deploys, or changes remote resources. `deploy:cloudflare` is deliberately separate because it performs a real remote mutation.

## Local development

### Cloudflare

```bash
pnpm dev
```

`pnpm dev` runs `pnpm cloudflare dev` by default. It creates missing ignored local configuration and two independent local secrets without replacing existing files, applies the shared migration and local development seed to D1, starts Wrangler on port 8787, and starts Vite on port 5173. It does not require a Cloudflare login or any remote resource.

Open `http://localhost:5173`.

### VPS

```bash
pnpm vps dev
```

If it does not already exist, this command creates the ignored `apps/vps/.env` from `scripts/templates/vps.env.example`, including two independent local secrets, without overwriting an existing file. It then initializes or verifies `data/infini-guild.sqlite`, applies the same local development seed used by Cloudflare, starts the backend on port 8787, and starts Vite on port 5173. Open `http://localhost:5173`.

The development seed runs only for a pristine database. It is safe to rerun and is never included in a production migration. Use password `admin123` with `admin`, `moderator_29`–`moderator_31`, or any seeded `member_01`–`member_28` account to exercise administrator, moderator, and member flows. The seed covers every event type; invite and announcement states; recurring events; polls; raffles; Wiki revision and restore history; storage transaction modes; active and win/loss/draw guild wars; gallery entries; audit and error records; and real local WebP/Ogg media objects. If the database already contains a non-development user, seeding is skipped so mock data is never mixed into an existing site.

## Shared schema and migrations

The released baseline is frozen at:

```text
packages/persistence-sqlite/src/migrations/generated/0000_core.sql
packages/persistence-sqlite/src/migrations/generated/manifest.json  # exactly one 0000 entry
```

Cloudflare D1 and VPS SQLite consume the same ordered migration files, starting with the frozen `0000_core.sql`. `app_migrations` is the application-owned ordinal/checksum ledger and the source of truth for startup validation. Cloudflare also keeps `d1_migrations`, which Wrangler uses to track applied files. The ledgers have different owners and must both exist. The application rejects an empty, unknown, or mismatched schema instead of silently repairing it.

`0000_core.sql` and its manifest entry are immutable. Do not regenerate, assemble, or edit either one. Every schema change after this release must add the next contiguous ordinal migration, update the manifest with its exact checksum, and pass the shared D1/SQLite migration-parity checks. Runtime migration validation applies the ordered multi-file chain; it never rebaselines an existing database or silently rewrites its ledger.

Before replacing a nonempty development database with a new exact manifest, back it up if its `app_migrations` ledger differs, then use an explicitly planned, verified, data-preserving rebaseline. The application intentionally has no runtime compatibility branch or automatic remote-ledger rewrite. Repository commands never modify remote D1 unless an operator separately runs an explicitly authorized Wrangler command with `--remote`.

Initialize or verify VPS SQLite:

```bash
pnpm db:migrate:vps --database /srv/infini/data/infini-guild.sqlite
```

This command applies the baseline only to an empty database. For an unknown nonempty database, it stops instead of guessing. It then verifies the exact `app_migrations` ledger, every canonical schema object, SQLite integrity, and all foreign keys.

Use the following read-only command to verify a stopped VPS deployment, a restored snapshot, or a prepared transfer. It changes neither data store:

```bash
pnpm verify:data:vps --database /srv/infini/data/infini-guild.sqlite --blobs /srv/infini/data/blobs
```

The verifier opens SQLite read-only and uses the same manifest and Blob inventory services as the application. It emits JSON findings for missing objects, metadata mismatches, and orphan candidates older than 24 hours, and exits nonzero if it finds anything. Stop application writes first, or run the command against a paired snapshot, so the two stores cannot change while it scans. The command cannot copy or delete data.

For Cloudflare, back up the target first, review the exact migration and binding, and then explicitly authorize the remote Wrangler operation yourself:

```bash
pnpm exec wrangler d1 migrations apply DB --remote --config apps/cloudflare/wrangler.jsonc
```

The repository setup, CI, tests, and release checks never run this remote command.

## Configuration and secrets

`IG_PBKDF2_ITERATIONS` defaults to `10000` on both runtimes and accepts integers through `10000000`. Stored hashes include their cost. If you raise the configured value, an older valid hash is upgraded after the user's next successful login. Benchmark the selected value on the real runtime before production, and never lower it below 10000.

### Cloudflare production

1. Copy `apps/cloudflare/wrangler.example.jsonc` to ignored `apps/cloudflare/wrangler.jsonc`.
2. Fill in `DB`, `BLOBS`, `ASSETS`, `NOTIFICATIONS`, and all six rate-limiter bindings: `AUTH_RATE_LIMITER`, `READ_RATE_LIMITER`, `EXPENSIVE_READ_RATE_LIMITER`, `MUTATION_RATE_LIMITER`, `UPLOAD_RATE_LIMITER`, and `WEBSOCKET_RATE_LIMITER`.
3. Keep `nodejs_als` in `compatibility_flags`. The Worker resolves every request's ExecutionContext through AsyncLocalStorage and will not load without this flag. A deployment config created before the flag was introduced must add it before its next deployment. `pnpm config:check` rejects configurations that omit it.
4. Set the public HTTPS origin, allowed origins, routes, and cron configuration.
5. Store both secrets in Cloudflare secret storage; never put them in `vars`:

```bash
pnpm exec wrangler secret put IG_INVITE_TOKEN_SECRET --config apps/cloudflare/wrangler.jsonc
pnpm exec wrangler secret put IG_AUDIT_DOWNLOAD_SECRET --config apps/cloudflare/wrangler.jsonc
```

6. Validate the config locally:

```bash
pnpm config:check --runtime cloudflare --config apps/cloudflare/wrangler.jsonc
```

Real account IDs, database IDs, bucket names, domains, and secrets belong only in ignored deployment config or Cloudflare secret storage. Never commit them.

#### Cloudflare edge abuse checklist

Application limits are the final guard around Worker, D1, R2, and Durable Object work. Before opening production traffic, also verify the account-level edge controls that source control cannot configure or prove:

- Proxy every public DNS record through Cloudflare, remove direct-origin hostnames, and do not expose an R2 public domain. The Worker must remain the only public route to D1-backed media authorization.
- Keep `workers_dev` and preview URLs disabled in production so alternate Worker hostnames cannot bypass the custom-domain policy.
- Enable the applicable Cloudflare managed WAF rules and an account-level rate-limit policy for `/api/auth/*`, `/api/search`, `/api/users`, `/api/guild-war/analytics`, `/api/media/*`, `/api/health`, and `/ws`. Use stricter budgets for authentication and expensive reads than for cached HTML or public media.
- Enable the bot-management feature available on the account only after checking that normal API and WebSocket clients are not challenged. Never put an interactive challenge in front of `/api/health`.
- Alert on sustained Worker CPU, 429/5xx responses, D1 reads/writes, R2 operations/egress, Durable Object connections, and unexpected cost growth. The checked-in 10% observability sampling is diagnostic, not a substitute for account alerts.
- After every route or binding change, verify that the production custom domain reaches the intended Worker version and that no origin, preview, or development hostname remains publicly usable.

These controls are deployment prerequisites, not claims about the current Cloudflare account. Confirm them in the Dashboard before each release.

### VPS production

Run setup once, then edit the ignored `apps/vps/.env`:

```bash
pnpm setup:local --runtime vps
pnpm config:check --runtime vps --config apps/vps/.env
```

Set `IG_PUBLIC_URL` to the external HTTPS origin. Set `IG_DATABASE_PATH`, `IG_BLOB_PATH`, and `IG_STATIC_PATH` to persistent absolute paths. Set both secrets to independent random values of at least 32 bytes. Bind `IG_HOST` to a private or loopback address behind a TLS reverse proxy. Set `IG_TRUSTED_PROXY_IPS` only to exact proxy IP addresses that you operate.

Use an operating-system account dedicated to the service to protect `.env`, the SQLite file, blob root, backups, and `private-migrations/`. Do not run multiple VPS application processes, replicas, Node cluster workers, or network-shared SQLite writers. The first VPS release supports exactly one process on one host.

## Establish the first administrator

Complete this after the core schema exists and before you expose registration. The seeded `admin` role starts at level 1000 with every permission. It remains editable in D1, and this step establishes the first active user whose role grants `admin.roles.manage`.

Create the ignored working directory once with `mkdir private-migrations`.

For a new administrator, set `IG_BOOTSTRAP_PASSWORD` in the current shell without allowing the value into command history. You may also set `IG_PBKDF2_ITERATIONS`, then generate private SQL:

```bash
pnpm prepare:first-admin --mode create --user-id admin-1 --username Admin_1 --output private-migrations/0001_first_admin.sql
```

To promote an existing active user instead, leave `IG_BOOTSTRAP_PASSWORD` unset:

```bash
pnpm prepare:first-admin --mode promote --user-id existing-user-id --output private-migrations/0001_first_admin.sql
```

The generator refuses to overwrite a file and never prints the password or hash. Clear `IG_BOOTSTRAP_PASSWORD` from the shell immediately afterward.

On VPS, stop the service, back up both data stores, and apply the SQL with the transactional private-migration command:

```bash
pnpm db:migrate-private:vps --database /srv/infini/data/infini-guild.sqlite --migration private-migrations/0001_first_admin.sql
```

Before and after applying the SQL, this command checks `app_migrations`, SQLite integrity, and foreign keys. It rejects embedded transaction control, uses `BEGIN IMMEDIATE`, and rolls back every failure.

Cloudflare deliberately has no automated remote private-migration command. After a backup, put the reviewed SQL in an untracked deployment-private migration directory, temporarily point the ignored Wrangler config's `migrations_dir` at that directory, and explicitly run the authorized `wrangler d1 migrations apply ... --remote` workflow shown above. Restore the canonical migrations directory afterward. Never commit the SQL.

## Production start and deployment

### Cloudflare

```bash
pnpm release:check
pnpm cloudflare build
# Back up, then explicitly apply reviewed remote migrations.
pnpm deploy:cloudflare
```

`deploy:cloudflare` publishes code and assets. Before authorizing it, review the selected Cloudflare account, bindings, routes, and migration state.

### VPS

```bash
pnpm release:check
pnpm vps build
pnpm db:migrate:vps --database /srv/infini/data/infini-guild.sqlite
pnpm verify:data:vps --database /srv/infini/data/infini-guild.sqlite --blobs /srv/infini/data/blobs
pnpm start:vps
```

Run `start:vps` under the service manager as the dedicated user. Set its working directory to the repository or release root, and make `apps/vps/.env` readable only by that user. Terminate TLS at the reverse proxy, and forward `/api`, `/ws`, and static requests to the same Node process. Configure restart-on-failure, graceful `SIGTERM`, and persistent disk mounts before enabling traffic.

#### Reverse proxy hardening

The Node process binds a private address and never terminates TLS, so the reverse proxy is responsible for transport security. Before enabling traffic, configure all of the following:

- Redirect every plain-HTTP request to HTTPS with a permanent (301/308) redirect.
- Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` on HTTPS responses, matching the Cloudflare runtime.
- Compress text responses (HTML, CSS, JavaScript, JSON, SVG) with brotli or gzip; the Node process serves uncompressed bytes.
- Forward the `Upgrade` and `Connection` headers on `/ws`, and set `X-Forwarded-For` to the client address. The backend trusts it only when it comes from an exact IP in `IG_TRUSTED_PROXY_IPS`.

nginx example:

```nginx
server {
  listen 80;
  server_name guild.example.com;
  return 308 https://$host$request_uri;
}
server {
  listen 443 ssl;
  http2 on;
  server_name guild.example.com;
  ssl_certificate /etc/ssl/guild.example.com/fullchain.pem;
  ssl_certificate_key /etc/ssl/guild.example.com/privkey.pem;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;

  location /ws {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $remote_addr;
  }
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

With Caddy, HTTP→HTTPS redirection is automatic. Add `header Strict-Transport-Security "max-age=31536000; includeSubDomains"`, `encode br gzip`, and a `reverse_proxy 127.0.0.1:8787` that covers `/ws`; Caddy forwards WebSocket upgrades automatically.

## Maintenance mode

Use maintenance mode only for coordinated database or blob-storage work. Ordinary Worker deployments are atomic and do not need it. The maintenance response is embedded in both runtimes: it does not read D1/SQLite, R2/the blob root, Portal assets, WebSockets, or scheduled jobs.

While maintenance is active:

- browser routes return a bilingual Lightfall maintenance page with HTTP 503;
- API routes return the standard JSON 503 envelope;
- `/api/health` returns HTTP 200 with `{ "ok": true, "maintenance": true }` without probing storage;
- WebSocket upgrades are rejected and scheduled jobs do not run.

### Cloudflare

Enable the optional Worker secret before touching D1 or R2:

```powershell
'on' | pnpm exec wrangler secret put IG_MAINTENANCE_MODE `
  --config apps/cloudflare/wrangler.jsonc
```

`wrangler secret put` creates and immediately deploys a Worker version. Existing secrets survive later ordinary deployments, so maintenance remains active while compatible code is published. Before continuing, verify that `/` returns 503, `/api/site-config` returns JSON 503, and `/api/health` returns the maintenance marker.

After the D1 and R2 checks pass, remove the secret:

```powershell
pnpm exec wrangler secret delete IG_MAINTENANCE_MODE `
  --config apps/cloudflare/wrangler.jsonc
```

This also creates and deploys a Worker version immediately. Verify login, an authenticated read, `/api/site-config`, one image `view`/`full` pair, and profile audio. If any smoke check fails, set the secret back to `on` before investigating or rolling back.

### VPS

Set the ignored `apps/vps/.env` value and restart the single service process:

```dotenv
IG_MAINTENANCE_MODE=on
```

The maintenance branch starts only the HTTP listener; it does not open SQLite, inspect the blob root, create the application, start WebSockets, or schedule jobs. Normal-mode startup failures remain fatal and are not disguised as planned maintenance.

After the paired SQLite/blob operation and verification, set the value to `off`, restart, and run the same login, API, media, and WebSocket smoke checks. Set it back to `on` and restart if any check fails.

## Backup and restore

### VPS

1. Stop the single application process and confirm that it has exited.
2. Copy the SQLite file and the complete blob root into the same timestamped, encrypted snapshot. Preserve file permissions and metadata.
3. Restart only after both copies complete, and test restoration regularly on a separate host.

To restore, stop the service, move the damaged data aside, restore the matching SQLite and blob snapshots together, run `db:migrate:vps` and `verify:data:vps`, then start the service and check `/api/health`. Never restore just one side: database rows authorize exact blob keys.

### Cloudflare

Before a remote migration or deployment, use an explicitly authorized Wrangler `d1 export --remote` operation to export D1. Copy every R2 object and its metadata through an S3-compatible backup tool into independent storage. Record the Worker config and resource bindings without secrets, and keep secrets in a separate secret manager. Restore into new D1/R2 resources, verify record counts and object metadata, update the ignored bindings, then deploy. Source control, a D1 export alone, and R2 object versioning alone are not complete backups.

## Updates and CI

For either runtime: read the release notes, stop writes or schedule maintenance, take a complete backup, install with the locked pnpm version, run `release:check`, review new migrations, apply them to the selected backend, then start or deploy and verify health.

The GitHub workflow runs local gates only. It does not log in to Cloudflare, create resources, run remote D1/R2 operations, deploy, or start a production VPS.

## Troubleshooting

- Missing config: rerun `pnpm setup:local --runtime cloudflare|vps`; existing files are preserved.
- Port already in use: stop the service already using 5173, and the VPS backend on 8787 when applicable, then rerun the command. Development ports are deliberately fixed. Cloudflare does not silently move to another port because that would invalidate configured origins and cookies.
- Schema 503 or startup refusal: confirm that the selected database received the shared migration and that its ordered `app_migrations` ledger matches the release. Never bypass this check.
- VPS write contention: confirm that only one application process has the SQLite file open, and that the file is on local persistent storage rather than NFS/SMB.
- Upload failures: confirm that the single `BLOBS` binding or blob root is writable and has enough capacity. Do not create a second media namespace.
- Setup support: include the runtime, exact command, and a redacted error. Remove passwords, cookies, invite tokens, `.env`, `.dev.vars`, private migrations, Cloudflare tokens, and guild data.
