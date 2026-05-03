# Infini Guild Management Portal

A private, full-stack guild management system for the Infini game community. Handles members, events, announcements, guild wars, wiki, and gallery.

---

## Architecture

Monorepo with three apps sharing a single TypeScript contract:

```
apps/
├── shared/        # Zod schemas, types, constants, API registry
├── worker/        # Cloudflare Worker — Hono API + D1 + R2 + Durable Objects
└── portal/        # React SPA — TanStack Router + Mantine
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 6, TanStack Router, TanStack Query |
| Design System | Mantine 7 + Tailwind CSS |
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
| IDs | nanoid |
| Package Manager | pnpm 10.6.2 |
| Runtime | Node.js 20 |

---

## Features

- **Member Roster** — Profiles with classes (9 types), power (造诣), bio, media (images/audio/video), availability grid
- **Events** — CRUD with recurrence rules, capacity, sign-up locking, participant tracking
- **Announcements** — TipTap rich text, draft/scheduled/published/archived lifecycle, pinning
- **Guild War** — War history, team composition (drag & drop), per-member stats (kills/damage/healing/credits/etc.)
- **Wiki** — Hierarchical categories, TipTap articles
- **Gallery** — R2-backed media uploads with captions
- **Admin Console** — User/role management, invite link system, audit log (90-day D1 hot + 1-year R2 archive)
- **Quick Search** — Client-side `Cmd+K` / `Ctrl+K` across cached members, events, announcements, wiki, war history
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
│   ├── schema/            # Modular Drizzle schema by bounded context (9 files, 21 tables)
│   ├── seed.ts
│   └── migrations/        # Wrangler D1 migrations + semantic version registry
├── routes/                # API route handlers (8 route modules)
├── services/              # Business logic (15 services — auth, audit, helpers, EventService, etc.)
├── middleware/            # CORS, rate-limit, session, RBAC, etag, security-headers
├── crons/                 # Scheduled job handlers (5 jobs)
├── durable-objects/       # WebSocketDO
└── wrangler.jsonc

apps/portal/
├── api/
│   ├── client.ts          # HTTP client with ETag caching
│   ├── queries/           # TanStack Query fetchers
│   └── mutations/         # TanStack Query mutations
├── components/
│   ├── layout/            # AppShell, BottomNav, CmdKSearch, PageLayout, UserProfileDropdown, ViewingAsSelector
│   ├── pages/             # 13 page components
│   ├── shared/            # AppErrorOverlay, EmptyState, FilterToolbar, MemberCard, MemberGrid2x5, ProfileModal
│   ├── feature/           # Feature components across 7 domains (admin, announcements, events, gallery, guild-war, profile, wiki)
│   └── dashboard/         # Dashboard card components
├── services/              # Portal service layer (3 services)
├── stores/                # Zustand stores (auth, preferences, notifications, guildWar)
├── hooks/                 # Custom hooks (data, guild-war, feature-specific)
├── utils/                 # Utility functions (date, copy, permissions, availability, admin)
├── i18n/                  # en/ and zh/ translation files (14 namespaces each)
└── router.tsx             # All route definitions
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10.6.2
- Cloudflare account with D1 + R2 + Workers enabled

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
```

### Build

```bash
# Build portal SPA
pnpm build

# Dry-run Worker deployment
pnpm build:worker

# TypeCheck everything
pnpm typecheck

# Run all tests
pnpm test

# Lint
pnpm lint
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

# Start worker first, then reseed a comprehensive local mock dataset
pnpm dev:worker
pnpm db:mock:seed

# Apply migrations only (keep existing local data)
pnpm db:mock:init

# Show local table list
pnpm db:mock:status

# Show applied migration history
pnpm db:mock:migrations
```

Local persistence path is `apps/worker/.wrangler/state/v3/d1`.

Seeded local QA accounts:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | admin |
| `mod_1` | `moderator123` | moderator |
| `member_01` | `member1234` | member |

The seeded mock dataset covers roster, profile media, announcements (draft/scheduled/published/archived), guild war history, wiki, gallery, invite links (active/expired/revoked), and audit log.

To verify seeded coverage across the main portal flows:

```bash
pnpm smoke:pages
```

---

## Environment Variables

### Worker (`apps/worker/wrangler.jsonc`)

| Variable | Description |
|---|---|
| `PORTAL_ORIGIN` | Allowed CORS origin for the portal |
| `SIGNING_SECRET` | HMAC signing secret for audit archive download tokens |

### Portal (`apps/portal/.env.local`)

| Variable | Default | Description |
|---|---|---|
| `VITE_WORKER_API_ORIGIN` | `http://127.0.0.1:8787` | Vite dev proxy target for `/api/*` and `/ws` |

---

## API Overview

All endpoints are under `/api/`.

| Route group | Description |
|---|---|
| `/api/auth` | Login, register (invite-only), session, password/username change |
| `/api/users` | Member roster, profile CRUD, media uploads |
| `/api/events` | Event CRUD, join/leave, recurrence instances |
| `/api/announcements` | Announcement CRUD, publish scheduling |
| `/api/guild-war` | War history, team composition, member stats |
| `/api/wiki` | Category hierarchy, article CRUD |
| `/api/gallery` | Media upload and listing |
| `/api/admin` | User management, invite links, audit log |
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
| Event auto-archive | Every 15 min | Auto-archive past events |
| Announcement publish/expiry | Every 15 min | Flip scheduled → published; auto-archive expired |
| Audit archive + cleanup | Daily 02:00 UTC | Export 90+ day rows to R2, delete from D1 |
| Media orphan cleanup | Daily 03:00 UTC | Delete unreferenced R2 files older than 7 days |

---

## Security

- HttpOnly cookie sessions — no tokens stored client-side
- RBAC enforced on both client and server
- CSRF protection via custom `X-Requested-With` header on all mutations
- Password max length enforced (128 chars) to prevent PBKDF2 DoS
- Cache API rate limiting across Worker isolates within the same colo
- DOMPurify with strict allowlist for all user rich text/HTML
- Generic login errors ("Invalid credentials") — username existence never revealed
- Media validated for type and size client-side and server-side
- Security headers: HSTS, X-Frame-Options DENY, CSP, nosniff, Referrer-Policy, Permissions-Policy

---

## License

[MIT](./LICENSE)
