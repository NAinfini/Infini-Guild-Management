<div align="center">

# Infini Guild Management

**A bilingual, self-hosted operations hub for guild communities.**

Bring members, events, wars, announcements, knowledge, media, storage, and administration into one responsive portal.

[![CI](https://github.com/NAinfini/Infini-Guild-Management/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/NAinfini/Infini-Guild-Management/actions/workflows/ci.yml)
[![Release 1.0.0](https://img.shields.io/badge/release-v1.0.0-2ea44f)](https://github.com/NAinfini/Infini-Guild-Management/releases/tag/v1.0.0)
[![GitHub Stars](https://img.shields.io/github/stars/NAinfini/Infini-Guild-Management?style=flat&logo=github&cacheSeconds=300)](https://github.com/NAinfini/Infini-Guild-Management/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

[English](./README.md) · [中文](./docs/README.zh.md)

[Get started](./docs/SETUP.md) · [Product](./docs/PRODUCT.md) · [Security](./docs/SECURITY.md) · [Contributing](./docs/CONTRIBUTING.md) · [1.0.0 changes](./docs/CHANGELOG.md#100---2026-09-05)

</div>

## One home for everyday guild work

Infini Guild Management replaces scattered spreadsheets, pinned messages, media folders, and one-off tools with a single source of truth. Guests can browse public guild content, members can manage their participation and profiles, and staff can coordinate operations through server-enforced permissions and auditable actions.

- **Members and identity** — roster search, profiles, classes, badges, availability, absences, invite registration, account security, and optional linked sign-in.
- **Coordination** — announcements, recurring events, signups and quotas, polls, raffles, active guild-war planning, results, history, and analytics.
- **Knowledge and assets** — revisioned Wiki articles, gallery images and videos, member media, shared storage, quantities, and transaction history.
- **Administration** — dynamic roles and permissions, invitations, catalogs, Site Config, audit archives, errors, service status, and system tests.
- **Inclusive interface** — English and Chinese, desktop and mobile parity, light/dark/system themes, reduced motion, configured guild identity, and route-specific scenery.

See the [product boundaries](./docs/PRODUCT.md) for the complete supported behavior.

## One application, two deployment targets

The Portal, transport, application composition, domain policy, and platform ports form one shared product. Runtime adapters provide infrastructure; business behavior does not branch by deployment.

![Shared application architecture: Portal requests enter HTTP transport, which calls domain services using kernel ports; application composition wires transport and services.](./docs/diagrams/application-en.svg)

Each installation selects exactly one runtime. Cloudflare and VPS are alternatives; they must not operate on the same application data.

![Deployment alternatives: Cloudflare Workers with D1, R2, Durable Objects and Cron, or one Node.js process with SQLite, filesystem blobs, WebSockets and a scheduler.](./docs/diagrams/deployment-en.svg)

Use Cloudflare Workers with D1, R2, and Durable Objects, or run one Node.js process with local SQLite and filesystem blobs. Both serve the SPA and API from the same origin and use the same migration bytes.

## Security baseline

- Authorization is enforced by the server. Portal permission gates only shape the interface.
- Sessions use HTTP-only cookies backed by stored token digests. Mutations require an allowed origin and `X-Requested-With: XMLHttpRequest`.
- New passwords contain 8–128 characters with uppercase, lowercase, and special characters. Numbers are optional, and there is no common-password collection.
- PBKDF2-SHA256 uses a default and minimum cost of **10,000 iterations** to fit the Cloudflare Workers CPU budget. Self-hosters may raise `IG_PBKDF2_ITERATIONS` after benchmarking their runtime.
- Source-wide and source/login-pair throttles run before account lookup or password work. Rich text and uploaded media are validated, and protected mutations write their audit record in the same SQL transaction.

Read [Authentication](./docs/AUTHENTICATION.md) for the full account model and [Security](./docs/SECURITY.md) for private vulnerability reporting.

## Start locally

Use Node.js **26.5.1** and pnpm **11.17.0**, matching CI. Exact dependencies come from `pnpm-lock.yaml`.

```bash
pnpm install --frozen-lockfile

# Cloudflare-compatible local runtime
pnpm dev

# Or the single-process VPS runtime
pnpm dev:vps
```

The [setup and operations guide](./docs/SETUP.md) covers bindings, secrets, first-admin bootstrap, backups, recovery, updates, and production deployment for both targets.

## 1.0.0 schema

Release 1.0.0 ships exactly one frozen application migration and its one-entry manifest:

```text
packages/persistence-sqlite/src/migrations/generated/0000_core.sql
packages/persistence-sqlite/src/migrations/generated/manifest.json
```

Cloudflare D1 and VPS SQLite apply these same bytes. Do not edit or regenerate the released core. Existing databases must follow the verified [D1 upgrade runbook](./docs/PRODUCTION_D1_UPGRADE.md) instead of replaying the core against business tables. A later schema change must add the next contiguous migration and its exact manifest entry.

## Release checks

```bash
pnpm release:check
pnpm exec playwright install chromium
pnpm test:e2e
```

The release gate checks secrets, dependency boundaries, runtime configuration, all three typecheck configurations, zero-warning lint, tests, and both production builds. Browser E2E runs separately in CI. On Linux, install Chromium with `pnpm exec playwright install --with-deps chromium` to include its system libraries. See [Contributing](./docs/CONTRIBUTING.md#reproduce-ci) for the complete toolchain, focused commands and local port settings.

## Documentation

- **Operate:** [Setup](./docs/SETUP.md) · [Production D1 upgrade](./docs/PRODUCTION_D1_UPGRADE.md)
- **Understand:** [Product](./docs/PRODUCT.md) · [Design](./docs/DESIGN.md) · [Visual themes](./docs/VISUAL_PRESETS.md) · [Asset credits](./docs/THIRD_PARTY_ASSETS.md)
- **Protect:** [Authentication](./docs/AUTHENTICATION.md) · [Security policy](./docs/SECURITY.md)
- **Participate:** [Contributing](./docs/CONTRIBUTING.md) · [Changelog](./docs/CHANGELOG.md)

Contributions are welcome through the [contribution guide](./docs/CONTRIBUTING.md). If the project helps your guild, starring the repository makes it easier for others to find.

## License

[MIT](./LICENSE)
