<div align="center">

# Infini Guild Management Portal

**A self-hosted guild portal for members, events, wars, knowledge, media, storage, and staff operations.**

The React portal and Hono API share TypeScript contracts and run on either Cloudflare Workers or a single-process Node.js VPS.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2-61dafb?logo=react)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare)](https://workers.cloudflare.com/)

[English](./README.md) | [中文](./README.zh.md)

[Setup guide](./SETUP.md) · [Product boundaries](./PRODUCT.md) · [Contributing](./CONTRIBUTING.md) · [Security policy](./SECURITY.md)

</div>

---

## Overview

Infini Guild Management keeps routine guild work in one bilingual, responsive portal instead of spreading it across spreadsheets, chat pins, media folders, and one-off utilities. Both supported backends serve the SPA and API from one origin; choose Cloudflare or VPS for a deployment, never both over the same data.

## User-facing capabilities

| Area | Current capability |
| --- | --- |
| Dashboard and roster | Public dashboard summaries; searchable member cards; classes, badges, stats, availability, profiles, images, video links, avatars, and optional profile audio |
| Accounts and profiles | Invite registration, cookie sessions, username/password changes, profile editing, absences, media management, and profile-title styling |
| Events | Six fixed event types, recurring templates, attachments, capacity and class quotas, signups, participant management, polls, raffles, and automatic archival |
| Announcements | Rich-text drafts with pending inline media, scheduled publishing, pinning, archive, and permanent-delete workflows |
| Guild war | Active-war teams and pool, member moves and role tags, conclusion, history, batch editing, export, and analytics |
| Wiki and gallery | Categorized rich-text articles with revisions and restore; gallery images, external videos, captions, and moderation |
| Storage | Authenticated inventory structures, categories, items, images, quantities, and transaction history |
| Tools and settings | Public settings and a Tools page with the dice roller |
| Administration | Members, invites, roles and permissions, audit archives/logs, error and service status, Site Config, classes, class tags, badges, and maintenance actions |
| Discovery and updates | Command search plus authenticated WebSocket update hints through the selected runtime's notification hub |

### Page access

Guest-readable pages are `/`, `/events`, `/roster`, `/announcements`, `/guild-war`, `/gallery`, `/wiki`, `/settings`, and `/tools`. Login and invite registration use `/login` and `/register`. `/profile`, `/storage`, `/storage/manage`, and `/admin` require a session, with privileged actions checked again by the API.

## Configuration boundaries

Admin → Site Config and its API contract cover the site name and logo, feature flags, media policy, storage policy, and absence policy. The current module switches are exactly:

```text
announcements, events, guildWar, gallery, wiki, tools, storage
```

Guild-war analytics settings use their separate admin endpoint.

Rules that affect persisted event and guild-war data remain source-owned contracts:

- Event types are exactly `weekly_mission`, `guild_war`, `social`, `poll`, `raffle`, and `other`.
- Guild-war results are exactly `win`, `loss`, and `draw`.
- KDA is `(kills + assists) / max(deaths, 1)` and is not rounded before consumers format it.
- Team and member stat definitions have one source-owned `name`; they do not carry localized `labels` or a `precision` setting.

Admin and Site Config cannot edit these rules. D1 contains no runtime game-rule columns or tables. Changing a persisted contract requires coordinated code and data migration work.

## Architecture and stack

```text
apps/
├── cloudflare/  Workers entrypoint and D1/R2/Durable Object adapters
├── vps/         Single-process Node.js runtime with SQLite and filesystem blobs
├── shared/      Zod schemas, shared types, limits, and source-owned contracts
└── portal/      React SPA with TanStack Router, TanStack Query, Mantine, and Zustand
packages/
├── application/         Runtime-neutral composition
├── kernel/              Context, errors, authorization, and ports
├── persistence-sqlite/  Shared Drizzle schema and core SQLite migration
├── server/              Domain services
└── transport-http/      Shared Hono routes
```

| Layer | Current stack |
| --- | --- |
| Frontend | React 19.2, Vite 8.2, Mantine 9.5, TanStack Router/Query, Zustand 5, and plain CSS with custom properties; Tailwind is not used |
| Language and validation | TypeScript 6 and Zod 4 shared across portal and both backends |
| Content and charts | TipTap 3 and ECharts 6 |
| Cloudflare backend | Hono, D1, one `BLOBS` R2 bucket, Cron Triggers, and a notification Durable Object |
| VPS backend | Hono on Node.js, one local SQLite file, one filesystem blob root, and in-process scheduling/WebSockets |

The single physical blob namespace (`BLOBS` on Cloudflare or the configured VPS blob root) stores both persisted content media and audit archive data. Audit batches use canonical `audit/YYYY/MM/<archiveId>.ndjson` objects; their authoritative size, digest, range, and lifecycle metadata lives in the shared SQLite `audit_archives` table. There is no second archive store.

Persisted images use mandatory WebP `full` and `view` variants; profile audio uses Ogg/Opus. The selected backend verifies bytes, dimensions, and required variants before attachment. SVG and GIF are not accepted as images. See [Media Architecture](./docs/media-architecture.md) for the canonical persistence contract.

Media bytes are staged before a domain mutation. The owning parent, business children, media links, and audit row are then committed in one SQLite transaction; a failed transaction leaves only staged assets for bounded garbage collection. Parent deletion and its audit row are also atomic, while shared SQLite lifecycle triggers remove links and schedule unreferenced assets for expiry. Blob keys derive only from the opaque media ID plus the fixed `full`/`view` variant name, never from a domain ID, filename, or upload path.

## API surface

All HTTP APIs are under `/api/`; authentication uses HTTP-only session cookies.

| Prefix | Capability |
| --- | --- |
| `/api/health`, `/api/site-config` | Health and public site metadata/logo |
| `/api/auth` | Login, logout, invite verification/registration, session, and username checks |
| `/api/dashboard`, `/api/search` | Dashboard summaries and portal search |
| `/api/users` | Roster, profiles, stats, absences, credentials, and profile media |
| `/api/events` | Events, recurring templates, attachments, signups, polls, raffles, and participants |
| `/api/announcements` | Announcement content, images, publishing, archive, and deletion |
| `/api/guild-war` | Active war state, teams, history, member stats, export, and analytics |
| `/api/wiki`, `/api/gallery` | Wiki categories/articles/revisions/media and gallery images/videos |
| `/api/media` | Database-authorized `view`/`full` delivery for canonical blob variants |
| `/api/storage` | Storage structures, items, images, quantities, and transactions |
| `/api/classes`, `/api/class-tags`, `/api/badges` | Runtime catalogs and badge assignments |
| `/api/admin`, `/api/admin/maintenance` | Users, invites, roles, Site Config, analytics settings, audit/error/status data, system tests, and maintenance |
| `/ws` | Authenticated WebSocket endpoint backed by a Durable Object or the VPS in-process hub |

Mutations require origin and `X-Requested-With` checks. Both backends apply separate rate limits for authentication, reads, writes, uploads, and credential changes.

## Scheduled maintenance

| Schedule | Current jobs |
| --- | --- |
| Daily at 00:00 UTC | Audit archive and error-log cleanup |
| Every 15 minutes | Event instance generation, raffle draws, session cleanup, scheduled announcement publishing, event auto-archive, and expired unlinked-media cleanup |

Cloudflare uses Cron Triggers; the VPS runtime schedules the same jobs in its single Node.js process. Media cleanup selects only expired, unlinked database assets and deletes the exact recorded blob keys; it never guesses ownership from paths or scans blob storage as an authorization source.

## Setup and deployment

[SETUP.md](./SETUP.md) is the source of truth for choosing Cloudflare or VPS, local development, the shared core schema, first-site-owner bootstrap, private legacy credential migration, production secrets, backup/restore, updates, and troubleshooting. Use [SETUP.zh.md](./SETUP.zh.md) for Chinese.

The sole checked-in pre-release baseline is `0000_core.sql`, and its manifest contains only that entry. Approved schema changes fold into it until the first release; later changes ship as immutable incremental migrations. A deployment that already applied the abandoned pre-release `0000`–`0002` chain must be rebuilt or explicitly rebaselined before its next deployment; there is no runtime compatibility path for that history. The setup guide states the full policy, including how to run on the Workers free plan and what to raise after upgrading.

## Security

Server-side permission checks are authoritative. Sessions use HTTP-only cookies; rich text is sanitized; security headers include CSP, frame denial, and `nosniff`. `IG_INVITE_TOKEN_SECRET` and `IG_AUDIT_DOWNLOAD_SECRET` must each contain at least 32 random bytes and stay in Cloudflare secret storage or the private VPS environment file.

Report vulnerabilities privately according to [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
