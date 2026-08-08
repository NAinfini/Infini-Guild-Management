# Self-hosting setup guide

This is the canonical source for local installation, Cloudflare deployment, production initialization, updates, and setup troubleshooting. The README intentionally links here instead of duplicating these commands.

Chinese version: [SETUP.zh.md](./SETUP.zh.md)

## What you need

- [Node.js 24 LTS](https://nodejs.org/) 24.18.0 or newer
- pnpm 11.17.0 (`npm install --global pnpm@11.17.0` if needed)
- Git, or a downloaded ZIP of this repository
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) for production

Local development does not require a Cloudflare account. A custom domain is optional; production may start on `*.workers.dev`.

## 1. Run locally

From the repository root:

```bash
pnpm install
pnpm setup:local
pnpm dev
```

`pnpm setup:local` creates your untracked `apps/worker/wrangler.jsonc` from `wrangler.example.jsonc` when it does not exist yet, and creates an ignored `apps/worker/.dev.vars` with a random local `SIGNING_SECRET`. It never overwrites an existing configuration or `.dev.vars` file. Both files are ignored by git; do not commit them.

One more one-time install: the E2E suite (run by `pnpm test:e2e` and by the deployment gate in step 5) needs a Playwright browser:

```bash
pnpm exec playwright install chromium
```

Open `http://localhost:5173` after the portal is ready. Local development uses disposable demo data:

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `admin123` | Administrator |
| `mod_1` | `moderator123` | Moderator |
| `member_01` | `member1234` | Member |

`pnpm dev` rebuilds the local D1 database and seeds it again. These accounts are never created in production.

## Production schema policy

`apps/worker/db/migrations/0000_core_schema.sql` is the frozen schema baseline: it represents the complete fresh-database schema and is never edited or replaced.

- A fresh deployment applies the whole migration chain in order and reaches the current schema; an initialized deployment applies only the files it has not run yet.
- Every schema change ships as a new monotonically numbered incremental migration that preserves existing data. Never edit a migration file after any deployment has applied it.
- Never patch a production D1 database manually. Apply reviewed migrations through Wrangler, and back up production data before an authorized remote migration.

The schema deliberately has no runtime game-rule tables. Event types, war results, stat keys, and KDA behavior are source-owned contracts, not Site Config records.

## 2. Connect Cloudflare and create resources

`apps/worker/wrangler.jsonc` is your deployment's manifest and is deliberately untracked: the repository ships `wrangler.example.jsonc` as the template, `pnpm setup:local` copies it into place, and `.gitignore` keeps your copy — with its real database ID, bucket name, domain, and origin — out of version control. Fill in the production D1 binding, R2 binding, route, and branding with resources you own. Resource names, IDs, and routes are configuration identifiers, not credentials; `SIGNING_SECRET` and Cloudflare API tokens are the actual secrets and never belong in this file.

Log in:

```bash
pnpm exec wrangler login
```

Create the production D1 database and update the `DB` binding:

```bash
pnpm exec wrangler d1 create my-guild-db --binding DB --env production --update-config --config apps/worker/wrangler.jsonc
```

Create one production R2 bucket and update the `MEDIA` binding:

```bash
pnpm exec wrangler r2 bucket create my-guild-media --binding MEDIA --env production --update-config --config apps/worker/wrangler.jsonc
```

Only one R2 binding is required. The `MEDIA` bucket stores content media, audit archive data, and each archive month's authoritative manifest. Do not create a separate audit bucket and do not manually rewrite or delete production R2 objects.

If a resource name is already taken, choose another name. If you bind an existing resource, edit only the corresponding `env.production` binding.

## 3. Configure production variables and secret

In `apps/worker/wrangler.jsonc`, review the production variables along with the resource bindings:

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "PORTAL_ORIGIN": "",
  "MEDIA_ORPHAN_DELETE_MODE": "report",
  "SITE_NAME": "My Guild",
  "SITE_LOGO_URL": "/guild-logo.svg"
}
```

For the normal same-Worker deployment, leave `PORTAL_ORIGIN` empty. Set it only when a separately hosted frontend must call this Worker, and use a bare origin such as `https://portal.example.com` — no path, query, or trailing slash. The Worker compares request origins against this value verbatim, and `pnpm config:check` rejects values that could never match.

