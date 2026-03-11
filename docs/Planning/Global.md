# Infini Guild Management Portal — Global Rules

> This file is the single source of truth for AI agents working on this project.
> Read this before making any changes. Do not deviate from these rules.

## Project Identity

- **Product:** Infini Guild Management Portal — a game-agnostic guild/organization management portal (classes and vocabulary are configurable per instance)
- **Repo structure:** Monorepo (portal + worker + shared contract)
- **Branch conventions:** `main` is the primary branch
- **Design system:** Infini-Dev-Kit (custom design system wrapping Ant Design)

## Architecture & Platform

### Stack (non-negotiable)

| Layer | Technology |
|-------|-----------|
| Frontend | React SPA (Vite) + Infini-Dev-Kit (Ant Design underneath) |
| Design system | `@infini-dev-kit/frontend` (theme, motion, components) |
| Utilities | `@infini-dev-kit/utils` (color, animation helpers) |
| API client | `@infini-dev-kit/backend` (`createApiClient()`) |
| Routing | TanStack Router |
| Server state | TanStack Query (ETag-friendly caching) |
| Forms | react-hook-form + zod |
| Rich text editor | TipTap (announcements + wiki) |
| Drag & drop | dnd-kit |
| Charts | ECharts (via echarts-for-react) |
| i18n | i18next + react-i18next |
| Dates | date-fns |
| Sanitization | DOMPurify |
| Global state | zustand (auth session, local preferences) |
| Backend API | Cloudflare Worker + Hono |
| Bot Runtime | Node long-running service using `@infini-dev-kit/bots-core` + `bots-discord` + `bots-wechat` |
| Database | Cloudflare D1 (SQLite) |
| Object storage | Cloudflare R2 |
| Realtime | Durable Objects (WebSocket push) |
| Validation | zod (shared between portal and worker) |
| IDs | nanoid or ulid |

### Infini-Dev-Kit Integration Rules

- Wrap app root with `<KitApp>` for theme context
- Use `useThemeSnapshot()` for accessing theme palette, typography, foundation, depth, motion
- Use dev-kit motion components (`RevealOnScroll`, `StaggerList`, `MotionButton`, etc.) instead of raw framer-motion
- Use `useThemeTransition()` for theme-aware transition timing
- Use `@infini-dev-kit/utils/color` for contrast checks and readable text color derivation
- Use `@infini-dev-kit/backend/createApiClient()` as the base HTTP client layer
- Theme switching via `useBridge().setTheme()` with optional view transitions
- All themes come from the dev-kit's built-in theme profiles (neu-brutalism, cyberpunk, etc.)
- Components MUST use dev-kit theme tokens — never hardcode colors, spacing, or shadows

### Deployment

- Frontend: Cloudflare Pages (static SPA)
- Backend: Cloudflare Worker (one worker per project instance)
- Bot Runtime: separate long-running Node service for Discord/WeChat platform integration
- Each project instance has its own D1 database and R2 bucket (data isolation via bindings)
- No cross-project reads/writes

### Bot Integration Runtime Rules

- Cloudflare Worker is the source of truth for guild business state and bot configuration
- Bot Runtime is the execution layer for platform delivery and platform event intake
- Worker MUST dispatch bot tasks via authenticated internal APIs; Worker MUST NOT directly call Discord/WeChat SDK clients
- Bot Runtime MUST call Worker internal endpoints for business mutations (`signup`, `leave`, `link`)
- Worker <-> Bot Runtime calls MUST use HMAC signature + timestamp; replay window <= 5 minutes
- Bot delivery MUST be idempotent via unique `idempotency_key`
- Discord react-to-join in v1 uses dev-kit Discord raw escape hatch to handle reaction events

### Member Onboarding (Invite Link System)

- No open registration — Admin generates bulk invite links
- Invite link flow: Admin creates link with admin-defined N uses + default 7-day expiry (can override/clear) → new member clicks link → sets username + password → account created as `member` role
- Invite links stored in D1: `id`, `created_by`, `max_uses`, `used_count`, `expires_at`, `created_at`
- Expired or fully-used links show friendly "Link expired" page
- Admin can view full active invite links + revoke them in Admin Console
- Moderator can view invite usage statistics only (no raw link URL, no copy)

### Global Search (Cmd+K)

