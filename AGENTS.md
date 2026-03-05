# AGENTS.md — Machine-Readable Guild Management Reference

> **This file is for AI coding agents.** Read this first before modifying any code in this repository.

## Repository Identity

- **Name:** Infini Guild Management
- **Type:** Full-stack guild management portal (private)
- **Framework:** Cloudflare Workers (Hono) + React 19 SPA + Node.js bot runtime
- **Database:** Cloudflare D1 (SQLite) via Drizzle ORM
- **Object Storage:** Cloudflare R2
- **Realtime:** Cloudflare Durable Objects (WebSocket)
- **Package manager:** pnpm 10.6.2
- **Node.js:** 20 (see `.nvmrc`)

## Relationship to Infini Dev Kit

This app consumes `@infini-dev-kit/*` packages from the sibling `../Infini-Dev-Kit/` directory via TypeScript path aliases in `tsconfig.json` and Vite aliases in `apps/portal/vite.config.ts`.

**The Dev Kit is the source of truth for themes, components, hooks, and utilities.** This repo is a consumer — it should never duplicate or override Dev Kit logic.

## Commands

```
pnpm dev            # Start worker + portal concurrently
pnpm dev:worker     # Cloudflare Worker only (localhost:8787)
pnpm dev:portal     # React portal only (Vite)
pnpm dev:bot        # Bot runtime (port 3100)
pnpm build          # Build portal SPA
pnpm build:worker   # Dry-run worker deployment
pnpm typecheck      # Full TypeScript check
pnpm db:generate    # Generate Drizzle migrations from schema changes
pnpm db:studio      # Drizzle visual editor
pnpm db:mock:rebuild  # Reset local D1 (drop + apply migrations)
pnpm db:mock:init     # Apply migrations only (keep data)
pnpm db:mock:status   # Show local table list
```

## Monorepo Structure

```
apps/
├── shared/           # Zod schemas, types, constants, API registry
├── worker/           # Cloudflare Worker — Hono API + D1 + R2 + Durable Objects
├── portal/           # React SPA — TanStack Router + Mantine (Infini-Dev-Kit)
└── bot-runtime/      # Node.js long-running service — Discord.js + Wechaty
```

## File Index

### Root

| File | Purpose |
|------|---------|
| `package.json` | Root workspace config, all scripts |
| `tsconfig.json` | Root tsconfig with path aliases (`@infini-dev-kit/*`, `@portal`, `@guild/shared`) |
| `wrangler.jsonc` | Cloudflare Worker config (D1, R2, Durable Objects, crons) |
| `.nvmrc` | Node.js version pin |
| `.npmrc` | pnpm config |
| `README.md` | Human-readable documentation |
| `AGENTS.md` | This file |

### apps/shared/ — Shared Contract

| Path | Purpose |
|------|---------|
| `schemas/auth.ts` | `loginSchema`, `registerSchema` |
| `schemas/user.ts` | `userSchema`, `memberProfileSchema`, `updateProfileSchema`, `changePasswordSchema` |
| `schemas/event.ts` | `eventSchema`, `createEventSchema`, `updateEventSchema`, `eventParticipantSchema` |
| `schemas/announcement.ts` | `announcementSchema`, `createAnnouncementSchema`, `updateAnnouncementSchema` |
| `schemas/guild-war.ts` | `warHistorySchema`, `warTemplateSchema`, `warTeamSchema`, `saveTeamsPayloadSchema`, `updateMemberStatsSchema` |
| `schemas/wiki.ts` | `wikiCategorySchema`, `wikiArticleSchema`, `createWikiArticleSchema`, `updateWikiArticleSchema` |
| `schemas/gallery.ts` | `galleryItemSchema`, `createGalleryItemSchema` |
| `schemas/admin.ts` | `inviteLinkSchema`, `auditLogSchema`, `batchRoleChangeSchema`, `botSettingsSchema` |
| `schemas/bot.ts` | `botTaskSchema`, `botSettingsSchema` |
| `types/` | TypeScript types inferred from Zod schemas |
| `constants/roles.ts` | Role definitions (admin, moderator, member) |
| `constants/classes.ts` | Character class constants |
| `constants/event-types.ts` | Event type categories |
| `constants/media.ts` | File size limits, image quotas |
| `constants/errors.ts` | Error codes and HTTP status mappings |
| `api/` | Endpoint registry |
| `index.ts` | Barrel export |

### apps/worker/ — Backend (Cloudflare Worker)

