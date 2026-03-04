# Infini Guild Management Portal

A private, full-stack guild management system for the Infini game community. Handles members, events, announcements, guild wars, wiki, gallery, and multi-platform bot integrations (Discord & WeChat).

---

## Architecture

Monorepo with four apps sharing a single TypeScript contract:

```
apps/
├── shared/        # Zod schemas, types, constants, API registry
├── worker/        # Cloudflare Worker — Hono API + D1 + R2 + Durable Objects
├── portal/        # React SPA — TanStack Router + Mantine (Infini-Dev-Kit)
└── bot-runtime/   # Node.js long-running service — Discord.js + Wechaty
```

External design system: [`Infini-Dev-Kit`](../Infini-Dev-Kit) (theme, motion, components, bot cores).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 6, TanStack Router, TanStack Query |
| Design System | `@infini-dev-kit/frontend` (wraps Mantine 7) |
| Forms | react-hook-form + Zod |
| Rich Text | TipTap 2 |
| Charts | ECharts 5 (echarts-for-react) |
| Global State | Zustand 5 |
| i18n | i18next + react-i18next (en, zh) |
| Backend | Cloudflare Workers + Hono |
| Database | Cloudflare D1 (SQLite) + Drizzle ORM |
| Object Storage | Cloudflare R2 |
| Realtime | Cloudflare Durable Objects (WebSocket) |
| Validation | Zod (shared between portal and worker) |
| Bots | Discord.js 14, Wechaty (WeChat) |
| IDs | nanoid |
| Package Manager | pnpm 10.6.2 |
| Runtime | Node.js 20 |

---

## Features

- **Member Roster** — Profiles with classes (9 types), power (造诣), bio, media (images/audio/video), availability grid, Discord linking
- **Events** — CRUD with recurrence rules, capacity, sign-up locking, participant tracking
- **Announcements** — TipTap rich text, draft/scheduled/published/archived lifecycle, pinning
- **Guild War** — War history, team composition (drag & drop), per-member stats (kills/damage/healing/credits/etc.)
- **Wiki** — Hierarchical categories, TipTap articles
- **Gallery** — R2-backed media uploads with captions
- **Admin Console** — User/role management, invite link system, audit log (90-day D1 hot + 1-year R2 archive), bot settings
- **Global Search** — `Cmd+K` / `Ctrl+K` across members, events, announcements, wiki, war history
- **Bot Integration** — Discord slash commands, event notifications, reaction-to-join; WeChat room messaging (extensible)
- **Realtime** — WebSocket push via Durable Objects for events and guild war pages

---

## Project Structure

```
apps/shared/
├── api/           # Endpoint registry
├── constants/     # Roles, event types, classes, errors, media
├── schemas/       # Zod validation schemas
└── types/         # TypeScript types derived from schemas

apps/worker/
├── db/
│   ├── schema.ts          # Compatibility barrel export for schema modules
│   ├── schema/            # Modular Drizzle schema by bounded context
│   ├── seed.ts
│   └── migrations/        # Wrangler D1 migrations + semantic version registry
├── routes/                # API route handlers
├── services/              # Business logic (auth, bot-dispatch, audit)
├── middleware/            # CORS, HMAC, rate-limit, session, RBAC, etag
├── crons/                 # Scheduled job handlers
├── durable-objects/       # WebSocketDO
└── wrangler.jsonc

apps/portal/
├── api/
│   ├── client.ts          # HTTP client with ETag caching
│   ├── queries/           # TanStack Query fetchers
│   └── mutations/         # TanStack Query mutations
├── components/
│   ├── layout/            # AppShell, BottomNav, CmdKSearch
│   ├── pages/             # 8 main page components
│   └── shared/            # MemberCard, TipTapEditor, AvailabilityGridEditor, etc.
├── stores/                # Zustand auth + preferences stores
├── i18n/                  # en/ and zh/ translation files
└── router.tsx             # All route definitions

apps/bot-runtime/
├── discord/               # Discord.js adapter, commands, formatters, reactions
├── wechat/                # Wechaty adapter (stub, extensible)
├── task-receiver.ts       # HMAC-verified HTTP task endpoint (port 3100)
└── worker-client.ts       # Client for Worker internal APIs
```

---

## Getting Started

### Prerequisites

- Node.js 20 (see `.nvmrc`)
- pnpm 10.6.2
- Cloudflare account with D1 + R2 + Workers enabled
- (Optional) Discord bot token for bot integration

### Install

```bash
pnpm install
```

### Development

Start worker + portal together:

```bash
pnpm dev
```

Or run services in separate terminals:

```bash
# Cloudflare Worker API (http://127.0.0.1:8787)
pnpm dev:worker

# React portal (Vite proxies API to :8787)
pnpm dev:portal

# Combined worker + portal (same as pnpm dev)
pnpm dev:all

# Bot runtime (optional, port 3100)
pnpm dev:bot
```