- Global search bar accessible via `Cmd+K` / `Ctrl+K` from anywhere
- Searches across: members (username, wechat_name), events (title), announcements (title, body), wiki articles (title, body), war history (war name)
- Results grouped by type with icons
- Keyboard navigation: arrow keys to select, Enter to navigate, Escape to close
- Recent searches stored in localStorage
- Debounced input (300ms) with loading indicator
- Implementation: client-side index built from cached TanStack Query data; no dedicated search API endpoint needed for v1
- **Eager fetch on first open:** On first `Cmd+K` open, fire a lightweight fetch for all searchable entities (members, events, announcements, wiki articles, war history names) to populate the index, then cache for the session. Subsequent opens use cached data.

## Vocabulary (do not drift)

Use these terms consistently in UI, API, DB, code, and documentation:

- Classes: 鸣金虹, 鸣金影, 牵丝玉, 牵丝霖, 破竹风, 破竹尘, 破竹鸢, 裂石威, 裂石钧
- Class color groups:
  - Mingjin (鸣金*): blue
  - Qiansi (牵丝*): green
  - Pozhu (破竹*): purple
  - Lieshi (裂石*): dark red
- Power: 造诣

## Roles & Permissions

3 roles only:  `admin` / `moderator` / `member`.

| Rule | Enforcement |
| Admin can manage Member/Moderator roles | Server-side |
| Admin can grant/revoke Admin, moderator| Server-side |
| All destructive actions require confirmation | Client + Server |
| All role/permission changes are auditable | Server-side |
| Admin-only tools are visually gated AND server-enforced | Both |

### External View

- Same UI as Member, but read-only
- No mutations allowed

## Routing (routes vs tabs)

### Sidebar routes (v1)

- `/` Dashboard
- `/events` Events
- `/announcements` Announcements
- `/roster` Roster
- `/guild-war` Guild War (tabs: Active / History / Analytics)
- `/gallery` Gallery (guild screenshots/clips)
- `/tools` Tools
- `/wiki` Wiki / Tutorials
- `/admin` Admin Console (tabs: Member Management / Invite Links / Audit / Bot Settings / Status-Health) — Admin/Mod only

### Top right avatar hover routes

- `/login` Login
- `/register/:inviteCode` Invite registration (public, no auth)
- `/profile` My Profile
- `/settings` Settings

### Global overlay

- `Cmd+K` / `Ctrl+K` → Global search modal (searches members, events, announcements, wiki, war history)

### Tabs are NOT separate routes

- Guild War tabs: Active / History / Analytics
- Admin Console tabs: Member Management / Invite Links / Audit / Bot Settings / Status-Health
- My Profile tabs (v1): Profile / Availability / Account (3 tabs only; no Progression tab)

## Data Rules

### Timezone

- Store all dates/times in **UTC**
- Render in **local time** for display
- Use locale-aware date/time formatting

### Media

- Images uploaded to R2 MUST be **WebP** (converted client-side before upload)
- Audio uploaded to R2 MUST be **Opus/OGG** (target: 48kbps, 16kHz, mono) and converted client-side before upload
- No fallback to original audio format if browser cannot encode Opus/OGG
- Never use raw user filenames as storage keys
- Media uses **HARD DELETE** only (no soft delete for media)

### Media Quotas

| Area | Images | Audio | Video | Max file size |
|------|--------|-------|-------|----------|
| Member Profile | 10 images | 1 audio | 10 video urls | 5 MB img / 20 MB audio |
| Announcements | 10 images | — | — | 5 MB per image |
| Gallery | 20 images per upload | — | 10 video urls | 10 MB per image |
| Wiki Articles | 10 images per article | — | — | 5 MB per image |

- Images and audio are raw uploads only (no URL support)
- Video is URL-only (no raw video uploads)

### Delete Strategy

| Entity | Delete Type |
|--------|------------|
| Users | Soft delete (`deleted_at` timestamp) |
| Media | Hard delete (immediate CASCADE) |
| Announcements | Soft delete (archived flags) |
| Events | Soft delete (archived flags) |
| Wiki Articles | Soft delete (archived flags) |
| Gallery Items | Hard delete (immediate) |
| Invite Links | Soft revoke (`revoked_at` timestamp) |

### IDs

- Use `nanoid` for all entity IDs (including audit log IDs)
- Never use sequential/auto-increment IDs

