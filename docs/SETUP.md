# Self-hosting setup guide

[Documentation home](../README.md) · [中文版本](./SETUP.zh.md)

This is the canonical setup guide for the modular backend. Pick one runtime for each deployment:

| Runtime | Database | Blobs | Realtime and schedules | Process model |
| --- | --- | --- | --- | --- |
| Cloudflare | D1 | One `BLOBS` R2 bucket | Durable Object and Cron Triggers | Cloudflare managed |
| VPS | One local SQLite file | One filesystem root | In-process WebSocket hub and scheduler | One Node.js process |

The two runtimes share the application services, HTTP routes, Drizzle schema, and core migration. They are alternatives, not two independently editable copies of the same site: never modify both data sets and try to merge them later.

## Requirements

- Node.js 26.5.1 or newer
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
| Isolated browser E2E | `pnpm test:e2e` |
| Deploy Cloudflare | `pnpm deploy:cloudflare` |

`release:check` runs locally only. It scans tracked content, validates both templates, type-checks both runtimes, runs tests, and builds the portal. It never creates, migrates, deploys, or changes remote resources. `deploy:cloudflare` is deliberately separate because it performs a real remote mutation.

## Local development

### Cloudflare

```bash
pnpm dev
```

`pnpm dev` runs `pnpm cloudflare dev` by default. It creates missing ignored local configuration files without replacing existing files, applies the shared migration and local development seed to D1, starts Wrangler on port 8787, and starts Vite on port 5173. It does not require a Cloudflare login or any remote resource.

Open `http://localhost:5173`.

### VPS

```bash
pnpm vps dev
```

If it does not already exist, this command creates the ignored `apps/vps/.env` from `scripts/templates/vps.env.example` without overwriting an existing file. It then initializes or verifies `data/infini-guild.sqlite`, applies the same local development seed used by Cloudflare, starts the backend on port 8787, and starts Vite on port 5173. Open `http://localhost:5173`.

The development seed runs only for a pristine database. It is safe to rerun and is never included in a production migration. On an existing development-seeded database, rerunning it preserves the development records and refreshes only their known `admin123` credential to the current 10,000-iteration hash. Use password `admin123` with `admin`, `moderator_29`–`moderator_31`, or any seeded `member_01`–`member_28` account to exercise administrator, moderator, and member flows. The seed covers every event type; invite and announcement states; recurring events; polls; raffles; Wiki revision and restore history; storage transaction modes; active and win/loss/draw guild wars; gallery entries; audit and error records; and real local WebP/Ogg media objects. If the database already contains a non-development user, seeding is skipped so mock data is never mixed into an existing site.

## Shared schema and migrations

The consolidated 0.1.0 baseline is frozen at:

```text
packages/persistence-sqlite/src/migrations/generated/0000_core.sql
packages/persistence-sqlite/src/migrations/generated/manifest.json  # one consolidated core; later changes append entries
```

Cloudflare D1 and VPS SQLite consume the same ordered migration files, starting with `0000_core.sql`, which contains the final structure and seeds through the former `0017_notice_delivery`. `app_migrations` is the application-owned ordinal/checksum ledger and the source of truth for startup validation. Cloudflare also keeps `d1_migrations`, which Wrangler uses to track filenames. Preserve its historical rows: it may contain former filenames absent from the current directory. The application rejects an empty, unknown, or mismatched schema instead of silently repairing it.

The owner explicitly authorized a one-time consolidation for this 0.1.0 refresh. Existing databases must finish the previous 18-entry chain using tag `archive/pre-core-20260830`, then follow the backed-up, rehearsed ledger adoption in [PRODUCTION_D1_UPGRADE.md](./PRODUCTION_D1_UPGRADE.md). **Do not run the new core on an existing database or assume that Wrangler skipping its filename updates the application ledger.** After this cutover, the core is immutable. Every later schema change must add the next contiguous ordinal with a never-before-used filename and exact checksum, and pass D1/SQLite parity checks. Runtime validation never silently rewrites an existing ledger.

Before replacing a nonempty development database with a new exact manifest, back it up if its `app_migrations` ledger differs, then use an explicitly planned and verified data-preserving upgrade. The application intentionally has no runtime compatibility branch or automatic remote-ledger rewrite. Repository commands never modify remote D1 unless an operator separately runs an explicitly authorized Wrangler command with `--remote`. The current production upgrade and rollback procedure is defined in [PRODUCTION_D1_UPGRADE.md](./PRODUCTION_D1_UPGRADE.md).

Initialize or verify VPS SQLite:

```bash
pnpm db:migrate:vps --database /srv/infini/data/infini-guild.sqlite
```

This command applies the ordered migration chain to an empty database. For an unknown nonempty database, it stops instead of guessing. It then verifies the exact `app_migrations` ledger, every canonical schema object, SQLite integrity, and all foreign keys.