| Path | Purpose |
|------|---------|
| `index.ts` | Main entry — bindings, middleware stack, route mounting, cron dispatcher |
| **routes/** | |
| `routes/auth.ts` | Login, logout, register, session check, username availability |
| `routes/users.ts` | Member listing, profile CRUD, media uploads, Discord linking, password/username changes |
| `routes/events.ts` | Event CRUD, join/leave, recurrence, series handling |
| `routes/announcements.ts` | Announcement CRUD, publish scheduling, pinning |
| `routes/guild-war.ts` | War history, templates, team composition, member stats, bot dispatch |
| `routes/wiki.ts` | Wiki categories, articles, versioning, search |
| `routes/gallery.ts` | Gallery CRUD, filtering |
| `routes/admin.ts` | Invite links, role management, audit logs, bot settings |
| `routes/internal-bot.ts` | HMAC-authenticated bot task endpoints |
| **middleware/** | |
| `middleware/session.ts` | `sessionMiddleware`, `requireSessionMiddleware` |
| `middleware/rbac.ts` | `requireRole()` — role-based access control |
| `middleware/rate-limit.ts` | `createRateLimitMiddleware()` — token bucket |
| `middleware/hmac.ts` | `hmacMiddleware` — HMAC-SHA256 for bot requests |
| `middleware/etag.ts` | `etagMiddleware` — HTTP caching |
| `middleware/error-handler.ts` | `handleAppError()` — global error handler |
| **services/** | |
| `services/auth.ts` | PBKDF2 password hashing, session management (30-day TTL) |
| `services/bot-dispatch.ts` | Queue bot tasks to Discord/WeChat, retry failed tasks |
| `services/push.ts` | WebSocket push notifications via Durable Objects |
| `services/media.ts` | R2 media storage with content-type normalization |
| `services/audit.ts` | Audit trail logging |
| `services/search.ts` | Cmd+K search index |
| **crons/** | |
| `crons/event-instance-gen.ts` | Generate recurring event instances 56 days ahead (daily 00:00 UTC) |
| `crons/announcement-publish.ts` | Publish scheduled announcements (every 15 min) |
| `crons/bot-reminder.ts` | Send event reminders 15 min before start (every 15 min) |
| `crons/audit-archive.ts` | Archive audit logs >90 days to R2 (daily 02:00 UTC) |
| `crons/media-orphan-cleanup.ts` | Delete R2 media for deleted users (daily 03:00 UTC) |
| **db/** | |
| `db/schema/` | Modular Drizzle schema (see Database section below) |
| `db/schema/index.ts` | Barrel export for all schema modules |
| `db/migrations/` | D1 SQL migrations |
| `db/versions/` | Migration version snapshots |
| `db/seed.ts` | Mock data seeder |
| **durable-objects/** | |
| `durable-objects/WebSocketDO.ts` | WebSocket Durable Object for realtime push |

### apps/portal/ — Frontend (React SPA)

| Path | Purpose |
|------|---------|
| `router.tsx` | All route definitions (TanStack Router, lazy code splitting) |
| `vite.config.ts` | Vite config with `@infini-dev-kit/*` and `@portal` aliases |
| **api/** | |
| `api/client.ts` | HTTP client with ETag caching |
| `api/queries/` | TanStack Query fetchers (per-domain) |
| `api/mutations/` | TanStack Query mutations (per-domain) |
| **components/** | |
| `components/pages/LoginPage.tsx` | Auth — login form |
| `components/pages/RegisterPage.tsx` | Auth — registration via invite code |
| `components/pages/DashboardPage.tsx` | Home overview (upcoming events, signups, notifications, war stats) |
| `components/pages/EventsPage.tsx` | Event listing and management |
| `components/pages/AnnouncementsPage.tsx` | Announcement feed |
| `components/pages/GuildWarPage.tsx` | War history, templates, team composition |
| `components/pages/RosterPage.tsx` | Member roster with profiles |
| `components/pages/GalleryPage.tsx` | Media gallery |
| `components/pages/WikiPage.tsx` | Wiki articles and categories |
| `components/pages/MyProfilePage.tsx` | User profile editor (protected) |
| `components/pages/AdminPage.tsx` | Admin console (protected) |
| `components/pages/ToolsPage.tsx` | Utility tools |
| `components/pages/SettingsPage.tsx` | App settings |
| `components/layout/AppShell.tsx` | Main layout wrapper |
| `components/layout/BottomNav.tsx` | Mobile bottom navigation |
| `components/layout/CmdKSearch.tsx` | Global search modal (Ctrl+K / Cmd+K) |
| `components/shared/` | Reusable components (MemberCard, TipTapEditor, AvailabilityGridEditor, etc.) |
| `components/feature/` | Feature-specific components (admin, announcements, events, gallery, guild-war, profile, wiki) |
| `components/dashboard/` | Dashboard card components (ActiveMembersCard, LastWarCard, MySignupsCard, UpcomingEventsCard, NotificationsCard) |
| **stores/** | |
| `stores/auth.ts` | `useAuthStore` — Zustand session state |
| `stores/preferences.ts` | `usePreferencesStore` — theme, locale preferences |
| `stores/notifications.ts` | `useNotificationsStore` — push notification queue |
| **hooks/** | |
| `hooks/useBeforeUnloadPrompt.ts` | Warn on unsaved changes |
| `hooks/useExternalView.ts` | External view mode detection |
| `hooks/useMediaUpload.ts` | File upload with validation |
| `hooks/useNotificationSync.ts` | WebSocket notification sync |
| `hooks/data/useEventsData.ts` | Events data fetching |
| `hooks/data/useGuildWarData.ts` | Guild war data fetching |
| `hooks/data/useProfileData.ts` | Profile data fetching |
| `hooks/data/useAdminData.ts` | Admin data fetching |
| **i18n/** | |
| `i18n/en/` | English translations |
| `i18n/zh/` | Chinese translations |

### apps/bot-runtime/ — Bot Runtime (Node.js)

| Path | Purpose |
|------|---------|
| `index.ts` | Entry point — boots Discord + WeChat adapters |
| `task-receiver.ts` | HMAC-verified HTTP endpoint (port 3100) |
| `worker-client.ts` | Client for Worker internal APIs |
| `discord/` | Discord.js adapter, commands, formatters, reactions |
| `wechat/` | Wechaty adapter (stub, extensible) |

### doc/Planning/ — Feature Specs

| File | Feature |
|------|---------|
| `Global.md` | Project-wide rules, architecture, stack, DB constraints |
| `dashboard.md` | Dashboard layout and cards |
| `auth.md` | Authentication flow |
| `events.md` | Event management |
| `announcements.md` | Announcement lifecycle |
| `guild-war.md` | War history and team composition |
| `roster.md` | Member roster |
| `wiki.md` | Wiki system |
| `gallery.md` | Media gallery |
| `my-profile.md` | User profile |
| `admin-console.md` | Admin panel |
| `bot-integrations.md` | Discord/WeChat bots |
| `settings.md` | User settings |
| `tools.md` | Utility tools |

## Database Schema

Drizzle schema is modular — each domain is a separate file in `apps/worker/db/schema/`:

| File | Tables | Domain |
|------|--------|--------|
| `shared.ts` | — | `nowUtc` SQL helper |
| `auth.ts` | `users`, `user_auth_password`, `invite_links`, `discord_link_codes`, `sessions` | Auth & Identity |
| `members.ts` | `member_profiles` | Member Profiles |
| `events.ts` | `events`, `event_participants` | Events & Signups |
| `announcements.ts` | `announcements` | Announcements |
| `guild-war.ts` | `war_history`, `war_teams`, `war_team_members`, `war_pool_members`, `war_templates` | Guild War |
| `wiki.ts` | `wiki_categories`, `wiki_articles` | Wiki |
| `gallery.ts` | `gallery_items` | Gallery |
| `audit.ts` | `audit_log` | Audit Log |
| `bot.ts` | `bot_delivery_log`, `bot_discord_event_messages` | Bot Integration |

SQL migrations are in `apps/worker/db/migrations/`. The core schema is `0000_core_schema.sql`.

**Schema modification workflow:**
1. Edit the Drizzle schema file(s) in `db/schema/`
2. Run `pnpm db:generate` to generate migration SQL
3. Run `pnpm db:mock:rebuild` to test locally
4. Keep Drizzle schema and SQL migration in sync

## Import Path Patterns

### From Infini Dev Kit

```ts
// Provider & context
import { KitApp, ThemeToolbar, useBridge, useThemeSnapshot } from "@infini-dev-kit/frontend/provider";

// Components
import { InfiniCard, InfiniButton } from "@infini-dev-kit/frontend/components/infini";
import { GlowCard, DepthButton } from "@infini-dev-kit/frontend/components";

// Theme
import type { ThemeId } from "@infini-dev-kit/frontend/theme/theme-specs";
import { loadThemeFonts } from "@infini-dev-kit/frontend/theme/mantine/font-loader";

// API client
import { createApiClient, ApiClientError } from "@infini-dev-kit/api-client";

// Utils
import { createRequestId } from "@infini-dev-kit/utils";
```

### Internal aliases

```ts
// From portal code
import { useAuthStore } from "@portal/stores/auth";
import { DashboardPage } from "@portal/components/pages/DashboardPage";

// From worker code
import { users, sessions } from "./db/schema";

// From shared
import { loginSchema } from "@guild/shared/schemas/auth";
import type { User } from "@guild/shared/types";
import { ROLE_LEVELS } from "@guild/shared/constants/roles";
```

## Worker Bindings

Defined in `wrangler.jsonc`:

| Binding | Type | Purpose |
|---------|------|---------|
| `DB` | D1 Database | SQLite database |
| `MEDIA` | R2 Bucket | Media file storage |
| `WS` | Durable Object | WebSocket connections |
| `PORTAL_ORIGIN` | Variable | CORS allowed origin |
| `BOT_SHARED_SECRET` | Secret | HMAC shared secret for Worker ↔ Bot Runtime |
| `BOT_RUNTIME_URL` | Variable | Bot runtime HTTP endpoint |

## API Routes

| Route group | Auth | Description |
|-------------|------|-------------|
| `/api/auth` | Public | Login, register (invite-only), session check |
| `/api/users` | Session | Member roster, profile CRUD, media uploads |
| `/api/events` | Session | Event CRUD, join/leave, recurrence |
| `/api/announcements` | Session | Announcement CRUD, publish scheduling |
| `/api/guild-war` | Session | War history, team composition, stats |
| `/api/wiki` | Session | Categories, articles, versioning |
| `/api/gallery` | Session | Media upload and listing |
| `/api/admin` | Admin | User management, invite links, audit log |
| `/internal/bot` | HMAC | Bot task endpoints (not publicly accessible) |
| `/ws` | Session | WebSocket upgrade (Durable Object) |
| `/api/health` | Public | Health check |

## How to Modify This App

### Add a new API endpoint

1. Add Zod schema in `apps/shared/schemas/<domain>.ts`
2. Add TypeScript type in `apps/shared/types/`
3. Add route handler in `apps/worker/routes/<domain>.ts`
4. Add service logic in `apps/worker/services/` if business rules are complex
5. Add TanStack Query fetcher in `apps/portal/api/queries/`
6. Add mutation hook in `apps/portal/api/mutations/` if write operation
7. Run `pnpm typecheck`

### Add a new database table

1. Add or edit Drizzle schema in `apps/worker/db/schema/<domain>.ts`
2. Export from `apps/worker/db/schema/index.ts` if new file
3. Run `pnpm db:generate` to create migration SQL
4. Verify the generated SQL in `apps/worker/db/migrations/`
5. Run `pnpm db:mock:rebuild` to test locally
6. Add corresponding Zod schema in `apps/shared/schemas/`

### Add a new portal page

1. Create `apps/portal/components/pages/YourPage.tsx`
2. Add route in `apps/portal/router.tsx`
3. Add navigation entry in `AppShell.tsx` sidebar
4. Add i18n keys in `apps/portal/i18n/en/` and `zh/`
5. If data-driven, add query hooks in `apps/portal/hooks/data/`

### Add a new scheduled job

1. Create `apps/worker/crons/<job-name>.ts`
2. Register in the cron dispatcher in `apps/worker/index.ts`
3. Add cron expression to `wrangler.jsonc` → `triggers.crons`
4. Document the schedule in this file

## Path Alias Configuration

Aliases must be kept in sync between:

| File | Scope |
|------|-------|
| `tsconfig.json` → `compilerOptions.paths` | TypeScript resolution |
| `apps/portal/vite.config.ts` → `resolve.alias` | Vite runtime resolution |
| `wrangler.jsonc` → `alias` | Worker bundler resolution |

## Agent Workflow Rules

### Track every file you touch

- Before making changes, list all files you intend to modify.
- After making changes, verify the app still compiles (`pnpm typecheck`).
- If you modify imports from `@infini-dev-kit/*`, verify the path exists in the Dev Kit repo.
- When adding a new table, update both the Drizzle schema AND the SQL migration.
- When modifying Zod schemas, check that worker routes and portal queries using those schemas still compile.

### Verify before declaring done

- Run `pnpm typecheck` — must succeed.
- If you modified a route, test with `pnpm dev:worker` and verify the endpoint responds.
- If you modified a schema, verify Drizzle ↔ SQL migration parity.
- If you changed portal components, verify under at least two themes.

### Keep files in sync

| When you change... | Also update... |
|---------------------|---------------|
| Drizzle schema | SQL migration (`pnpm db:generate`), shared Zod schemas if types changed |
| A Zod schema | Worker routes using it, portal mutations using it |
| A route handler | Shared API registry, portal query/mutation hooks |
| Portal router | AppShell sidebar nav, i18n translation keys |
| Worker bindings | `wrangler.jsonc`, `apps/worker/index.ts` type definition |
| Cron jobs | `wrangler.jsonc` triggers, `apps/worker/index.ts` dispatcher |
| Path aliases | `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc` |
| Schema domain headers | This AGENTS.md file |

### No orphaned files

- Every schema module must be exported from `apps/worker/db/schema/index.ts`.
- Every route must be mounted in `apps/worker/index.ts`.
- Every page must have a route in `apps/portal/router.tsx`.
- Every Zod schema must be exported from `apps/shared/index.ts`.
- Delete files completely when removing — do not leave dead imports or commented-out references.
