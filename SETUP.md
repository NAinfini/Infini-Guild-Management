# Self-hosting setup guide

This guide takes a new installation from a fresh clone to a working Cloudflare deployment. You do not need an existing server: Cloudflare Workers serves both the website and API.

Chinese version: [SETUP.zh.md](./SETUP.zh.md)

## What you need

- A computer with [Node.js 24 LTS (24.18.0 or newer)](https://nodejs.org/)
- pnpm 11.17.0 (`npm install --global pnpm@11.17.0` if `pnpm --version` fails)
- A free or paid [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Git, or a downloaded ZIP of this repository

You do not need a custom domain. The first deployment can use a free `*.workers.dev` address.

## 1. Try the site locally

From the repository folder, run:

```bash
pnpm install
pnpm setup:local
pnpm dev
```

`setup:local` creates two ignored files:

- `apps/worker/wrangler.jsonc`, your private Cloudflare configuration
- `apps/worker/.dev.vars`, containing a randomly generated local signing secret

It never overwrites either file. Do not add them to Git.

Open `http://localhost:5173` after the terminal reports that the portal is ready. Local development uses disposable demo data:

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `admin123` | Administrator |
| `mod_1` | `moderator123` | Moderator |
| `member_01` | `member1234` | Member |

Stopping and restarting with `pnpm dev` resets this local database. These demo accounts are never created in production.

## 2. Connect Cloudflare

Log in from the terminal:

```bash
pnpm exec wrangler login
```

Your browser should open a Cloudflare authorization page. Return to the terminal after it confirms the login.

Create a production D1 database and let Wrangler update the `DB` binding:

```bash
pnpm exec wrangler d1 create my-guild-db --binding DB --env production --update-config --config apps/worker/wrangler.jsonc
```

Create a production R2 bucket and update the `MEDIA` binding:

```bash
pnpm exec wrangler r2 bucket create my-guild-media --binding MEDIA --env production --update-config --config apps/worker/wrangler.jsonc
```

If either command says that the resource already exists, choose a different globally unique name or enter its existing ID/name manually in `env.production`.

## 3. Set the site name and secret

Open `apps/worker/wrangler.jsonc` and edit only these production values:

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "PORTAL_ORIGIN": "",
  "SITE_NAME": "My Guild",
  "SITE_LOGO_URL": "/guild-logo.webp"
}
```

For the normal same-Worker deployment, keep `PORTAL_ORIGIN` empty. It is only needed when a separately hosted frontend calls the API.

Store the production signing secret in Cloudflare:

```bash
pnpm exec wrangler secret put SIGNING_SECRET --env production --config apps/worker/wrangler.jsonc
```

Paste a long random value when prompted. The value belongs in Cloudflare, not in `wrangler.jsonc`, `.env`, an issue, or a commit.

Check the configuration:

```bash
pnpm config:check -- --env=production
```

Do not continue until it prints:

```text
[config] production configuration is ready.
```

## 4. Create the production database and first administrator

Apply all database migrations:

```bash
pnpm exec wrangler d1 migrations apply DB --remote --env production --config apps/worker/wrangler.jsonc
```

Create the first administrator:

```bash
pnpm setup:admin -- --env=production
```

The command:

- requires an interactive terminal and hides password input;
- requires a 12-128 character password;
- only writes to the explicitly selected environment;
- refuses to run when any user already exists;
- removes its temporary SQL file immediately.

All later users should join through invite links created in the Admin console.

## 5. Deploy

Run:

```bash
pnpm deploy:production
```

This performs the config check, builds the React portal, and deploys the Worker and static assets together. Wrangler prints the public URL when it finishes. Open that URL and sign in with the administrator account from step 4.

If the page is blank or shows old content, run `pnpm build` and `pnpm deploy:production` again. Do not run a bare `wrangler deploy` after frontend changes because it may reuse an old portal build.

## 6. Finish setup in the Admin console

Open **Admin → Site Config** and review:

1. **Branding** — site name and uploaded logo.
2. **Features** — announcements, events, guild war, gallery, wiki, tools, equipment calculator, and storage.
3. **Limits** — per-file upload limits, media quotas, and storage images per item.
4. **Onboarding** — rules, acknowledgement requirement, and checklist for new members.

Then open **Admin → Invites** and create the first member invite. Never reuse the bootstrap administrator password for another account.

The Admin console stores these settings in D1. `SITE_NAME` and `SITE_LOGO_URL` in Wrangler remain safe fallback values used while the app starts.

## Where each setting belongs

| What you want to change | Correct place | Restart or deploy? |
| --- | --- | --- |
| Site name, logo, enabled modules, media quotas, onboarding | **Admin → Site Config** | No |
| Member roles, permissions, invites | **Admin console** | No |
| D1, R2, domain, environment, fallback branding | `apps/worker/wrangler.jsonc` | Deploy |
| Cloudflare signing secret | `wrangler secret put` | Deploy |
| Game classes and class tags | **Admin → Classes** | No |
| Guild-war analytics weights | `/api/admin/analytics-settings` | No |
| Persisted event/result/stat keys | Shared domain contracts plus a data migration | Build and deploy |
| Hard safety ceilings, rate limits, and pagination defaults | `apps/shared/config/limits.ts` | Build and deploy |

There is no `FEATURES` environment variable. Runtime module switches belong in Admin → Site Config so there is one source of truth.

## Optional: use a custom domain

The default production config uses `workers_dev: true`, so a domain is not required. To use a domain already managed by Cloudflare:

1. Change `workers_dev` to `false` under `env.production`.
2. Uncomment the example `routes` entry.
3. Replace its pattern with your hostname, such as `guild.example.com`.
4. Run `pnpm config:check -- --env=production`.
5. Run `pnpm deploy:production`.

Because the portal and API share one origin, `PORTAL_ORIGIN` can remain empty.

## Updating an existing installation

Back up D1 before a major update, then run:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm exec wrangler d1 migrations apply DB --remote --env production --config apps/worker/wrangler.jsonc
pnpm deploy:production
```

Never run `pnpm setup:admin` on an existing installation.

## Troubleshooting

### `wrangler.jsonc not found`

Run `pnpm setup:local`. If you already have a private config elsewhere, copy it to `apps/worker/wrangler.jsonc`.

### A placeholder is reported

Read the exact field in the `config:check` error. Re-run the D1 or R2 `--update-config` command, or replace that one value in `env.production`.

### `Authentication error` or browser login did not finish

Run `pnpm exec wrangler logout`, then `pnpm exec wrangler login`.

### The first-admin command says users already exist

This is a safety stop, not a failure. Sign in with the existing administrator. If no administrator exists, do not delete production data; open a support issue with all secrets and resource IDs removed.

### Uploads fail

Check that the `MEDIA` binding points to the correct R2 bucket. The request-wide ceilings are 1 MiB for ordinary API mutations and 32 MiB for upload routes; smaller per-file limits can be changed in **Admin → Site Config**.

### Asking for help safely

Use the repository's **Setup help** issue form. Include the command and error text, but remove:

- passwords, cookies, invite codes, and signing secrets;
- Cloudflare API tokens;
- D1 database IDs, account IDs, and private hostnames.