### Core Tables (Central Schema)

These tables are referenced across multiple feature docs. This is the single source of truth.

#### `users`

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- nanoid
  username TEXT NOT NULL UNIQUE,    -- 3-50 chars, alphanumeric + underscore
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'moderator', 'member')),
  is_active BOOLEAN DEFAULT TRUE,
  deleted_at TEXT,                  -- soft delete timestamp
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### `member_profiles`

```sql
CREATE TABLE member_profiles (
  id TEXT PRIMARY KEY,              -- nanoid
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  wechat_name TEXT,                 -- WeChat display name (privacy: hidden from External)
  power INTEGER DEFAULT 0,          -- 造诣
  classes TEXT,                     -- JSON array of class names, ordered (first = primary)
  title_html TEXT,                  -- sanitized HTML title (strict allowlist)
  bio TEXT,                         -- plain text biography
  -- Media references (R2 keys stored as JSON arrays)
  images TEXT,                      -- JSON array of R2 keys, max 10
  audio_key TEXT,                   -- single R2 key for audio file (nullable)
  video_urls TEXT,                  -- JSON array of video URLs, max 10
  -- Availability
  availability TEXT,                -- JSON: weekly time blocks in UTC
  vacation_start TEXT,              -- ISO date (nullable)
  vacation_end TEXT,                -- ISO date (nullable)
  -- Discord integration
  discord_id TEXT UNIQUE,           -- Discord user ID snowflake (nullable)
  discord_reminder_opt_out BOOLEAN DEFAULT FALSE,
  -- Admin notes (not visible to members/external)
  notes TEXT,
  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### `announcements`

```sql
CREATE TABLE announcements (
  id TEXT PRIMARY KEY,              -- nanoid
  title TEXT NOT NULL,
  body_json TEXT NOT NULL,          -- TipTap JSON content
  pinned BOOLEAN DEFAULT FALSE,
  pinned_at TEXT,                   -- ISO UTC timestamp (nullable; for pinned ordering)
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'scheduled', 'published', 'archived')),
  publish_at TEXT,                  -- ISO UTC timestamp; nullable (null = immediate publish)
  expires_at TEXT,                  -- ISO UTC timestamp; nullable (null = no auto-expiry)
  archived_at TEXT,                 -- soft delete timestamp
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### `audit_log`

```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,              -- nanoid
  entity_type TEXT NOT NULL,        -- 'event' | 'announcement' | 'user' | 'wiki_article' | 'wiki_category' | 'gallery_item' | 'invite_link' | 'war_history'
  action TEXT NOT NULL,             -- 'create' | 'update' | 'archive' | 'delete' | 'password_reset' | 'register' | 'role_change'
  actor_id TEXT NOT NULL REFERENCES users(id),
  entity_id TEXT NOT NULL,
  diff_title TEXT,                  -- human-readable diff header (e.g., "title_html changed")
  detail_text TEXT,                 -- detailed change description (never raw JSON only)
  created_at TEXT NOT NULL          -- ISO UTC timestamp
);

CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX idx_audit_log_entity_type ON audit_log(entity_type);
CREATE INDEX idx_audit_log_actor_id ON audit_log(actor_id);
```

#### `discord_link_codes`

```sql
CREATE TABLE discord_link_codes (
  id TEXT PRIMARY KEY,              -- nanoid
  user_id TEXT NOT NULL REFERENCES users(id),
  discord_id TEXT NOT NULL,
  code TEXT NOT NULL,               -- 6-digit code
  expires_at TEXT NOT NULL,         -- ISO UTC timestamp
  used BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL
);
```

#### `bot_delivery_log`

```sql
CREATE TABLE bot_delivery_log (
  id TEXT PRIMARY KEY,              -- nanoid
  idempotency_key TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK(platform IN ('discord', 'wechat')),
  task_type TEXT NOT NULL CHECK(task_type IN ('event_notify', 'team_comp', 'reminder', 'war_result')),
  event_id TEXT REFERENCES events(id),
  target_id TEXT NOT NULL,          -- channel_id / room_id / user_id
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT,             -- ISO UTC timestamp (nullable)
  created_at TEXT NOT NULL,
  sent_at TEXT,                     -- ISO UTC timestamp (nullable)
  message_id TEXT                   -- platform message id (nullable)
);

CREATE INDEX idx_bot_delivery_status_next_attempt
ON bot_delivery_log(status, next_attempt_at);
```

