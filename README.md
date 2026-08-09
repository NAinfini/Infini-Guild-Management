<div align="center">

# Infini Guild Management Portal

**A self-hosted guild portal for members, events, wars, knowledge, media, storage, and staff operations.**

The React portal and Hono API share TypeScript contracts and are deployed together on Cloudflare Workers.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2-61dafb?logo=react)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare)](https://workers.cloudflare.com/)

[English](./README.md) | [中文](./README.zh.md)

[Setup guide](./SETUP.md) · [Product boundaries](./PRODUCT.md) · [Contributing](./CONTRIBUTING.md) · [Security policy](./SECURITY.md)

</div>

---

## Overview

Infini Guild Management keeps routine guild work in one bilingual, responsive portal instead of spreading it across spreadsheets, chat pins, media folders, and one-off utilities. The Worker serves both the SPA and the API, so normal deployments use one origin and one public URL.

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
| Discovery and updates | Command search plus authenticated WebSocket update hints through a Durable Object |

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
├── shared/   Zod schemas, shared types, limits, and source-owned domain contracts
├── worker/   Hono API on Cloudflare Workers with D1, R2, and Durable Objects
└── portal/   React SPA with TanStack Router, TanStack Query, Mantine, and Zustand
```

| Layer | Current stack |
| --- | --- |
| Frontend | React 19.2, Vite 8.2, Mantine 9.5, TanStack Router/Query, Zustand 5, and plain CSS with custom properties; Tailwind is not used |
| Language and validation | TypeScript 6 and Zod 4 shared across portal and Worker |
| Content and charts | TipTap 3 and ECharts 6 |
| Backend and data | Hono, Drizzle ORM, Cloudflare Workers, and D1 |
| Objects and realtime | One R2 `MEDIA` bucket and a WebSocket Durable Object |

The single `MEDIA` bucket stores both persisted content media and audit archive data. Each audit month is committed by an authoritative `audit-archive/.../manifest.json` in that same bucket; there is no second archive bucket.

Persisted images use mandatory WebP `full` and `view` variants; profile audio uses Ogg/Opus. The Worker verifies bytes, dimensions, and required variants before attachment. SVG and GIF are not accepted as images. See [Media Architecture](./docs/media-architecture.md) for the canonical D1/R2 contract.

Media-backed domain creation writes the owning parent and business children before attaching media; attachment failure compensates by deleting that parent. Deletion resolves non-media relationships and then deletes the parent directly, allowing D1 lifecycle triggers to remove links and schedule expiry. R2 object keys derive only from the opaque media ID plus the fixed `full`/`view` variant name, never from a domain ID, filename, or upload path.

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
| `/api/media` | D1-authorized `view`/`full` delivery for canonical R2 media variants |
| `/api/storage` | Storage structures, items, images, quantities, and transactions |
| `/api/classes`, `/api/class-tags`, `/api/badges` | Runtime catalogs and badge assignments |
| `/api/admin`, `/api/admin/maintenance` | Users, invites, roles, Site Config, analytics settings, audit/error/status data, system tests, and maintenance |
| `/ws` | Authenticated WebSocket endpoint backed by the Durable Object |

Mutations require origin and `X-Requested-With` checks. The Worker also applies separate rate limits for authentication, reads, writes, uploads, and credential changes.

## Scheduled maintenance

| Schedule | Current jobs |
| --- | --- |
| Daily at 00:00 UTC | Audit archive and error-log cleanup |
| Every 15 minutes | Event instance generation, raffle draws, session cleanup, scheduled announcement publishing, event auto-archive, and expired unlinked-media cleanup |

Media cleanup runs in scheduled maintenance. It selects only expired, unlinked D1 assets and deletes the exact R2 keys recorded for their variants; it never guesses ownership from paths or scans the bucket as an authorization source. The admin API test console is always available and gated by admin permissions: every fixture a test run creates is registered in a server-side run registry and deleted by exact ID when the run ends.

## Setup and deployment

[SETUP.md](./SETUP.md) is the single source of truth for prerequisites, local development, first production initialization, Cloudflare resources, migrations, deployment, updates, and troubleshooting. Use [SETUP.zh.md](./SETUP.zh.md) for the matching Chinese guide.

The core migration is the fresh pre-release schema baseline. Approved schema changes fold into it until the first release; later changes ship as immutable incremental migrations. The setup guide states the full policy, including how to run on the Workers free plan and what to raise after upgrading.

## Security

Server-side permission checks are authoritative. Sessions use HTTP-only cookies; rich text is sanitized; security headers include CSP, HSTS, frame denial, and `nosniff`. `SIGNING_SECRET` protects both audit archive download tokens and Worker-to-Durable-Object push publication.

Report vulnerabilities privately according to [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