### Build

```bash
# Build portal SPA
pnpm build

# Dry-run Worker deployment
pnpm build:worker

# TypeCheck everything
pnpm typecheck
```

### Database

```bash
# Generate Drizzle migrations from schema changes
pnpm db:generate

# Open Drizzle Studio (visual DB editor)
pnpm db:studio
```

### Local Wrangler D1 Mock SQL

```bash
# Rebuild local D1 database (drop local file + apply migrations)
pnpm db:mock:rebuild

# Apply migrations only (keep existing local data)
pnpm db:mock:init

# Show local table list
pnpm db:mock:status

# Show applied migration history
pnpm db:mock:migrations
```

Local persistence path is `apps/worker/.wrangler/state/v3/d1`.

---

## Environment Variables

### Worker (`apps/worker/wrangler.jsonc`)

| Variable | Description |
|---|---|
| `PORTAL_ORIGIN` | Allowed CORS origin for the portal |
| `BOT_SHARED_SECRET` | HMAC shared secret for Worker ↔ Bot Runtime |

### Portal (`apps/portal/.env.local`)

| Variable | Default | Description |
|---|---|---|
| `VITE_WORKER_API_ORIGIN` | `http://127.0.0.1:8787` | Vite dev proxy target for `/api/*` and `/ws` |

### Bot Runtime

| Variable | Default | Description |
|---|---|---|
| `WORKER_API_BASE_URL` | `http://127.0.0.1:8787` | Worker API base URL |
| `BOT_SHARED_SECRET` | `dev-secret` | HMAC shared secret |
| `BOT_RUNTIME_PORT` | `3100` | HTTP task receiver port |
| `DISCORD_BOT_TOKEN` | — | Discord bot token (enables Discord) |
| `DISCORD_CLIENT_ID` | — | Discord application client ID |
| `DISCORD_GUILD_ID` | — | Target Discord server ID |
| `BOT_ENABLE_WECHAT` | `false` | Enable WeChat adapter |

---

## API Overview

All endpoints are under `/api/`. Internal bot endpoints are under `/internal/bot/` (HMAC-authenticated, not publicly accessible).

| Route group | Description |
|---|---|
| `/api/auth` | Login, register (invite-only), session, password/username change, Discord link |
| `/api/users` | Member roster, profile CRUD, media uploads |
| `/api/events` | Event CRUD, join/leave, recurrence instances |
| `/api/announcements` | Announcement CRUD, publish scheduling |
| `/api/guild-war` | War history, team composition, member stats |
| `/api/wiki` | Category hierarchy, article CRUD |
| `/api/gallery` | Media upload and listing |
| `/api/admin` | User management, invite links, audit log, bot settings |
| `/ws` | WebSocket upgrade (Durable Object) |
| `/api/health` | Health check |

### Auth & Roles

- Session-based auth via HTTP-only cookies
- 3 roles: `admin` > `moderator` > `member`
- No open registration — admin generates invite links (default 7-day expiry, configurable max uses)

### Rate Limits

| Endpoint type | Limit |
|---|---|
| Auth (login/register) | 5 req/min |
| Mutations | 80 req/min |
| Media uploads | 20 req/min |

---

## Scheduled Jobs

| Job | Schedule | Description |
|---|---|---|
| Event instance generation | Daily 00:00 UTC | Generate recurring event instances for next 8 weeks |
| Announcement publish/expiry | Every 15 min | Flip scheduled → published; auto-archive expired |
| Bot reminder dispatch | Every 15 min | Compute upcoming reminders, dispatch to bot runtime |
| Audit archive + cleanup | Daily 02:00 UTC | Export 90+ day rows to R2, delete from D1 |
| Media orphan cleanup | Daily 03:00 UTC | Delete unreferenced R2 files older than 7 days |

---

## Bot Integration

The Worker is the source of truth. The Bot Runtime is the execution layer for platform delivery only.

- Worker dispatches bot tasks via authenticated internal API (`/internal/bot/`)
- Bot Runtime receives tasks, delivers to Discord/WeChat, reports status back to Worker
- All Worker ↔ Bot Runtime calls use HMAC-SHA256 + timestamp (replay window: 5 min)
- Bot delivery is idempotent via `idempotency_key`

---

## Security

- HttpOnly cookie sessions — no tokens stored client-side
- RBAC enforced on both client and server
- DOMPurify with strict allowlist for all user rich text/HTML
- HMAC-SHA256 with timing-safe comparison for bot endpoints
- Generic login errors ("Invalid credentials") — username existence never revealed
- Media validated for type and size client-side and server-side
- Bot platform secrets never leave the bot runtime environment

---

## License

[MIT](./LICENSE)
