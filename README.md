<div align="center">

# Infini Guild Management Portal

**A self-hosted guild portal for rosters, events, war planning, wiki content, media, and staff tools.**

Built as one Cloudflare Worker plus one React app, with shared TypeScript contracts across the stack.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare)](https://workers.cloudflare.com/)

[English](./README.md) | [中文](./README.zh.md)

[Setup guide](./SETUP.md) · [Contributing](./CONTRIBUTING.md) · [Security policy](./SECURITY.md)

</div>

---

## Overview

Infini Guild Management is a full-stack portal for running a game guild without spreading core data across spreadsheets, Discord pins, and one-off tools.

Runtime customization lives with the data it controls: administrators manage branding, feature flags, limits, classes, class tags, roles, and permissions through D1-backed settings and catalogs. Event and guild-war keys that are persisted or drive product behavior remain explicit shared API contracts.

The deployment model is also simple: the React portal is built into static assets and served by the Cloudflare Worker that runs the API. One deploy gives you one URL for the whole portal.

## Features

| Area | Included |
| --- | --- |
| Member roster | Member profiles, classes, stats, bio, media, and availability |
| Events | Recurring events, capacity limits, signup locking, and participant tracking |
| Announcements | Rich text drafts, scheduled publishing, archive states, and pinning |
| Guild war | War history, team builder, member stats, templates, and analytics |
| Wiki | Categories and rich text articles for guild knowledge |
| Gallery | Cloud-backed media uploads with captions |
| Media | Uploads are transcoded in the browser before they leave the page — images to WebP, audio to Opus |
| Admin console | Roles, permissions, invite links, audit logs, and system status |
| Tools | Title styling and dice roller |
| Search | `Cmd+K` / `Ctrl+K` command search across portal content |
| Realtime | WebSocket updates through Cloudflare Durable Objects |
| Localization | English and Chinese translations |
| Feature flags | Per-module switches through Admin → Site Config |

## Architecture

```text
apps/
├── shared/   Zod schemas, shared types, domain constants, API contracts
├── worker/   Hono API on Cloudflare Workers, D1, R2, Durable Objects
└── portal/   React SPA with TanStack Router, TanStack Query, Mantine, Zustand
```

The shared package is the contract layer. Backend routes validate with shared Zod schemas, and frontend queries consume the same inferred types. Runtime catalogs live in D1; stable persisted values remain small, focused domain constants.

## Tech Stack

| Layer | Stack |
| --- | --- |
| Frontend | React 19, Vite 8, TanStack Router, TanStack Query, Mantine 8, Zustand 5, plain CSS with custom properties |
| Rich content and charts | TipTap 3, ECharts 6 |
| Backend | Hono on Cloudflare Workers, Drizzle ORM, Cloudflare D1 |
| Storage | Cloudflare R2 for media and audit archives |
| Realtime | Cloudflare Durable Objects with WebSocket connections |
| Validation | Zod 4 shared by frontend and backend |
| Forms | react-hook-form with Zod resolvers |
| Localization | i18next and react-i18next |

## Quick Start

### Prerequisites

- Node.js 24 LTS (24.18.0 or newer)
- pnpm 11.17.0
- A Cloudflare account for deployed environments

Local development does not require a Cloudflare account.

### Run Locally

```bash
pnpm install
pnpm setup:local
pnpm dev
```

`pnpm setup:local` creates ignored local configuration and a random development signing secret without overwriting existing files. `pnpm dev` then rebuilds the local D1 database, starts the Worker and portal dev servers, and seeds mock data.

Open `http://localhost:5173` and sign in with one of the seeded accounts:

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `admin123` | admin |
| `mod_1` | `moderator123` | moderator |
| `member_01` | `member1234` | member |

## Common Commands

| Command | Purpose |
| --- | --- |
| `pnpm setup:local` | Safely create ignored local configuration and a random secret |
| `pnpm setup:admin -- --env=production` | Create the first administrator in an empty production database |
| `pnpm config:check -- --env=production` | Check production bindings and placeholders before deployment |
| `pnpm dev` | Rebuild local DB, start Worker and portal, seed data |
| `pnpm dev:all` | Start Worker and portal without rebuilding or seeding |
| `pnpm dev:worker` | Start the Worker API at `http://127.0.0.1:8787` |
| `pnpm dev:portal` | Start the Vite portal dev server |
| `pnpm build` | Build the portal SPA |
| `pnpm build:worker` | Dry-run a Worker deployment |
| `pnpm deploy:production` | Preflight, build, and deploy the production site |
| `pnpm typecheck` | Run TypeScript checking for the workspace |
| `pnpm lint` | Run ESLint for portal and worker code |
| `pnpm test` | Run Vitest |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:mock:rebuild` | Drop and recreate the local D1 database |
| `pnpm db:mock:init` | Apply migrations to the local D1 database |
| `pnpm db:mock:seed` | Seed local data through the running Worker |

## Adapting the Portal

There is no active-game definition file. Change each concern at its authoritative source:

| Concern | Source of truth | Runtime change? |
| --- | --- | --- |
| Site name, logo, feature flags, limits | **Admin → Site Config** (`site_config`) | Yes |
| Classes, colors, and icons | **Admin → Classes** (`class_catalog`) | Yes |
| Class groupings used by event quotas | Class tags (`class_tags`) | Yes |
| Roles and permissions | Admin role management (`roles`, `role_permissions`) | Yes |
| Guild-war analytics weights | `site_config.analytics_settings_json` | Yes |
| Event types and war result/stat keys | `apps/shared/constants/` domain contracts | No; requires code and data migration |
| Labels | `apps/portal/i18n/` | Build and deploy |

Event types such as polls and raffles have dedicated behavior, and guild-war keys are stored in historical JSON. Do not turn either list into an editable setting without designing versioning and a migration for existing rows.

## Deployment

Follow the beginner-friendly [self-hosting setup guide](./SETUP.md). It covers Cloudflare login, D1 and R2 creation, secrets, migrations, the first administrator, `workers.dev`, custom domains, updates, and troubleshooting.

After the one-time setup, production releases use:

```bash
pnpm exec wrangler d1 migrations apply DB --remote --env production --config apps/worker/wrangler.jsonc
pnpm deploy:production
```

The repository does not create a default production password. Use `pnpm setup:admin -- --env=production` exactly once, after migrations, to create the first administrator securely.

## Environment Variables

### Worker (`apps/worker/wrangler.example.jsonc`)

| Variable | Description |
| --- | --- |
| `ENVIRONMENT` | `development` or `production` |
| `PORTAL_ORIGIN` | Optional allowed origin for a separately hosted portal; leave empty for same-origin hosting |
| `SIGNING_SECRET` | HMAC secret for audit archive download tokens |
| `SITE_NAME` | Guild name shown in the UI |
| `SITE_LOGO_URL` | Path to the logo image served by the portal |

### Portal (`apps/portal/.env.local`)

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_WORKER_API_ORIGIN` | `http://127.0.0.1:8787` | Worker API origin used by the Vite dev proxy |

## API Overview

All API routes live under `/api/`. Authentication uses HTTP-only session cookies.

| Route | Description |
| --- | --- |
| `/api/auth` | Login, invite registration, session checks, username checks |
| `/api/users` | Member roster, profile data, and profile media |
| `/api/events` | Events, recurrence, signups, votes, and participants |
| `/api/announcements` | Rich text announcements and publishing states |
| `/api/guild-war` | War history, teams, stats, analytics, and templates |
| `/api/wiki` | Wiki categories and articles |
| `/api/gallery` | Gallery items and media uploads |
| `/api/admin` | Users, roles, invites, audit logs, and status |
| `/ws` | WebSocket endpoint backed by a Durable Object |

Roles are ordered as `admin` > `moderator` > `member`. Custom roles are supported through the admin console.

Rate limits are applied by route group: auth, mutations, uploads, and API reads each have separate limits.

## Security Notes

- Sessions are stored in HTTP-only cookies.
- Client-side RBAC is for UX; backend RBAC remains authoritative.
- Mutating requests require the `X-Requested-With` CSRF header.
- Password input is capped at 128 characters to prevent PBKDF2 abuse.
- Rich text HTML is sanitized before display.
- Login errors are generic to avoid username enumeration.
- Security headers include HSTS, CSP, `X-Frame-Options: DENY`, and `nosniff`.
- Uploads are validated server-side against an image allow-list (JPEG, PNG, GIF, WebP, AVIF) and their magic bytes; SVG is never accepted, and the stored content type comes from the detected bytes rather than the client's header.

Report vulnerabilities privately according to [SECURITY.md](./SECURITY.md).

## Scheduled Jobs

| Schedule | Jobs |
| --- | --- |
| Daily at 00:00 UTC | Generate future event instances, clean sessions, archive audit logs, remove orphaned media |
| Every 15 minutes | Auto-archive past events, publish scheduled announcements, expire old announcements |

## License

[MIT](./LICENSE)