#### `bot_discord_event_messages`

```sql
CREATE TABLE bot_discord_event_messages (
  id TEXT PRIMARY KEY,              -- nanoid
  event_id TEXT NOT NULL REFERENCES events(id),
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, channel_id)
);
```

#### `war_history` / `war_teams` / `war_team_members` / `war_pool_members`

```sql
CREATE TABLE war_history (
  id TEXT PRIMARY KEY,              -- nanoid
  event_id TEXT REFERENCES events(id),  -- link to guild_war event (nullable for manually created history)
  war_name TEXT NOT NULL,
  result TEXT CHECK(result IN ('win', 'loss', 'draw')),  -- nullable until filled
  -- Own side stats
  own_kills INTEGER,
  own_towers INTEGER,
  own_base_hp INTEGER,
  own_credits INTEGER,
  own_distance INTEGER,
  -- Enemy side stats
  enemy_kills INTEGER,
  enemy_towers INTEGER,
  enemy_base_hp INTEGER,
  enemy_credits INTEGER,
  enemy_distance INTEGER,
  -- Metadata
  notes TEXT,                       -- admin notes on the war
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE war_teams (
  id TEXT PRIMARY KEY,              -- nanoid
  war_history_id TEXT NOT NULL REFERENCES war_history(id),
  team_name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  notes TEXT,                       -- team-level notes (e.g., "rush left")
  is_locked BOOLEAN DEFAULT FALSE
);

CREATE TABLE war_team_members (
  id TEXT PRIMARY KEY,              -- nanoid
  war_team_id TEXT NOT NULL REFERENCES war_teams(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role_tag TEXT,                    -- 'DPS' | 'Heal' | 'Tank' | 'lead' | custom
  sort_order INTEGER DEFAULT 0,
  -- Individual member stats
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  damage INTEGER,
  healing INTEGER,
  building_damage INTEGER,
  credits INTEGER,
  damage_taken INTEGER,
  note TEXT,                        -- per-member note
  UNIQUE(war_team_id, user_id)
);

CREATE TABLE war_pool_members (
  id TEXT PRIMARY KEY,              -- nanoid
  war_history_id TEXT NOT NULL REFERENCES war_history(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  UNIQUE(war_history_id, user_id)
);

CREATE INDEX idx_war_history_event_id ON war_history(event_id);
CREATE INDEX idx_war_teams_history_id ON war_teams(war_history_id);
CREATE INDEX idx_war_team_members_team_id ON war_team_members(war_team_id);
CREATE INDEX idx_war_pool_members_history_id ON war_pool_members(war_history_id);
```

## Error Handling

### Standard Error Response Shape (always)

```json
{
  "error_code": "string (stable)",
  "message": "string (human readable, safe)",
  "request_id": "string",
  "details": "optional (validation hints, never secrets)"
}
```

### Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_ERROR` | 400 | Field/constraint issues |
| `UNAUTHORIZED` | 401 | Not logged in / invalid session |
| `FORBIDDEN` | 403 | Role/permission denied |
| `NOT_FOUND` | 404 | Entity missing |
| `CONFLICT` | 409 | Optimistic concurrency / capacity reached |
| `RATE_LIMITED` | 429 | Auth or API throttling |
| `SERVER_ERROR` | 500 | Unexpected worker failure |
| `UPSTREAM_ERROR` | 502/503 | D1/R2 unavailable |

### UI Error Behavior

- Validation errors: inline field messages + keep user input
- 401: redirect to `/login` with return-to; show "Session expired"
- 403: show banner "You don't have permission"
- 409: show dialog with server-provided reason + refresh CTA
- Network/offline: show "Connection lost" banner; prevent destructive writes

## Security Rules

- Input sanitization for all user-supplied rich text/HTML (DOMPurify with strict allowlist)
- RBAC enforced on both client AND server
- Upload validation (type/size) before and after upload
- Generic error messages for login ("Invalid credentials") — never reveal if username exists
- Rate limit login by username + IP bucket (Worker-side)
- HttpOnly cookie sessions; client stores no password ever
- Never leak secrets in error responses
- `title_html` allowlist: `span`, `b`, `strong`, `i`, `em`, `u`, `br` tags only
- Style allowlist for `title_html`: `color`, `font-weight`, `font-style`, `text-decoration`
- Bot platform secrets MUST stay in Bot Runtime environment only
- Bot internal endpoints MUST NOT be publicly accessible