Use the following read-only command to verify a stopped VPS deployment, a restored snapshot, or a prepared transfer. It changes neither data store:

```bash
pnpm verify:data:vps --database /srv/infini/data/infini-guild.sqlite --blobs /srv/infini/data/blobs
```

The verifier opens SQLite read-only and uses the same manifest and Blob inventory services as the application. It emits JSON findings for missing objects, metadata mismatches, and orphan candidates older than 24 hours, and exits nonzero if it finds anything. Stop application writes first, or run the command against a paired snapshot, so the two stores cannot change while it scans. The command cannot copy or delete data.

For Cloudflare, back up the target first, review the exact migration and binding, and explicitly authorize the remote operation by verified database name. The released chain contains CASE-bearing triggers, so use the reviewed atomic file-import procedure below rather than copying the local `migrations apply` command with `--remote`.

Repository setup, CI, tests, and release checks never run remote migrations.

### Remote D1 migrations with `CASE` trigger bodies

A local pass does not prove that the remote query transport accepts a released migration containing `CREATE TRIGGER` with `CASE`/`BEGIN`/`END`. Before a production write, use an approved, read-only `EXPLAIN` comparison through remote `--command` and remote `--file` to establish the parser behavior without executing DDL.

For initialization or an upgrade with that grammar, leave the released SQL and manifest unchanged. A reviewed generator outside source control must make one protected composite file from the migration's original UTF-8 bytes plus the exact `d1_migrations` suffix generated by the pinned Wrangler `buildMigrationQuery` for its filename and configured ledger table. An explicitly authorized operator imports one file at a time:

```bash
pnpm exec wrangler d1 execute <verified-database-name> --remote --config <protected-config> --file <protected-composite-file>
```

Verify both ledgers and the resulting schema/data fingerprint after every import. Do not import a bare migration then append a ledger row manually, and do not use remote `migrations apply` or `--command` for trigger-bearing SQL before its exact grammar has passed the read-only parser check. See the [production D1 upgrade runbook](./PRODUCTION_D1_UPGRADE.md) for the maintenance-window guards.

## Configuration and secrets

`IG_PBKDF2_ITERATIONS` defaults to `10000` on both runtimes and accepts integers through `10000000`. The project keeps the default at `10000` to fit the Cloudflare Workers CPU limit; site owners with additional measured CPU budget may explicitly raise it. Stored hashes include their cost, and lower-cost hashes are rehashed after successful login only when the deployment is configured with a higher value. Login always spends one fixed configured iteration budget, and a stored hash above that budget is not authenticated. After raising the value, never lower it below the greatest cost already written to `user_credentials`; benchmark and plan credential migration before changing a deployed value.

HTTPS deployments use the fixed `__Host-ig_session` cookie and a separate `__Host-ig_session_oauth_transaction` cookie. Both are `Secure`, host-only, and rooted at `/`. Upgrading from an older unprefixed HTTPS cookie intentionally signs existing users out once; do not add a legacy-cookie fallback. Plain HTTP local development continues to use `ig_session`.

### Cloudflare production

1. Copy `apps/cloudflare/wrangler.example.jsonc` to ignored `apps/cloudflare/wrangler.jsonc`.
2. Fill in `DB`, `BLOBS`, `ASSETS`, the `NOTIFICATIONS` and `AUTH_LOGIN_RATE_LIMITER` Durable Object bindings, and all eight native rate-limiter bindings: `AUTH_RATE_LIMITER`, `AUTH_IP_RATE_LIMITER`, `READ_RATE_LIMITER`, `CONTENT_VIEW_RATE_LIMITER`, `EXPENSIVE_READ_RATE_LIMITER`, `MUTATION_RATE_LIMITER`, `UPLOAD_RATE_LIMITER`, and `WEBSOCKET_RATE_LIMITER`. `CONTENT_VIEW_RATE_LIMITER` independently bounds raw announcement and Wiki open counters by trusted client and signed-in account. The native authentication bindings remain the fast first layer; `AUTH_LOGIN_RATE_LIMITER` serializes exact source-wide and source/login-name counters before account lookup or password work. `AUTH_RATE_LIMITER` also protects current-password checks by internal user ID and trusted client source.
3. Keep `nodejs_als` in `compatibility_flags`. The Worker resolves every request's ExecutionContext through AsyncLocalStorage and will not load without this flag. A deployment config created before the flag was introduced must add it before its next deployment. `pnpm config:check` rejects configurations that omit it.
4. Set the public HTTPS origin, allowed origins, routes, and cron configuration.
5. Validate the config locally:

```bash
pnpm config:check --runtime cloudflare --config apps/cloudflare/wrangler.jsonc
```

#### Optional OAuth and verified email on Cloudflare

