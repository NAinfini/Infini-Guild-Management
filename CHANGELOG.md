# Changelog

All notable changes to this project are documented here.

This project follows the structure of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) where release versions are assigned.

## [Unreleased]

### Added

- Full-stack guild management portal with shared, worker, and portal app areas.
- Session-based auth with invite-only registration, login/logout, username checks, and profile credential management.
- Member roster with profiles, classes, stats, bio, media, and availability.
- Event management with recurrence rules, capacity limits, signup locking, polls, and participant tracking.
- Announcement workflow with TipTap rich text editing, draft/scheduled/published/archived states, expiration, and pinning.
- Guild war tools for active team composition, war history, templates, per-member stats, and analytics.
- Wiki with hierarchical categories, rich text articles, and article history support.
- Gallery backed by R2 media storage.
- Admin console for user management, roles, invite links, audit logs, status, and diagnostics.
- Command search with `Cmd+K` / `Ctrl+K` across cached portal content.
- WebSocket push updates through Cloudflare Durable Objects.
- Scheduled maintenance jobs for event instance generation, announcement publishing/expiry, audit archival, and media cleanup.
- English and Chinese localization through i18next.
- RBAC enforced on both client and server, with support for custom roles.
- Service layer across worker domains, including auth, events, guild war, admin, users, announcements, wiki, gallery, media, audit, and game data.
- ESLint boundary rules to keep feature components from importing API modules directly.
- Zustand stores for auth, preferences, notifications, guild war state, and equipment calculator local data.
- TanStack Query data hooks for page-level data orchestration.
- Feature components extracted from large page components across admin, announcements, events, gallery, guild war, profile, and wiki areas.
- Test coverage across worker services, integration routes, contracts, shared schemas, portal components, and utility logic.
- Security headers middleware for CSP, HSTS, `X-Content-Type-Options`, and related headers.
- Local database seed data for users, roles, events, guild war records, and RBAC scenarios.
- Equipment calculator work in progress: shared schemas and calculator code, game data API, admin game-data UI, Tools page launcher, local store, worker search, and translations.
- Beginner-friendly local setup, deployment preflight, production deployment command, and first-administrator bootstrap tooling.
- English and Chinese self-hosting guides plus public-repository security and support templates.

### Changed

- Guild war page state moved from many local `useState` values into a smaller page controller plus Zustand store.
- Worker routes now use shared Zod validation more consistently.
- Admin and tooling surfaces were expanded to support game-data management for the equipment calculator.
- Frontend stack updated to React 19, Mantine 8, Vite 8, Tailwind CSS 4, and current TanStack packages.
- TipTap upgraded to v3 for rich text editing.
- Admin Site Config now exposes the independent equipment calculator feature switch.
- Admin-configured media file limits are capped below the request-wide upload ceiling to prevent impossible settings.

### Removed

- Legacy AIVectorMemory configuration and related Claude hook files.
- Older planning and audit notes were consolidated under `docs/` and `.trellis/` task tracking.

### Technical

- Cloudflare Workers and Hono provide the serverless API.
- Cloudflare D1 with Drizzle ORM stores relational data.
- Cloudflare R2 stores uploaded media and audit archives.
- Cloudflare Durable Objects provide WebSocket coordination.
- React, TanStack Router, and TanStack Query power the portal.
- Mantine and Tailwind CSS provide the UI foundation.
- Zod schemas are shared between portal and worker code.
- pnpm 11.17.0 manages the workspace.

### Database

- Modular Drizzle schema files are split by domain.
- Baseline SQL lives in `apps/worker/db/migrations/0000_core_schema.sql` during v1 development.
- Audit logs are retained in D1 before archival to R2.
- Session and domain tables use cascade behavior where appropriate.
