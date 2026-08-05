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

`pnpm setup:local` preserves an existing tracked `apps/worker/wrangler.jsonc`, restores it from `wrangler.example.jsonc` only when missing, and creates an ignored `apps/worker/.dev.vars` with a random local `SIGNING_SECRET`. It never overwrites an existing configuration or `.dev.vars` file. Do not commit `.dev.vars`.

Open `http://localhost:5173` after the portal is ready. Local development uses disposable demo data:

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `admin123` | Administrator |
| `mod_1` | `moderator123` | Moderator |
| `member_01` | `member1234` | Member |

`pnpm dev` rebuilds the local D1 database and seeds it again. These accounts are never created in production.

## Production schema policy

This repository is still before its first production initialization. `apps/worker/db/migrations/0000_core_schema.sql` is the only core migration and represents the complete fresh-database schema.

- Before the first production D1 database is created, maintainers may synchronize and rebuild `0000_core_schema.sql` with the current source schema.
- Creating the first production D1 database is the freeze point: from then on, do not edit or replace `0000_core_schema.sql` for that production line.
- Every later schema change must be a new incremental migration that preserves existing data.
- Never patch a production D1 database manually. Apply reviewed migrations through Wrangler, and back up production data before an authorized remote migration.

The schema deliberately has no runtime game-rule tables. Event types, war results, stat keys, and KDA behavior are source-owned contracts, not Site Config records.

## 2. Connect Cloudflare and create resources

The tracked `apps/worker/wrangler.jsonc` is this deployment's reviewed manifest. A fork must replace its production D1 binding, R2 binding, route, `PORTAL_ORIGIN`, and fallback branding with resources it owns before deployment. Resource names, IDs, and routes in the tracked manifest are configuration identifiers, not credentials; `SIGNING_SECRET` and Cloudflare API tokens are secrets.

Log in:

```bash
pnpm exec wrangler login
```

Create the production D1 database and update the `DB` binding:

```bash
pnpm exec wrangler d1 create my-guild-db --binding DB --env production --update-config --config apps/worker/wrangler.jsonc
```

This is the first production D1 creation described by the freeze policy above.

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
  "ENABLE_PRODUCTION_SYSTEM_TESTS": "false",
  "SITE_NAME": "My Guild",
  "SITE_LOGO_URL": "/guild-logo.webp"
}
```

For the normal same-Worker deployment, leave `PORTAL_ORIGIN` empty. Set it only when a separately hosted frontend must call this Worker.

Keep `MEDIA_ORPHAN_DELETE_MODE` at `report` until operators have reviewed a complete media-reference scan. `ENABLE_PRODUCTION_SYSTEM_TESTS=false` keeps fixture-creating system-test routes unavailable in production; only enable them for an explicit, controlled maintenance window.

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

The command requires an interactive terminal, hides password input, requires a 12–128 character password, operates only on the explicitly selected production environment, refuses to run when any user already exists, and removes its temporary SQL directory. All later users should register through invite links created in Admin.

## 5. Deploy

Run:

```bash
pnpm deploy:production
```

This runs the repository's production release checks, builds the portal, performs a Worker deployment dry run, and deploys the Worker with its static assets. Use this script instead of a bare `wrangler deploy`, which can publish stale frontend assets or skip required checks.

Wrangler prints the public URL after deployment. Open it and sign in with the administrator created in step 4.

## 6. Finish configuration in Admin

Open **Admin → Site Config** and review:

1. **Branding** — site name and uploaded logo.
2. **Features** — `announcements`, `events`, `guildWar`, `gallery`, `wiki`, `tools`, and `storage`.
3. **Limits** — per-file upload limits, media quotas, and storage images per item.

Then use **Admin → Invites** to create member invitations. Never reuse the bootstrap administrator password.

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

## Optional custom domain

Choose one production exposure mode before the configuration check:

1. For `workers.dev`, set `env.production.workers_dev` to `true` and remove the tracked production `routes` entry.
2. For a Cloudflare-managed custom domain, set `workers_dev` to `false` and replace `routes` with your hostname, for example `guild.example.com`.
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

An initialized site must never rerun `pnpm setup:admin`, rewrite `0000_core_schema.sql`, or apply direct production D1/R2 edits. Future repository releases must provide incremental migrations for schema changes.

## Troubleshooting

### `wrangler.jsonc` is missing

Restore the tracked file, or run `pnpm setup:local` to copy the repository example only when the file is absent.

### The configuration check reports a placeholder

Read the exact field in the error. Re-run the matching D1/R2 `--update-config` command or replace only that production value.

### Cloudflare authentication fails

```bash
pnpm exec wrangler logout
pnpm exec wrangler login
```

### The first-admin command reports existing users

This is a safety stop. Use an existing administrator. If no administrator is usable, do not delete or modify production data; request help with credentials and private guild data removed.

### Uploads fail

Confirm that `MEDIA` points to the one expected R2 bucket. Persisted images must be WebP or GIF; profile audio must be Ogg containing Opus. The Worker compares the declared MIME type with magic bytes and rejects SVG. Ordinary API bodies are limited to 1 MiB and upload requests to 32 MiB; smaller per-file limits live in Site Config.

### Ask for setup help safely

Use the repository's **Setup help** issue form and include the failing command plus complete error text. Remove passwords, cookies, invite codes, `SIGNING_SECRET`, Cloudflare API tokens, and private guild data. Tracked `wrangler.jsonc` resource identifiers are configuration, not authentication secrets, but a private fork may still redact identifiers it does not want to publish.