Local login-name-and-password sign-in needs no external account and remains available when every option below is absent. To enable Google, Discord, or KOOK, create an application in that provider's console and register exactly the callback printed by `config:check`:

```text
https://YOUR_IG_PUBLIC_URL/api/auth/oauth/google/callback
https://YOUR_IG_PUBLIC_URL/api/auth/oauth/discord/callback
https://YOUR_IG_PUBLIC_URL/api/auth/oauth/kook/callback
```

Store each configured pair through Wrangler; this repository keeps both the client ID and secret out of the checked-in `vars` block:

```bash
pnpm exec wrangler secret put IG_OAUTH_GOOGLE_CLIENT_ID --config apps/cloudflare/wrangler.jsonc
pnpm exec wrangler secret put IG_OAUTH_GOOGLE_CLIENT_SECRET --config apps/cloudflare/wrangler.jsonc
# Repeat with IG_OAUTH_DISCORD_CLIENT_ID / IG_OAUTH_DISCORD_CLIENT_SECRET
# or IG_OAUTH_KOOK_CLIENT_ID / IG_OAUTH_KOOK_CLIENT_SECRET.
```

After both values exist, enable only that provider in Admin → Site Config. Partial pairs are rejected at runtime. If credentials are later removed while the database flag remains on, that provider becomes unavailable and its button disappears; local login and the rest of the site continue. WeChat remains unavailable even if its reserved variables are supplied because no officially verified adapter ships in this release.

For optional profile-email verification, onboard a sender domain in the site owner's own Cloudflare Email Sending account, uncomment the `EMAIL` `send_email` binding, restrict it to the sender, and set `vars.IG_EMAIL_FROM` to the same address. The binding and sender must be present together. No application API token is used by the Worker. Arbitrary-recipient Email Sending currently requires Workers Paid; verify the current [Cloudflare pricing](https://developers.cloudflare.com/email-service/platform/pricing/) before enabling it. Email stays optional and is never a login or sole recovery method.

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

Set `IG_PUBLIC_URL` to the external HTTPS origin. Set `IG_DATABASE_PATH`, `IG_BLOB_PATH`, and `IG_STATIC_PATH` to persistent absolute paths. The current template requires no standalone application secret; configure protected credentials only for optional OAuth or email verification. Bind `IG_HOST` to a private or loopback address behind a TLS reverse proxy. Set `IG_TRUSTED_PROXY_IPS` only to exact proxy IP addresses that you operate. The resolved trusted client identity scopes authentication rate limits; never trust a forwarding header from an unlisted peer.

For optional Google, Discord, or KOOK OAuth, create the provider application, register the same exact callback paths shown above under the VPS `IG_PUBLIC_URL`, and set the matching ID/secret pair in the protected `.env` (`IG_OAUTH_GOOGLE_CLIENT_ID` plus `IG_OAUTH_GOOGLE_CLIENT_SECRET`, and equivalently for Discord or KOOK). A partial pair makes configuration invalid. Then enable that provider in Admin → Site Config. Removing a pair disables only that provider; local login continues. WeChat remains unavailable in this release.

For optional profile-email verification on VPS, configure all three values together: `IG_EMAIL_FROM`, `IG_CLOUDFLARE_EMAIL_ACCOUNT_ID`, and a scoped `IG_CLOUDFLARE_EMAIL_API_TOKEN`. The VPS sends over HTTPS through the site owner's Cloudflare Email Sending REST API; it does not host SMTP, and this project does not pay or operate a shared mail gateway. Leaving all three unset disables only email management. Phone/SMS is not implemented.

Use an operating-system account dedicated to the service to protect `.env`, the SQLite file, blob root, backups, and `private-migrations/`. Do not run multiple VPS application processes, replicas, Node cluster workers, or network-shared SQLite writers. The first VPS release supports exactly one process on one host.

On POSIX hosts, normal VPS startup sets its own `0077` umask instead of relying on the service manager. Before it creates, tightens, or uses an exact data path, it checks every existing ancestor is a real directory owned by root or the service account. A group/other-writable ancestor is accepted only when it has the sticky bit; the configured data leaf itself must never be group/other-writable. The final canonical path must still equal the requested resolved path. It then creates or tightens the exact SQLite parent and blob root to `0700`, and the SQLite file plus any present `-wal`/`-shm` sidecars to `0600`. Blob subdirectories and objects receive those same modes when the service creates or accesses that exact path. It never recursively changes an existing tree.

Node does not expose an `openat`-style API that can bind the complete traversal to one directory descriptor, so these checks cannot protect against root or the service account itself racing a path replacement between system calls. Keep the complete ancestor chain protected from every other account; do not grant another process the service identity. On Windows, the runtime still rejects a symlink/junction observed during its point-in-time checks and requires the final canonical path to match, but POSIX ownership and mode checks do not apply. Use NTFS ACLs to give only the dedicated service account control of the configured leaves **and every ancestor that could rename or replace them**.

