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

The app is designed around a shared game definition. Classes, roles, member stats, event types, war metrics, and labels live in TypeScript configuration instead of being hardcoded throughout the frontend and backend. That keeps the project adaptable when the guild changes games or needs a different ruleset.

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
├── shared/   Zod schemas, shared types, constants, game config, API contracts
├── worker/   Hono API on Cloudflare Workers, D1, R2, Durable Objects
└── portal/   React SPA with TanStack Router, TanStack Query, Mantine, Zustand
```

The shared package is the contract layer. Backend routes validate with shared Zod schemas, frontend queries consume the same inferred types, and game-specific behavior is centralized instead of duplicated.

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
| `pnpm test:worker` | Run seeded Worker integration tests |
| `pnpm smoke:pages` | Smoke-test key portal pages with Worker and portal running |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:mock:rebuild` | Drop and recreate the local D1 database |
| `pnpm db:mock:init` | Apply migrations to the local D1 database |
| `pnpm db:mock:seed` | Seed local data through the running Worker |

## Adapting the Portal to Another Game

Most game-specific behavior starts in the active game definition. Copy the existing game file, edit the values, then export your definition as the active game.

### 1. Create a game definition

Copy `apps/shared/games/definitions/yan-yun.ts` to a new file, for example:

```typescript
// apps/shared/games/definitions/my-game.ts
import type { GameDefinition } from "../types";

export const myGame: GameDefinition = {
  id: "my-game",
  name: "My Game",

  classes: [
    { id: "warrior", label: "Warrior", colorGroup: "red", role: "tank" },
    { id: "mage", label: "Mage", colorGroup: "blue", role: "dps" },
    { id: "priest", label: "Priest", colorGroup: "green", role: "healer" },
  ],

  classColorMapping: {
    warrior: "var(--mantine-color-red-6)",
    mage: "var(--mantine-color-blue-6)",
    priest: "var(--mantine-color-green-6)",
  },

  roles: [
    { id: "tank", label: "Tank", color: "blue", avatarColor: "#4dabf7", icon: "IconShield" },
    { id: "dps", label: "DPS", color: "red", avatarColor: "#ff6b6b", icon: "IconSword" },
    { id: "healer", label: "Healer", color: "green", avatarColor: "#51cf66", icon: "IconHeart" },
  ],
  defaultRole: "dps",

  profileStats: [
    { key: "power", label: "Power", type: "number", sortable: true },
  ],

  war: {
    enabled: true,
    featureLabel: "guild-war:title",
    resultOptions: ["victory", "defeat", "draw"],
    teamObjectives: [
      { key: "score", label: "guild-war:conclude.score", hasBothSides: true },
    ],
    memberStats: [
      { key: "kills", label: "guild-war:stats.kills", aggregations: ["total", "average", "best"] },
      { key: "deaths", label: "guild-war:stats.deaths", aggregations: ["total", "average", "best"], lowerIsBetter: true },
      { key: "damage", label: "guild-war:stats.damage", aggregations: ["total", "average", "best"] },
      { key: "healing", label: "guild-war:stats.healing", aggregations: ["total", "average", "best"] },
    ],
    computedStats: [
      {
        key: "kda",
        label: "guild-war:stats.kda",
        compute: (s) => (s.kills + (s.assists ?? 0)) / Math.max(s.deaths, 1),
      },
    ],
    mvpCategories: ["kills", "damage", "healing"],
    defaultTeamNames: ["Team A", "Team B"],
    modifierWeights: { kills: 1, damage: 1, healing: 1 },
  },

  eventTypes: [
    { id: "guild_war", label: "Guild War", icon: "IconSwords", color: "red" },
    { id: "raid", label: "Raid", icon: "IconTarget", color: "orange" },
    { id: "social", label: "Social", icon: "IconUsers", color: "blue" },
  ],
};
```

### 2. Make it active

```typescript
// apps/shared/games/index.ts
export { myGame as activeGame } from "./definitions/my-game";
```

### 3. Add translations

Add labels used by the game definition to the relevant i18n files, such as:

- `apps/portal/i18n/en/guild-war.json`
- `apps/portal/i18n/zh/guild-war.json`

### 4. Update branding

Set the site name, logo path, and portal origin in your local `apps/worker/wrangler.jsonc` (copy from `wrangler.example.jsonc` first):

```jsonc
"vars": {
  "SITE_NAME": "Your Guild Name",
  "SITE_LOGO_URL": "/your-logo.webp",
  "PORTAL_ORIGIN": "https://your-domain.com"
}
```

Place the logo under `apps/portal/public/`, or replace the existing `guild-logo.webp`.

### 5. Toggle optional modules

Site owners can change modules without editing code. Sign in as an administrator and open **Admin → Site Config → Features**.

The code-level defaults, used for new database rows, live in `apps/shared/config/features.ts`:

```typescript
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  announcements: true,
  events: true,
  guildWar: true,
  gallery: true,
  wiki: true,
  tools: true,
  storage: true,
};
```

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
