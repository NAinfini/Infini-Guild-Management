<div align="center">

# Infini Guild Management Portal

**A self-hosted portal for running a guild: members, events, wars, knowledge, media, storage, and administration.**

The React portal and Hono API share TypeScript contracts. Deploy them to Cloudflare Workers or a single-process Node.js VPS.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2-61dafb?logo=react)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare)](https://workers.cloudflare.com/)

[English](./README.md) | [中文](./README.zh.md)

[Setup guide](./SETUP.md) · [Product boundaries](./PRODUCT.md) · [Authentication roadmap](./AUTHENTICATION.md) · [Contributing](./CONTRIBUTING.md) · [Security policy](./SECURITY.md)

</div>

---

## Overview

Infini Guild Management brings day-to-day guild work into one bilingual, responsive portal instead of scattering it across spreadsheets, pinned chat messages, media folders, and one-off tools. Both backends serve the SPA and API from the same origin. A deployment uses either Cloudflare or VPS, never both against the same data.

## User-facing capabilities

| Area | Current capability |
| --- | --- |
| Dashboard and roster | Public dashboard summaries and searchable member cards with classes, badges, stats, availability, profiles, images, video links, avatars, and optional profile audio |
| Accounts and profiles | Invite-based registration with private login names and public display names, cookie sessions, credential management, optional verified email, optional linked Google/Discord/KOOK sign-in when configured by the site owner, profile editing, absences, media management, and profile-title styling |
| Events | Six fixed event types, recurring templates, attachments, capacity and class quotas, signups, participant management, polls, raffles, and automatic archiving |
| Announcements | Rich-text drafts with pending inline media, scheduled publishing, pinning, archiving, and permanent deletion |
| Guild war | Active-war teams and pool, member moves, role tags, conclusion, history, batch editing, export, and analytics |
| Wiki and gallery | Categorized rich-text articles with revisions and restore, plus gallery images, external videos, captions, and moderation |
| Storage | Authenticated inventory structures, categories, items, images, quantities, and transaction history |
| Tools and settings | Public settings and a dice roller on the Tools page |
| Administration | Members, invites, roles and permissions, audit archives and logs, error and service status, Site Config, classes, class tags, and badges |
| Discovery and updates | Command search and authenticated WebSocket update hints through the selected runtime's notification hub |

### Page access

Guests can read `/`, `/events`, `/roster`, `/announcements`, `/guild-war`, `/gallery`, `/wiki`, `/settings`, and `/tools`. Login and invite registration are available at `/login` and `/register`. `/profile`, `/storage`, `/storage/manage`, and `/admin` require a session; the API checks privileged actions again.

## Configuration boundaries

Admin → Site Config and its API contract manage the site name and logo, feature flags, non-secret per-provider OAuth gates, media policy, storage policy, and absence policy. Runtime OAuth credentials and email sender credentials remain deployment secrets; WeChat is reserved but unavailable until its official protocol rules are verified. These are the complete set of module switches:

```text
announcements, events, guildWar, gallery, wiki, tools, storage
```

Guild-war analytics settings use their separate admin endpoint.

Rules that affect persisted event and guild-war data are defined in source:

- Event types are exactly `weekly_mission`, `guild_war`, `social`, `poll`, `raffle`, and `other`.
- Guild-war results are exactly `win`, `loss`, and `draw`.
- KDA is `(kills + assists) / max(deaths, 1)` and is not rounded before consumers format it.
- Team and member stat definitions have one source-owned `name`; they do not carry localized `labels` or a `precision` setting.

Neither Admin nor Site Config can edit these rules. D1 contains no runtime game-rule columns or tables. Changing a persisted contract requires coordinated code and data migrations.

## Architecture and stack

```text
apps/
├── cloudflare/  Workers entrypoint and D1/R2/Durable Object adapters
├── vps/         Single-process Node.js runtime with SQLite and filesystem blobs
├── shared/      Zod schemas, shared types, limits, and source-owned contracts
└── portal/      React SPA with TanStack Router/Query, shadcn/ui, Base UI, and Zustand
packages/
├── application/         Runtime-neutral composition
├── kernel/              Context, errors, authorization, and ports
├── persistence-sqlite/  Shared Drizzle schema and core SQLite migration
├── server/              Domain services
└── transport-http/      Shared Hono routes
```

| Layer | Current stack |
| --- | --- |
| Frontend | React 19.2, Vite 8.2, shadcn/ui compositions on Base UI 1.7, Tailwind CSS 4.3, TanStack Router/Query, Zustand 5, and domain CSS with custom properties |
| Language and validation | TypeScript 6 and Zod 4, shared by the portal and both backends |
| Content and charts | TipTap 3 and ECharts 6 |
| Cloudflare backend | Hono, D1, one `BLOBS` R2 bucket, Cron Triggers, and a notification Durable Object |
| VPS backend | Hono on Node.js, one local SQLite file, one filesystem blob root, and in-process scheduling/WebSockets |

One physical blob namespace (`BLOBS` on Cloudflare or the configured VPS blob root) stores persisted content media and audit archives. Audit batches use canonical `audit/YYYY/MM/<archiveId>.ndjson` objects. The shared SQLite `audit_archives` table is authoritative for their size, digest, range, and lifecycle metadata; there is no second archive store.

Persisted images require WebP `full` and `view` variants; profile audio uses Ogg/Opus. Before attachment, the selected backend verifies the bytes, dimensions, and required variants. SVG and GIF are not accepted as images.

Media bytes are staged before a domain mutation. The owning parent, business children, media links, and audit row then commit in one SQLite transaction. A failed transaction leaves only staged assets for bounded garbage collection. Parent deletion and its audit row are also atomic. Shared SQLite lifecycle triggers remove links and schedule unreferenced assets for expiry. Blob keys use only the opaque media ID and fixed `full`/`view` variant name, never a domain ID, filename, or upload path.

## API surface

All HTTP APIs are under `/api/`; authentication uses HTTP-only session cookies.

| Prefix | Capability |
| --- | --- |
| `/api/health`, `/api/site-config` | Health and public site metadata/logo |
| `/api/auth` | Login, logout, invite verification/registration, session, password-reset completion, configured OAuth, and verified-email flows |
| `/api/dashboard`, `/api/search` | Dashboard summaries and portal search |
| `/api/users` | Roster, profiles, stats, absences, and profile media |
| `/api/events` | Events, recurring templates, attachments, signups, polls, raffles, and participants |
| `/api/announcements` | Announcement content, images, publishing, archive, and deletion |
| `/api/guild-war` | Active war state, teams, history, member stats, export, and analytics |
| `/api/wiki`, `/api/gallery` | Wiki categories/articles/revisions/media and gallery images/videos |
| `/api/media` | Database-authorized `view`/`full` delivery for canonical blob variants |
| `/api/storage` | Storage structures, items, images, quantities, and transactions |
| `/api/classes`, `/api/class-tags`, `/api/badges` | Runtime catalogs and badge assignments |
| `/api/admin` | Users, invites, roles, Site Config, analytics settings, audit/error/status data, and system tests |
| `/ws` | Authenticated WebSocket endpoint backed by a Durable Object or the VPS in-process hub |

Mutations require origin and `X-Requested-With` checks. Both backends rate-limit authentication, reads, writes, uploads, and credential changes separately.

## Scheduled maintenance

| Schedule | Current jobs |
| --- | --- |
| Daily at 00:00 UTC | Audit archive and error-log cleanup |
| Every 15 minutes | Event instance generation, raffle draws, session cleanup, scheduled announcement publishing, event auto-archive, and expired unlinked-media cleanup |

Cloudflare uses Cron Triggers. The VPS runtime schedules the same jobs in its single Node.js process. Media cleanup selects only expired, unlinked database assets and deletes their exact recorded blob keys. It never infers ownership from paths or treats a blob-storage scan as an authorization source.

## Setup and deployment

[SETUP.md](./SETUP.md) is the authoritative guide to choosing Cloudflare or VPS, local development, the shared schema, first-admin bootstrap, production secrets, backup and restore, updates, and troubleshooting. For Chinese, use [SETUP.zh.md](./SETUP.zh.md).

`0000_core.sql` is the released, frozen baseline. The manifest contains the contiguous migration chain through `0006_auth_lifecycle_hardening`; never edit or regenerate the baseline. Every later change must add the next ordinal migration and update the manifest checksum. Runtime validation applies the same ordered chain to Cloudflare D1 and VPS SQLite. The setup guide contains the full policy, including running on the Workers free plan and settings to raise after upgrading.

## Security

Server-side permission checks are authoritative. Sessions use HTTP-only cookies, rich text is sanitized, and security headers include CSP, frame denial, and `nosniff`. `IG_INVITE_TOKEN_SECRET` and `IG_AUDIT_DOWNLOAD_SECRET` must each contain at least 32 random bytes and stay in Cloudflare secret storage or the private VPS environment file.

Report vulnerabilities privately according to [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
