# Changelog

[Documentation home](../README.md) · [中文版本](./CHANGELOG.zh.md)

This file records notable released behavior. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-05

### Fixed

- Gallery image uploads register every image in an active system-test run so shared cleanup removes the run's gallery entries and media without touching ordinary content. Batch audit identifiers and their validation cover the full upload limit; the frozen core schema is unchanged.

### Added

- Complete bilingual guild operations for members, profiles, events and recurring templates, announcements, guild wars, Wiki, Gallery, storage, tools, notifications and permission-gated administration.
- One runtime-neutral application deployed through either Cloudflare Workers with D1/R2/Durable Objects or one Node.js VPS process with SQLite/filesystem/WebSockets.
- Optional Google, Discord and KOOK account linking, optional verified contact email, invitation registration, administrator temporary-credential recovery and member account-security controls.
- Three route-owned panoramic workspace scene groups plus dedicated responsive light/dark artwork for public, access and status pages.
- Theme-following and manual light/dark modes, a persistent Reduce motion preference, English/Chinese switching and responsive task parity.

### Changed

- Authentication forms use persistent labels, localized validation, theme-aware autofill and compact password guidance; profile password fields share the same readable layout. Access and maintenance cards have consistent responsive spacing, and `/401` offers a clear sign-in action. The standalone maintenance response selects English or Chinese from `Accept-Language`.
- Authentication, registration, recovery, verification and status surfaces use the configured guild identity. Uploaded site-logo media takes precedence over the deployment default.
- Portal startup loads translations, public Site Config and the current session concurrently. Localized retry states replace raw startup failures.
- Member and administration directories use bounded server pagination, filtering and stable ordering. Selectors resolve selected IDs without loading whole directories.
- Announcements and Wiki use clearer content hierarchy and shared management actions. Gallery preserves source composition and keeps titles outside the image.
- Dashboard prioritizes current guild activity and limits personal signup data to signed-in members.
- Work pages share centred reading, standard and wide content limits with consistent section spacing and responsive reflow.
- Documentation now contains only maintained product, design, security, deployment, migration, contribution, asset and release references, each available in English and Chinese. The READMEs include bilingual, theme-aware Archify diagrams and live repository badges. Obsolete reviews and development-only design notes are no longer maintained guidance; private drafts are excluded from the public history.

### Security

- New passwords require 8–128 characters, an uppercase letter, a lowercase letter and a non-space special character. There is no common-password collection.
- PBKDF2-SHA256 retains a configurable 10,000-iteration default and minimum for the Cloudflare Worker CPU budget, with fixed-budget credential failures and upgrade-on-login for lower-cost hashes.
- Source-wide and source/login-pair limits run before account lookup or PBKDF2. Credential failures remain generic; no persistent account cooldown or administrator unlock path exists.
- Mutations require allowed origins and `X-Requested-With`; protected identity and business mutations write audit records in their database transactions.
- Media validation, opaque IDs, database-owned lifecycle, bounded garbage collection and permission-checked streaming behave the same on R2 and the VPS filesystem.
- Session transitions reject stale browser responses, coordinate credential changes across tabs and refresh authorization after relevant account or role changes.

### Database and operations

- CI uses explicit Node/pnpm, compiler, lint, test and browser versions with frozen installation and bilingual reproduction instructions. Release checks build the Portal once, preserve both runtime typechecks, and reject lint warnings. Superseded ESLint configs and duplicated or style-only assertions are removed; behavioral, accessibility, security and runtime-parity coverage remains.
- Storage withdrawal E2E searches for the recipient before selection, so cases remain valid when earlier tests move that member beyond the directory's first page.
- New installations use a single frozen `0000_core.sql` containing the complete 1.0.0 schema and canonical seeds, with one matching manifest entry.
- Existing databases use a backup- and maintenance-gated application-ledger adoption; business data and Wrangler migration history are not replayed or rewritten by the runtime.
- Node SQLite and local workerd D1 share the same migration bytes and schema/index/trigger parity checks.
- `release:check` validates boundaries, configuration, secrets, types, lint, unit tests and both runtime builds locally. CI splits the complete Chromium E2E suite across three isolated runners; no job deploys or changes production resources. Full worker access logs remain in failure artifacts rather than flooding the console.
- Browser E2E runs the compiled Cloudflare Worker directly in Miniflare/workerd, removing the Wrangler development proxy connection failure while retaining two isolated slots, all assertions and cleanup verification. Unexpected runtime recovery fails the test run.
- VPS production builds retain the required WebSocket runtime dependency and are checked by compiled-artifact startup and heartbeat coverage.

## [0.1.0] - 2026-08-30

Initial tagged source snapshot. It established the bilingual Portal, shared backend contracts, two runtime adapters, invite/session authentication, permission-owned administration, guild content workflows, media lifecycle and the consolidated core schema. `1.0.0` supersedes this snapshot. Development history is grouped into major milestones; the original migration chain remains available at [`archive/pre-core-20260830`](https://github.com/NAinfini/Infini-Guild-Management/tree/archive/pre-core-20260830).