## UI/UX Invariants

### Theming

- No component may hardcode colors or spacing — always use Infini-Dev-Kit theme tokens
- `<KitApp>` at root provides theme context via `useThemeSnapshot()`
- Theme switching via `useBridge().setTheme()` with view transitions
- Use dev-kit's built-in theme profiles (neu-brutalism, cyberpunk, etc.)
- Themes stored in `localStorage` (no D1 persistence)
- Support `prefers-reduced-motion` via dev-kit's motion effective modes (off/minimum/reduced/full)
- Support `prefers-color-scheme` for initial theme selection
- Use `@infini-dev-kit/utils/color` for contrast ratio checks and readable text derivation

### Localization

- No hardcoded user-facing strings in components — all text goes through `t(key)`
- Use i18next + react-i18next
- Languages: English + Chinese (expandable)
- Language preference stored in `localStorage`

### Navigation

- Desktop: sidebar (full icons + labels) + top-right profile dropdown
- Tablet: sidebar collapses to icon-only with tooltips
- Mobile: bottom nav (Home / Events / Guild War / Roster / More)
- Admin pages hidden from non-admin users (don't tease locked pages)

### Forms

- All forms use react-hook-form + zod validation
- Explicit Save/Cancel (no auto-save)
- Dirty-state protection: confirm before closing with unsaved changes
- "Unsaved changes" indicator visible when dirty

### Loading & Empty States

- Skeleton loading for all data-fetching views
- Progressive rendering: layout first, hydrate data as it arrives
- Empty states must be friendly and actionable (Admin/Mod CTAs where applicable)
- Optimistic UI for common actions (join/leave, small edits, toggles)

### Copy UX

- Copy outputs are plain text only (no Markdown) — optimized for Discord + WeChat
- Default format: `@wechat_name` (wechat_name, fallback to `username`)
- One-click copy with tooltip + toast feedback

### Responsive Breakpoints

- 360-400px: small phones
- 768px: tablet portrait
- 1024px: tablet landscape
- 1280px+: desktop
- 1440-1920px: large desktop
- Touch targets >= 48x48 on mobile
- Bottom-sheet modals on phones

### Accessibility

- Full keyboard navigation (Tab/Arrow/Enter/Escape)
- Visible focus rings on all interactive elements
- WCAG AA contrast targets
- Screen reader support (labels, headings, aria attributes)
- Alt text required for images
- Never rely on color alone to convey state

## Freshness & Realtime Strategy

### Push (WebSocket via Durable Object)

- Reconnect with exponential backoff (1s -> 10s -> 30s -> 60s, max 60s)
- If push disconnected, enable temporary polling; disable when push resumes
- only pages that require real time update use push like event page, and guild war assignment page

### Push Message Format

```json
{
  "type": "entity_changed",
  "entity_type": "event|war...",
  "entity_id": "string",
  "updated_at": "UTC string",
  "hint": "refresh_events_list|refresh_war_active|..."
}
```

Additional message types:

```json
{
  "type": "member_online",
  "user_id": "string",
  "source": "portal|discord|wechat",
  "online_at": "UTC string"
}
```

```json
{
  "type": "event_reminder",
  "event_id": "string",
  "title": "string",
  "starts_at": "UTC string",
  "platforms": ["discord", "wechat"],
  "generated_at": "UTC string"
}
```

```json
{
  "type": "announcement_published",
  "announcement_id": "string",
  "title": "string",
  "published_at": "UTC string"
}
```

### Module Freshness Targets

| Module | Freshness | Primary | Safety Poll |
|--------|-----------|---------|-------------|
| Events (event sign ups, guidl war assignment)| < 2s | Push | 60-120s while viewing |
| Announcements | 600s | Poll | Focus revalidate |
| Roster | 600s | Poll | Focus revalidate |
| Media Gallery | 600s | Poll | Manual refresh |
| Analytics/History | Immutable | None | staleTime: Infinity |
| Account/Settings | On demand | None | After save/login/logout |

### Polling Guardrails

- Only poll when tab is visible AND user is on that module
- Add jitter (+-10-20%) to avoid synchronized spikes
- Prefer cheap version/seq check before full refetch
- Back off when idle (2 minutes without interaction)

### ETag Strategy

- ETags are per-endpoint, not global
- Entity: `ETag = entity.updated_at`
- Lists: `ETag = hash(query_params + max(updated_at) + count + ids_sample)`
- Mutations must touch parent `updated_at` so list ETags change
- Use TanStack Query + conditional requests (`If-None-Match`)

## Audit Logging

### What to log

- Create/update/delete for: events, teams, wars, announcements, role changes, profile edits, wiki articles, gallery moderation (delete), invite link create/revoke
- Audit archive export actions (raw/csv): actor, month, format, timestamp

### What NOT to log

- Login/logout
- Passive reads / "view" events
- Routine session activity
- Gallery uploads (too noisy)

### Audit Entry Fields

- `entity_type`, `action`, `actor_id`, `entity_id`, `detail_text`, `diff_title`

### Audit Retention

- D1 hot data retention: **90 days**
- Daily archive job MUST export audit rows older than 90 days to R2 before deleting from D1
- R2 archive retention: **1 year**
- Archive objects are read-only
- Admin Console default Audit Log queries D1 hot data only
- Archive query MUST use manifest/index metadata (no full-file scan by default)
- Admin MAY query monthly R2 archive data and download archive files
- Moderator MUST NOT query or download R2 archive data
- Archive month picker default range: latest 12 months
- Signed archive download URL TTL: 15 minutes
- Every download request issues a fresh signed URL (no reuse)
- Export rate limit: max 1 export action per user per minute

### Audit CSV Export Rules

- CSV conversion path: frontend downloads `.ndjson.gz` and converts in-browser
- Conversion runs only when user clicks `Download CSV`
- Conversion execution: main thread (v1)
- Conversion threshold: `<= 50 MB` allow CSV conversion; `> 50 MB` raw download only
- CSV delimiter: comma (`,`)
- CSV encoding: UTF-8 with BOM
- CSV default filename: `guild-audit-YYYY-MM-localtime.csv`
- CSV columns (ops profile): `timestamp_utc`, `timestamp_local`, `actor`, `action`, `entity_type`, `entity_id`, `diff_title`, `detail_text`
- `detail_text` uses full text export
- Sensitive fields MUST follow role-based masking matrix:
  - Admin: actor/entity visible; secrets masked
  - Moderator: actor/entity masked; secrets masked
  - External: export not allowed
- Conversion retry: one automatic retry
- Error messaging MUST be categorized for `decompress_failed`, `parse_failed`, and `encode_failed`

## Scheduled Jobs Registry (Cloudflare Worker Crons)

All cron jobs run as Cloudflare Worker scheduled triggers. Single registry to avoid conflicts.

| Job | Schedule | Source Doc | Description |
|-----|----------|-----------|-------------|
| Event instance generation | Daily, 00:00 UTC | `events.md` | Generate recurring event instances for next 8 weeks |
| Announcement publish/expiry | Every 15 min | `announcements.md` | Flip scheduled announcements to published; auto-archive expired ones |
| Bot reminder dispatch | Every 15 min | `bot-integrations.md` | Compute upcoming reminders and dispatch bot delivery tasks to Bot Runtime |
| Audit archive + cleanup | Daily, 02:00 UTC | `admin-console.md` | Export 90+ day audit rows to R2 archive, update manifest, delete from D1 |
| Media orphan cleanup | Daily, 03:00 UTC | `my-profile.md` | Scan R2 for unreferenced files, delete orphans older than 7 days |

Rules:
- Stagger daily jobs by at least 1 hour to avoid resource contention
- All jobs must be idempotent (safe to re-run)
- Log job start/end + summary stats (items processed, errors)
- No job should run longer than 60 seconds (Worker CPU limit)

## API Client Rules

- Central API client layer for all Cloudflare Worker calls
- Base URL from environment config
- Central endpoint registry (no scattered string URLs)
- Standardized fetch wrapper: auth cookies, ETag/If-None-Match, JSON parsing + zod validation, error mapping, AbortController
- TanStack Query built on top of API client
- Cache keys must be stable and consistent per entity

## Network Resilience

- If a mutation fails due to network: show toast + keep UI state locally
- for creationg, update, deletion each move is a discrete mutation; if fails, snap back + show toast
- Never queue writes offline
- On 401 during submit: preserve form state, redirect to login (return-to), allow re-submit after re-login

## Rate Limiting

- Login: rate limit by username + IP; show "Too many attempts, try again in X seconds"
- API: soft 429 limits for rapid repetitive mutations
- Uploads: file size limits enforced client-side and server-side + burst protection

## Documentation Conventions

### Search Tokens (for grep/search)

- `@INVARIANT:` global rules
- `@ROLE:` External / Member / Moderator / Admin
- `@FEATURE:` feature identifiers
- `@DATA:` D1 tables & relationships
- `@API:` endpoint groups
- `@REALTIME:` push/poll rules
- `@AUDIT:` audit rules
- `@UI:` UI patterns

## External View

**Disabled Content:**
- My Profile (personal)
- Admin Console (admin-only)
- All mutation actions (signup/join/leave/create/edit/delete)

**Allowed Routes (read-only):**
- Always accessible: `/login`, `/register/:inviteCode`, `/settings` (theme/locale only), `/tools`
- Read-only pages: `/` (dashboard), `/events`, `/announcements`, `/roster`, `/guild-war` (History + Analytics only), `/gallery`, `/wiki`
- Blocked routes: `/profile`, `/admin`

**Member Visibility:**
- ✅ Show: username, power, primary class
- ❌ Hide: wechat_name (privacy), contact info, notes


## Notifications

### Storage Strategy

**localStorage-based:**
- `last_seen_announcements_at`: ISO timestamp
- `last_seen_events_at`: ISO timestamp
- `last_seen_members_at`: ISO timestamp

**Lazy Sync:**
- Background sync every 60 seconds

### UI Implementation

**Dashboard Card:**
```
Notifications:
  - 3 new announcements (NEW dot)
  - 2 new events (NEW dot)
  - 1 new member update (NEW dot)

[Mark All as Read]
```

**Per-Feature Behavior:**
- Clicking notification: navigate + mark as read
- "Mark All" button: mark all features as read
- New dot appears when entity updated after last_seen_at
- **No per-category mute in v1** — all notification dots are always visible


---

## Username Change


### Process

1. User submits new username in My Profile
2. Validation:
   - Current password must be correct
   - New username must be unique
   - New username length: 3-50 characters

3. On success:
   - Update username in DB
   - Invalidate ALL sessions for this user
   - Audit log: "Username changed from X to Y"
   - Redirect to login page
   - Show message: "Username changed. Please log in with new username."

4. On failure:
   - Password incorrect → "Current password is incorrect"
   - Username taken → "Username already in use"

### Database Changes

```sql
-- Already exists, no changes needed
-- Just ensure password verification works
```

**Implementation:** 2-3 days

---

## Availability Timezone

**Selected:** UTC Storage + Local Display (No Multi-Timezone Sync)

### Storage

**Database:**
- Store all times in UTC (HH:MM format)
- Example: `14:00` = 14:00 UTC

### Display

**Client-side conversion:**
- Detect user's browser timezone
- Display UTC times in user's local timezone
- Automatic DST handling (JavaScript Date handles this)

**Example:**
```
Stored in DB: 14:00-16:00 (UTC)

User in Shanghai (UTC+8): displays as 22:00-00:00
User in New York (UTC-5): displays as 09:00-11:00
User in Tokyo (UTC+9): displays as 23:00-01:00
```

**Overlap Merging:**
- Automatically merge overlapping blocks
- Example: 08:00-10:00 + 09:00-11:00 = 08:00-11:00

### Availability UI

**Microsoft Teams-style editor:**
- Grid by day (Monday-Sunday)
- Click to add time block
- Drag edges to resize
- Multiple blocks per day allowed
- Clear day button

**Display reminder:**
- "Times are in UTC. Your browser shows local time conversion."

---

### Agent Work Rules

1. Read this file + the relevant feature documentation before making changes
2. Make changes only inside scoped files listed in the task
3. If a new rule is discovered, add it to the correct section
4. Do not expand scope — if unsure, add a `TODO` block instead of inventing behavior
5. Use MUST / SHOULD / MUST NOT for requirements
6. Prefer small bullets over long paragraphs