Keep `MEDIA_ORPHAN_DELETE_MODE` at `report` until you have reviewed a complete media scan; the [media cleanup section](#media-cleanup-and-media_orphan_delete_mode) explains both modes and the review workflow.

`PBKDF2_ITERATIONS` controls the password-hashing cost. It defaults to `10000`, chosen so a login derivation fits the Workers free-plan CPU budget; see [Running on the Workers free plan](#running-on-the-workers-free-plan) for why you should raise it on a paid plan and how the upgrade rolls out to existing accounts.

Store the production secret in Cloudflare:

```bash
pnpm exec wrangler secret put SIGNING_SECRET --env production --config apps/worker/wrangler.jsonc
```

Use a long random value. `SIGNING_SECRET` signs audit archive download tokens and authenticates Worker-to-Durable-Object push publication. Store it only as a Cloudflare secret; never place it in `wrangler.jsonc`, an `.env` file, an issue, or a commit.

Validate the manifest:

```bash
pnpm config:check -- --env=production
```

Continue only after it prints:

```text
[config] production configuration is ready.
```

## 4. Initialize D1 and create the first administrator

Apply the reviewed migrations:

```bash
pnpm exec wrangler d1 migrations apply DB --remote --env production --config apps/worker/wrangler.jsonc
```

Create the first administrator:

```bash
pnpm setup:admin -- --env=production
```

The command requires an interactive terminal, hides password input, requires a 12–128 character password, operates only on the explicitly selected production environment, refuses to run when any user already exists, and removes its temporary SQL directory. The password hash is written at the default cost and upgrades automatically on the first login if you later raise `PBKDF2_ITERATIONS`. All later users should register through invite links created in Admin.

## 5. Deploy

Run:

```bash
pnpm deploy:production
```

This runs the repository's production release checks, builds the portal, performs a Worker deployment dry run, and deploys the Worker with its static assets. Use this script instead of a bare `wrangler deploy`, which can publish stale frontend assets or skip required checks. The release gate includes the full Playwright E2E suite, so expect the command to run for tens of minutes; it fails early if the Playwright browser from step 1 is missing.

Wrangler prints the public URL after deployment. Open it and sign in with the administrator created in step 4.

## 6. Finish configuration in Admin

Open **Admin → Site Config** and review:

1. **Branding** — site name and uploaded logo.
2. **Features** — `announcements`, `events`, `guildWar`, `gallery`, `wiki`, `tools`, and `storage`.
3. **Limits** — per-file upload limits, media quotas, and storage images per item.
4. **Policies** — the absence policy shown to members.

Then use **Admin → Invites** to create member invitations. Never reuse the bootstrap administrator password.

The repository ships deployment-neutral branding so a fork starts from a clean identity: `SITE_NAME` and `SITE_LOGO_URL` only seed the first boot, `apps/portal/public/guild-logo.svg` is a neutral fallback asset you can replace or simply supersede by uploading a logo in Admin, and the `.github` issue templates link to this repository — a public fork should retarget them so reports reach its own maintainers.

`SITE_NAME` and `SITE_LOGO_URL` in Wrangler are startup fallbacks. The uploaded logo and runtime Site Config are stored by the application.

## Where configuration belongs

| Change | Source of truth | Requires deploy? |
| --- | --- | --- |
| Site name/logo, seven feature flags, upload limits, media quotas, storage policy | **Admin → Site Config** | No |
| Member profiles, roles, permissions, invites, classes, class tags, badges | Corresponding Admin workflow | No |
| Guild-war analytics weights | `/api/admin/analytics-settings` with the required permission | No |
| D1, the single `MEDIA` R2 bucket, environment, domain, fallback branding | `apps/worker/wrangler.jsonc` | Yes |
| `SIGNING_SECRET` | Cloudflare secret storage via `wrangler secret put` | Yes |
| Event types, war results, stat definitions, KDA formula | Shared source contracts plus an incremental data migration when needed | Build and deploy |
| Hard safety ceilings, rate limits, pagination defaults | `apps/shared/config/limits.ts` | Build and deploy |

There is no `FEATURES` environment variable. Do not create a second configuration source and do not manually edit production D1 or R2 to change application behavior.

## Media cleanup and MEDIA_ORPHAN_DELETE_MODE

A daily maintenance job (00:00 UTC) reconciles the `MEDIA` bucket against the database. In both modes it rebuilds media references incrementally, scans every content prefix for objects older than a 48-hour grace window that no database row references, and purges expired upload leases — staging objects from uploads that were never committed are deleted in either mode, because a lease that expired without ever gaining a reference cannot be live content. The audit archive prefix is never scanned.

`MEDIA_ORPHAN_DELETE_MODE` gates the irreversible part:

- `report` (default) — orphan candidates are counted and logged; nothing else is deleted.
- `delete` — orphaned objects are deleted, and media belonging to users soft-deleted more than 7 days ago is purged.

Run in `report` mode first and review at least one full scan. The scheduled run only logs its summary, so use the manual trigger, which returns the full summary and records it durably in the audit log (requires the `admin.roles.manage` permission). From the browser console of a signed-in admin session:

```js
await fetch("/api/admin/maintenance/media-orphan-cleanup", {
  method: "POST",
  headers: { "X-Requested-With": "XMLHttpRequest" },
  credentials: "include",
}).then((r) => r.json());
```

Check `orphansFound` per prefix over a few days. Orphans should be explainable — deleted content, abandoned uploads. A nonzero count immediately after restoring a database backup is a red flag: an old database paired with a newer bucket will classify real content as orphaned. Only when the reports look right, change the value to `delete` in `wrangler.jsonc` and redeploy (vars apply at deployment).

## Running on the Workers free plan

The portal is designed to run on the Workers free plan. These defaults exist because of its limits, and each can be raised after upgrading:

- **Password hashing.** The free plan caps CPU time per invocation at roughly 10 ms, which is why `PBKDF2_ITERATIONS` defaults to `10000` — one login derivation fits the budget. OWASP recommends 600,000 iterations for PBKDF2-SHA256, so on a paid plan (30 s CPU ceiling) set `"PBKDF2_ITERATIONS": "600000"` in the production vars. Stored hashes are self-describing, so the change is safe at any time: existing accounts keep verifying against their stored cost and are transparently rehashed to the new cost on their next successful login.
- **Media cleanup scale.** The daily scan lists the bucket page by page and is bounded by the per-invocation subrequest limit (50 on free, 1,000 on paid), so a free-plan deployment with a very large media library may not finish a full scan in one run. The manual trigger above lets you run extra passes on demand.
- **Log retention.** Scheduled-run summaries go to Workers Logs, whose retention is short on the free plan. The manual cleanup trigger records its summary in the application's own audit log instead, which does not depend on Workers Logs.

Upgrading is a Cloudflare dashboard action (Workers & Pages → plan); no code change is needed beyond the vars above.

## Optional custom domain

Choose one production exposure mode before the configuration check:

1. For `workers.dev`, keep `env.production.workers_dev` as `true` (the template default) with no `routes` entry.
2. For a Cloudflare-managed custom domain, set `workers_dev` to `false` and add a `routes` entry with your hostname (the template carries a commented example), for example `guild.example.com`.
3. Run `pnpm config:check -- --env=production`.
4. Run `pnpm deploy:production`.

The portal and API normally remain same-origin, so `PORTAL_ORIGIN` can stay empty.

## Update an initialized site

Back up production data before an authorized migration, then run:

```bash
pnpm install
pnpm config:check -- --env=production
pnpm exec wrangler d1 migrations apply DB --remote --env production --config apps/worker/wrangler.jsonc
pnpm deploy:production
```

An initialized site must never rerun `pnpm setup:admin`, edit an already-applied migration file, or apply direct production D1/R2 edits. Repository releases provide incremental migrations for schema changes.

## Troubleshooting

### `wrangler.jsonc` is missing

Run `pnpm setup:local` to create it from `wrangler.example.jsonc`. The file is deliberately untracked, so a fresh clone does not contain it until this step.

### The configuration check reports a placeholder

Read the exact field in the error. Re-run the matching D1/R2 `--update-config` command or replace only that production value.

### Cloudflare authentication fails

```bash
pnpm exec wrangler logout
pnpm exec wrangler login
```

### The first-admin command reports existing users

This is a safety stop. Use an existing administrator. If no administrator is usable, do not delete or modify production data; request help with credentials and private guild data removed.

### Port 8787 or 5173 is already in use

`pnpm dev` needs both fixed ports: the Worker serves `http://localhost:8787` and Vite must own `http://localhost:5173`, because the dev CORS allowlist pins that exact portal origin. Vite is configured with `strictPort` and fails immediately instead of silently moving to 5174 (which would break every credentialed request). If either port is taken — often a previous `pnpm dev` that did not exit — stop that process and rerun. The local seed step also times out after 60 seconds when the Worker cannot start on 8787.

### E2E tests fail with "Executable doesn't exist"

Run `pnpm exec playwright install chromium` once. Also stop `pnpm dev` before `pnpm test:e2e`: the E2E slots start their own Workers and clash with a running dev server's ports.

### Uploads fail

Confirm that `MEDIA` points to the one expected R2 bucket. Persisted images must be WebP or GIF; profile audio must be Ogg containing Opus. The Worker compares the declared MIME type with magic bytes and rejects SVG. Ordinary API bodies are limited to 1 MiB and upload requests to 32 MiB; smaller per-file limits live in Site Config.

### Ask for setup help safely

Use the repository's **Setup help** issue form and include the failing command plus complete error text. Remove passwords, cookies, invite codes, `SIGNING_SECRET`, Cloudflare API tokens, and private guild data. Your `wrangler.jsonc` resource identifiers are configuration, not authentication secrets — and the file is untracked, so nothing publishes them automatically — but you may still redact identifiers you do not want in a public issue.
