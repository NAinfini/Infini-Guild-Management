# Modular Backend Rewrite Plan

## Non-negotiable scope

- `apps/portal/**` is frozen. Its current HTTP, WebSocket, media, cookie, caching, and error behavior is the product contract.
- The new system is fresh-only. There is no legacy runtime schema, compatibility DTO, route alias, dual read, or dual write. The sole import exception is an offline, one-time conversion of existing password hash/salt rows into the new self-contained credential format; it never handles plaintext and fails unless target user IDs already exist.
- Cloudflare and VPS compose the same application modules, SQLite model, migration, object-key contract, and tests.
- The final tree contains one business implementation. The old `apps/worker/**` tree is removed at cutover.
- Commit and push are authorized only after all release gates pass. Remote migration, deployment, and resource deletion remain separate and are not authorized.

## Target tree

```text
apps/
  portal/                  frozen consumer
  shared/                  canonical wire contracts
  cloudflare/              D1, R2, Durable Object, Cron root
  vps/                     Node SQLite, filesystem, WebSocket root
packages/
  kernel/                  errors, request/auth context, true runtime ports
  application/             one explicit service graph and Portal API composition
  server/src/modules/      domain branches
  persistence-sqlite/      Drizzle model, fresh 0000, domain stores
  transport-http/          Hono routes and Portal presenters
```

The domain branches are auth, members, events, guild-war, storage,
announcements, wiki, gallery, media, notifications, site-config, and audit.
Dashboard, search, diagnostics, HTTP, WebSocket, and jobs are composition
leaves rather than additional business domains.

## Performance contract

- This is a zero-based implementation. Old Worker code is evidence for product behavior only and is not wrapped, renamed, or used as the new foundation.
- Session, role, and permission resolution executes once per request and is cached only in that request context.
- List and detail use cases must not issue N+1 queries. Bounded batch reads and SQL projections replace per-row loading.
- Every unbounded collection has a hard maximum and a stable indexed order. Cursor endpoints use keyset pagination; page endpoints retain the frozen Portal wire but have strict limits.
- Multi-row mutations use one bounded atomic batch. D1 network round trips are treated as a performance budget.
- Dashboard and global search are dedicated CQRS projection branches: their services own unified visibility and field trimming, while SQLite uses bounded projection queries and batches instead of six domain-service fan-outs.
- Media and archive bodies are streamed, including byte ranges. Runtime adapters must not buffer complete large objects by default.
- Node SQLite uses one write queue and prepared statements. No speculative worker-thread pool is added without measured blocking.
- Each hot path has a representative `EXPLAIN QUERY PLAN` assertion; indexes follow actual filters and sort tuples rather than guessed future queries.

## Dependency rules

1. Portal imports only `apps/shared` and never imports server internals.
2. Shared contracts and kernel do not import React, Hono, Cloudflare, Node, or Drizzle.
3. Domain code imports kernel, shared contracts, and explicit public APIs only.
4. Persistence imports domain models and implements domain-level stores; there is no per-table or generic repository.
5. Transport maps HTTP to use cases and canonical Portal DTOs. It contains no business authorization.
6. Only the two composition roots select runtime adapters. There is no DI container or runtime platform switch.
7. Authorization comes only from the verified server session. ViewingAs and external projection can only reduce output.

## Runtime ports

- `SqlExecutor`: D1 batch and Node `BEGIN IMMEDIATE` have the same atomic result semantics.
- `BlobStore`: one physical namespace with `media/` and `audit/` prefixes; D1 holds ownership, keys, size, MIME, and SHA-256.
- `NotificationPublisher`: authenticated invalidation hints, never private business payloads.
- `DeferredTasks`: post-commit best-effort work.
- `RateLimiter`: Cloudflare durable implementation and single-process VPS implementation.

Static assets, WebSocket upgrade, and scheduling remain runtime-root concerns.

## Data invariants

- One reviewed `0000_core.sql` is executed by D1 and Node SQLite.
- Drizzle is the typed authoring model; schema parity tests lock the executable SQL to it.
- Permissions remain the Portal's current static IDs. Unknown permissions are rejected.
- Sessions and invitations store token digests, never usable plaintext secrets. PBKDF2-SHA256 defaults to 10,000 iterations for the Cloudflare CPU budget, accepts an explicit 10,000–10,000,000 runtime setting, and never rehashes a stronger credential downward.
- Login failures use a persistent progressive lock. The triggering failure returns the lock deadline immediately; subsequent post-expiry failures increase the duration; an authorized administrator can inspect and atomically reset the prior lock state with audit.
- `site_owner` is the trust-root role above admin. Multiple owners are allowed; peer-owner management requires both `admin.owners.manage` and the concrete operation permission. The final active, non-deleted owner cannot be removed, demoted, disabled, deleted, or stripped of the owner grant.
- Guild war uses one aggregate across active and concluded states; history is a query, not a copied record.
- Storage ledger entries are immutable. Trigger-maintained balances prevent negative stock and remove balance drift.
- Media follows `uploading -> staged -> attached -> deleting`; garbage collection claims rows atomically before deleting exact object keys.
- Audit rows commit with protected mutations. Archive manifests are recorded and verified before hot rows are removed.
- Wiki revisions are immutable, unbounded history addressed through bounded keyset pages. Every mutable article state is snapshotted and restoring any revision creates a new revision.
- The production admin API-test console is an application-owned cross-domain verification and cleanup workflow, not a business domain. Its run, request, artifact, and before-image registries capture exact keys around protected mutations, cleanup is bounded and compare-and-swap guarded, and a run cannot finalize while any artifact remains.
- JSON is limited to TipTap documents and schema-validated diagnostic/audit details.

## Parallel ownership

- Platform foundation: kernel, runtime ports, D1/Node and R2/filesystem adapters.
- Auth/members: identity, sessions, roles, permissions, profiles, classes, tags, badges, absences.
- Events/guild-war: recurrence, polls, raffles, war teams, active/concluded state, analytics.
- Storage: structure, items, immutable ledger, balances, single/batch stock operations.
- Root integration: shared workspace configuration, final schema/migration, content modules, media, audit, site-config, notifications, HTTP composition, runtime cutover.

Agents do not edit shared registries, root manifests, the final migration, or Portal files. The root agent merges those hotspots serially.

## Review gates

Every ownership area is reviewed by a Sol Max agent that did not implement it. A review checks contracts, authorization, data constraints, failure behavior, tests, and forbidden dependencies. Each area receives at most one focused repair pass before integration.

## Test source of truth

- Frozen Portal request/response and WebSocket fixtures.
- Shared Zod contract tests.
- Fresh schema, seed, FK, CHECK, trigger, index, and query-plan tests on D1 and Node SQLite.
- SQL and blob adapter conformance tests.
- Domain policy and real SQLite integration tests.
- Cross-storage failure injection for media and audit.
- Cloudflare and VPS HTTP, static, WebSocket, and job smoke tests.
- Existing Portal tests remain unmodified and run as consumer verification.

Old Worker/shared tests are deleted when their replacement behavior tests pass. Tests of legacy implementation details are not preserved.

## Cutover and stop conditions

The new stack uses an isolated fresh database/object root until every frozen Portal contract passes. Cutover is one repository change: switch scripts/configuration to the new roots and delete old Worker code and tests. There is no half-deployed or dual-written state.

Stop the affected area if it requires a Portal change, runtime-specific business branch, unsafe fallback, unknown ownership rule, non-atomic invariant, or a third repeated validation failure.
