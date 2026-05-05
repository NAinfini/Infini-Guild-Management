<div align="center">

# Infini Guild Management Portal

**Your guild deserves better than a spreadsheet.**

A modular, full-stack guild portal that adapts to **any game** — powered by a single config file.

Roster. Events. War analytics. Wiki. Gallery. All in one place.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare)](https://workers.cloudflare.com/)

[English](./README.md) | [中文](./README.zh.md)

</div>

---

## Why This Exists

Most guild tools are either game-locked SaaS platforms you can't customize, or a mess of Google Sheets and Discord bots held together with duct tape.

This project is different. It's a **complete, self-hosted guild portal** where every game-specific detail — classes, stats, war objectives, roles — lives in a single TypeScript file. Change that file, and you have a portal for an entirely different game. No fork gymnastics, no ripping out hardcoded values.

> **TL;DR** — One config file. Any game. Full-stack. Deploy to Cloudflare for free.

---

## What You Get

| Module | What It Does |
|---|---|
| **Member Roster** | Profiles with classes, stats, bio, media gallery, availability grid |
| **Events** | Recurring events, capacity limits, sign-up locking, participant tracking |
| **Announcements** | Rich text editor, draft/scheduled/published/archived lifecycle, pinning |
| **Guild War** | War history, drag & drop team builder, per-member stats, full analytics suite |
| **War Analytics** | Normalization, computed metrics (KDA etc.), heatmaps, contribution charts, radar |
| **Wiki** | Hierarchical categories, rich text articles |
| **Gallery** | Cloud-backed media uploads with captions |
| **Admin Console** | Role & permission management, invite links, audit log with R2 archival |
| **Quick Search** | `Cmd+K` / `Ctrl+K` across all content |
| **Realtime** | WebSocket push for live event and war updates |
| **i18n** | English + Chinese out of the box, extensible |
| **Feature Flags** | Toggle any module on/off without code changes |

---

## Architecture

```
apps/
├── shared/     Zod schemas, types, game definitions, API registry
│                 ↕ shared contract
├── worker/     Cloudflare Worker — Hono API + D1 + R2 + Durable Objects
│                 ↕ serves
└── portal/     React SPA — TanStack Router + Mantine UI
```

Everything shares one TypeScript codebase. The worker serves the portal as static assets — **one deploy, one URL**.

---

## Tech Stack

| | |
|---|---|
| **Frontend** | React 19 · Vite 8 · TanStack Router & Query · Mantine 8 · Tailwind CSS 4 · Zustand 5 |
| **Editor** | TipTap 3 (rich text) · ECharts 5 (charts) |
| **Backend** | Hono on Cloudflare Workers · Drizzle ORM · D1 (SQLite) · R2 (object storage) |
| **Realtime** | Cloudflare Durable Objects (WebSocket) |
| **Validation** | Zod 4 — shared between frontend and backend |
| **Forms** | react-hook-form + Zod resolvers |
| **i18n** | i18next + react-i18next |

---

## Make It Yours — 5 Steps

All game-specific config lives in one file. Here's how to adapt it:

### Step 1 — Define your game

Copy `apps/shared/games/definitions/yan-yun.ts` and fill in your game's details:

```typescript
// apps/shared/games/definitions/my-game.ts
import type { GameDefinition } from "../types";

export const myGame: GameDefinition = {
  id: "my-game",
  name: "My Game",

  classes: [
    { id: "warrior", label: "Warrior", colorGroup: "red",   role: "tank" },
    { id: "mage",    label: "Mage",    colorGroup: "blue",  role: "dps" },
    { id: "priest",  label: "Priest",  colorGroup: "green", role: "healer" },
  ],

  classColorMapping: {
    warrior: "var(--mantine-color-red-6)",
    mage:    "var(--mantine-color-blue-6)",
    priest:  "var(--mantine-color-green-6)",
  },

  roles: [
    { id: "tank",   label: "Tank",   color: "blue",  avatarColor: "#4dabf7", icon: "IconShield" },
    { id: "dps",    label: "DPS",    color: "red",   avatarColor: "#ff6b6b", icon: "IconSword" },
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
      { key: "kills",   label: "guild-war:stats.kills",   aggregations: ["total", "average", "best"] },
      { key: "deaths",  label: "guild-war:stats.deaths",  aggregations: ["total", "average", "best"], lowerIsBetter: true },
      { key: "damage",  label: "guild-war:stats.damage",  aggregations: ["total", "average", "best"] },
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
    { id: "raid",      label: "Raid",      icon: "IconTarget", color: "orange" },
    { id: "social",    label: "Social",    icon: "IconUsers",  color: "blue" },
  ],
};
```

### Step 2 — Activate it

```typescript
// apps/shared/games/index.ts
export { myGame as activeGame } from "./definitions/my-game";
```

### Step 3 — Add translations

Update the `label` keys in your i18n files:
- `apps/portal/i18n/en/guild-war.json`
- `apps/portal/i18n/zh/guild-war.json`

### Step 4 — Brand it

In `apps/worker/wrangler.jsonc`:

```jsonc
"vars": {
  "SITE_NAME": "Your Guild Name",
  "SITE_LOGO_URL": "/your-logo.webp",  // place in apps/portal/public/
  "PORTAL_ORIGIN": "https://your-domain.com"
}
```

### Step 5 — Toggle features (optional)

In `apps/shared/config/features.ts`, turn off what you don't need:

```typescript
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  announcements: true,
  events: true,
  guildWar: false,  // don't need war tracking? gone.
  gallery: true,
  wiki: true,
  tools: true,
};
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 10+
- Cloudflare account (for production — local dev works without one)

### Run locally

```bash
pnpm install
pnpm dev          # starts worker + portal + auto-seeds DB
```

That's it. Open `http://localhost:5173` and log in:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | admin |
| `mod_1` | `moderator123` | moderator |
| `member_01` | `member1234` | member |

### Commands

| Command | What |
|---|---|
| `pnpm dev` | Start everything (worker + portal + seed) |
| `pnpm dev:worker` | Worker API only (`http://127.0.0.1:8787`) |
| `pnpm dev:portal` | Portal only (Vite proxies API) |
| `pnpm build` | Build portal SPA |
| `pnpm build:worker` | Dry-run worker deploy |
| `pnpm typecheck` | TypeScript check |
| `pnpm test` | Run tests |
| `pnpm lint` | Lint |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:mock:rebuild` | Drop + recreate local DB |
| `pnpm db:mock:reset` | Drop local DB only |
| `pnpm db:mock:init` | Apply migrations (keep data) |
| `pnpm db:mock:seed` | Seed mock data (worker must be running) |

---

## Deploy to Production

```bash
# 1. Create D1 database + R2 bucket on Cloudflare dashboard

# 2. Update wrangler.jsonc with production IDs and secrets

# 3. Run migrations
wrangler d1 migrations apply <your-db> --config apps/worker/wrangler.jsonc

# 4. Ship it
wrangler deploy --config apps/worker/wrangler.jsonc
```

The portal SPA is bundled as static assets and served from the Worker — one deployment, one URL, no separate hosting.

---

## Environment Variables

### Worker (`apps/worker/wrangler.jsonc`)

| Variable | Description |
|---|---|
| `ENVIRONMENT` | `development` or `production` |
| `PORTAL_ORIGIN` | Allowed CORS origin |
| `SIGNING_SECRET` | HMAC secret for audit archive tokens |
| `SITE_NAME` | Guild name in the UI |
| `SITE_LOGO_URL` | Path to logo image |

### Portal (`apps/portal/.env.local`)

| Variable | Default | Description |
|---|---|---|
| `VITE_WORKER_API_ORIGIN` | `http://127.0.0.1:8787` | Dev proxy target |

---

## API

All endpoints under `/api/`. Session-based auth via HTTP-only cookies.

| Route | Description |
|---|---|
| `/api/auth` | Login, register (invite-only), session management |
| `/api/users` | Roster, profiles, media uploads |
| `/api/events` | Events, recurrence, sign-ups |
| `/api/announcements` | Rich text announcements |
| `/api/guild-war` | War history, teams, stats, analytics |
| `/api/wiki` | Categories + articles |
| `/api/gallery` | Media uploads |
| `/api/admin` | Users, roles, invites, audit log |
| `/ws` | WebSocket (Durable Object) |

**Roles:** `admin` > `moderator` > `member` (custom roles supported)

**Rate limits:** Auth 5/min · Mutations 80/min · Uploads 20/min

---

## Security

- HttpOnly cookie sessions — no client-side tokens
- RBAC on client and server
- CSRF via `X-Requested-With` header
- Password max 128 chars (PBKDF2 DoS prevention)
- DOMPurify strict allowlist for all HTML
- Generic login errors — no username enumeration
- Full security headers (HSTS, CSP, X-Frame-Options DENY, nosniff)

---

## Scheduled Jobs

| Schedule | What |
|---|---|
| Daily 00:00 UTC | Generate event instances, clean sessions, archive audit, delete orphaned media |
| Every 15 min | Auto-archive past events, publish scheduled announcements |

---

## License

[MIT](./LICENSE)