Blob uploads sync the completed file and, on POSIX, both the published-object directory entry and the temporary-file removal before returning success. Upload temporaries live in the reserved `.infini-guild-blob-temp-v1` directory and never appear in blob inventory. Each later upload performs bounded recovery there: it scans at most 128 entries and removes at most 16 precisely named temporary files that have been inactive for at least one hour. It does not scan the blob tree or remove ordinary, recent, or current-process temporary files.

## Establish the first administrator

Complete this after the core schema exists and before you expose registration. The seeded `admin` role starts at level 1000 with every permission. It remains editable in D1, and this step establishes the first active user whose role grants `admin.roles.manage`.

Create the ignored working directory once with `mkdir private-migrations`.

For a new administrator, set `IG_BOOTSTRAP_PASSWORD` in the current shell without allowing the value into command history. You may also set `IG_PBKDF2_ITERATIONS`, then generate private SQL:

```bash
pnpm prepare:first-admin --mode create --user-id admin-1 --login-name admin_login --display-name Admin_1 --output private-migrations/0001_first_admin.sql
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

Cloudflare deliberately has no automated remote private-migration command. After a backup, put the reviewed SQL in an untracked deployment-private migration directory, temporarily point the ignored Wrangler config's `migrations_dir` there, and explicitly run the authorized remote workflow shown above. If the private SQL contains a CASE-bearing trigger, use the protected file-import procedure above instead of remote `migrations apply`; do not transform or commit the SQL, and never patch either ledger manually. Restore the canonical migrations directory afterward.

## Production start and deployment

### Cloudflare

```bash
pnpm release:check
pnpm cloudflare build
# Back up, then explicitly apply reviewed remote migrations. Use the audited file-import route for trigger-bearing SQL.
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
- `/api/health` returns HTTP 200 with `{ "ok": true, "maintenance": true }` without probing storage; when configured, it also includes the public `reason` and `until` fields;
- WebSocket upgrades are rejected and scheduled jobs do not run.

Maintenance is an application entry-point gate, not a database lock. Drain in-flight requests and active job leases before the frozen backup. Existing Durable Object connections and alarms are not automatically terminated; do not infer database quiescence from the maintenance page alone.

The optional `IG_MAINTENANCE_REASON` value is shown on the public maintenance page and is limited to 500 characters. `IG_MAINTENANCE_UNTIL` is an optional canonical UTC ISO timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ`), for example `2026-08-30T12:00:00.000Z`. Both values are validated during runtime configuration loading and are escaped before being rendered as HTML.

### Cloudflare

Enable the optional Worker secret before touching D1 or R2:

```powershell
'on' | pnpm exec wrangler secret put IG_MAINTENANCE_MODE `
  --config apps/cloudflare/wrangler.jsonc
```

`wrangler secret put` creates and immediately deploys a Worker version. Existing secrets survive later ordinary deployments, so maintenance remains active while compatible code is published. Before continuing, verify that `/` returns 503, `/api/site-config` returns JSON 503, and `/api/health` returns the maintenance marker.

When using public maintenance metadata, configure the optional Worker variables alongside the mode secret:

```jsonc
"vars": {
  "IG_MAINTENANCE_REASON": "Database maintenance",
  "IG_MAINTENANCE_UNTIL": "2026-08-30T12:00:00.000Z"
}
```

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
IG_MAINTENANCE_REASON=Database maintenance
IG_MAINTENANCE_UNTIL=2026-08-30T12:00:00.000Z
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

The GitHub workflow runs `release:check` and the isolated Chromium E2E suite as separate local-only jobs. It does not log in to Cloudflare, create resources, run remote D1/R2 operations, deploy, or start a production VPS.

## Troubleshooting

- Missing config: rerun `pnpm setup:local --runtime cloudflare|vps`; existing files are preserved.
- Port already in use: stop the service already using 5173, and the VPS backend on 8787 when applicable, then rerun the command. Development ports are deliberately fixed. Cloudflare does not silently move to another port because that would invalidate configured origins and cookies.
- Schema 503 or startup refusal: confirm that the selected database received the shared migration and that its ordered `app_migrations` ledger matches the release. Never bypass this check.
- VPS write contention: confirm that only one application process has the SQLite file open, and that the file is on local persistent storage rather than NFS/SMB.
- Upload failures: confirm that the single `BLOBS` binding or blob root is writable and has enough capacity. Do not create a second media namespace.
- Setup support: include the runtime, exact command, and a redacted error. Remove passwords, cookies, live invite codes, `.env`, `.dev.vars`, private migrations, Cloudflare tokens, and guild data.
