# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Full-stack guild management portal with 4 apps (shared, worker, portal, bot-runtime)
- **Auth** — Session-based login, invite-only registration, password/username management, Discord account linking
- **Member Roster** — Profiles with classes, power, bio, media (images/audio/video), availability grid
- **Events** — CRUD with recurrence rules, capacity, sign-up locking, participant tracking
- **Announcements** — TipTap rich text editor, draft/scheduled/published/archived lifecycle, pinning
- **Guild War** — War history, team composition (drag & drop), per-member stats (kills/damage/healing/credits), war templates
- **Wiki** — Hierarchical categories, TipTap articles with version history
- **Gallery** — R2-backed media uploads with captions
- **Admin Console** — User/role management, invite link system, audit log (90-day D1 + R2 archive), bot settings
- **Quick Search** — Client-side Cmd+K / Ctrl+K across cached members, events, announcements, wiki, war history
- **Bot Integration** — Discord slash commands, event notifications, reaction-to-join; WeChat room messaging (extensible)
- **Realtime** — WebSocket push via Durable Objects for events and guild war pages
- **Scheduled Jobs** — Event instance generation, announcement publish/expiry, bot reminders, audit archival, media orphan cleanup
- **i18n** — English and Chinese translations (i18next + react-i18next)
- **RBAC** — Three-tier role system (admin > moderator > member) enforced on both client and server
- **Service layer** — 11 portal services + 16 worker services (AuthService, EventService, GuildWarService, AdminService, UserService, AnnouncementService, WikiService, GalleryService, InternalBotService, etc.)
- **ESLint boundary enforcement** — blocks direct API imports from feature components, Dev-Kit internal paths
- **Zustand stores** — auth, preferences, notifications, guildWar analytics
- **Data hooks** — useEventsData, useGuildWarData, useProfileData, useAdminData (TanStack Query wrappers)
- **50+ feature components** extracted from monolithic pages across 7 domains
- **16 test files** — service unit tests, integration tests, contract tests, utility tests
- **Security headers middleware** — CSP, HSTS, X-Content-Type-Options
- **Comprehensive database seed** — 19 users, 14 events, 4 wars, full RBAC test data

### Changed
- Shared components (AvailabilityGridEditor, InfiniTable, MediaGallery, TipTapEditor) moved to Infini Dev Kit
- Media conversion utilities moved to Infini Dev Kit
- GuildWarPage state: 32 useState → 6 useState + Zustand store
- Zod schema validation: 91 checks across all worker routes

### Removed
- Legacy AIVectorMemory configuration (CLAUDE.md, .claude/hooks/, .mcp.json)
- Old planning/audit docs consolidated into docs/Planning/
- Redundant shared components (now in Dev-Kit)

### Technical
- Cloudflare Workers + Hono for serverless API
- Cloudflare D1 (SQLite) + Drizzle ORM for database
- Cloudflare R2 for object storage
- Cloudflare Durable Objects for WebSocket realtime
- React 19 + TanStack Router + TanStack Query for frontend
- Mantine 7 + Infini Dev Kit for design system
- Zustand for client state management
- react-hook-form + Zod for form validation (shared between portal and worker)
- TipTap 2 for rich text editing
- ECharts for data visualization
- @dnd-kit for drag and drop
- Discord.js 14 + Wechaty for bot adapters
- pnpm 10.6.2 workspace monorepo

### Database
- Modular Drizzle schema with 10 domain files and domain header comments
- 25 tables with enum constraints, cascade deletes, and composite indexes
- Audit log with automatic R2 archival after 90 days
- Session cleanup via cascade delete on user removal
