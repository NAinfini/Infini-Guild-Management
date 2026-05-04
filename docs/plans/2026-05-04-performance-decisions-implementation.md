# Performance Decisions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply the approved performance and simplification decisions across schema, backend services, APIs, frontend controls, and large-file structure.

**Architecture:** Keep behavior explicit at the backend boundary, use indexed database structures for scalable filters, and route frontend data access through services/hooks. Use TDD for behavioral changes and update the consolidated v1 migration directly.

**Tech Stack:** Cloudflare Workers, Hono, Drizzle/D1 SQLite, React 19, TanStack Query, Mantine, Vitest, pnpm.

---

### Task 1: Lock Approved Decisions In Planning Docs

**Files:**
- Modify: `.trellis/tasks/05-03-codebase-simplification-audit/performance-decisions.md`

**Steps:**
1. Replace tomorrow-decision bullets with approved outcomes.
2. Keep unresolved implementation risks as follow-up notes only.

### Task 2: Event Auto-Archive Toggle

**Files:**
- Modify: `apps/worker/db/schema/events.ts`
- Modify: `apps/worker/db/migrations/0000_core_schema.sql`
- Modify: `apps/shared/schemas/event.ts`
- Modify: `apps/worker/services/EventService.ts`
- Modify: `apps/worker/crons/event-auto-archive.ts`
- Modify: portal event form/template components and controller hooks.
- Test: existing event service/cron tests plus focused additions.

**Steps:**
1. Write failing tests showing events archive once only when `auto_archive` is enabled.
2. Add `auto_archive` column/default to events and payload schemas.
3. Thread `auto_archive` through create/update/template flows.
4. Add event editor/template toggle.
5. Run focused tests.

### Task 3: Indexed Member Class Filtering

**Files:**
- Modify: `apps/worker/db/schema/members.ts`
- Modify: `apps/worker/db/schema/index.ts`
- Modify: `apps/worker/db/migrations/0000_core_schema.sql`
- Modify: `apps/worker/db/seed.ts`
- Modify: `apps/worker/services/UserService.ts`

**Steps:**
1. Write failing test showing class filter uses normalized lookup path.
2. Add `member_profile_classes(user_id, class)` with indexes.
3. Sync rows whenever profile classes change.
4. Replace `json_each(member_profiles.classes)` filter with indexed subquery.
5. Run focused tests.

### Task 4: Guild War Batch Move

**Files:**
- Modify: `apps/shared/schemas/guild-war.ts`
- Modify: `apps/worker/routes/guild-war.ts`
- Modify: `apps/worker/services/GuildWarService.ts`
- Modify: `apps/portal/api/mutations/guild-war.ts`
- Modify: `apps/portal/services/GuildWarService.ts`
- Modify: guild-war drag/page hooks.

**Steps:**
1. Write failing service/API test for `/api/guild-war/move` accepting `moves: []`.
2. Preserve the same endpoint and make single move a one-item batch internally.
3. Update frontend mutation to always pass a list.
4. Replace looped move calls with one batch call.
5. Check nearby endpoints for low-risk batch opportunities and document any deferred items.

### Task 5: SQL Efficiency Endpoints And Permission Cache

**Files:**
- Modify: admin/dashboard route/service files as needed.
- Modify: `apps/worker/services/auth.ts`.
- Modify: frontend query hooks/pages using roster rows only for counts.

**Steps:**
1. Add lightweight stats endpoints where row lists are only used for counts.
2. Cache non-admin permission sets in-memory with a short TTL for reads.
3. Keep dangerous operations protected by backend `requirePermission()` verification.
4. Clear/bypass permission cache after role/permission mutation paths.

### Task 6: Large File Splits

**Files:**
- Split only high-value sections from `GuildWarPage`, `WarHistoryTab`, `GuildWarAnalyticsTab`, and `AdminApiTestEngine`.

**Steps:**
1. Extract pure helpers/components without changing behavior.
2. Keep imports through services/hooks.
3. Run typecheck/lint/tests after each file split.

### Task 7: Final Verification

**Commands:**
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

**Steps:**
1. Run all verification.
2. Update decision document with implemented items and remaining follow-ups.
3. Report exact verification output and residual warnings.
