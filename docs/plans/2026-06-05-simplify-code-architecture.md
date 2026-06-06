# Code & Architecture Simplification Plan

> **Status:** COMPLETED (2026-06-05)
> Tasks 3 & 4 skipped — hooks/pages are large but cohesive; splitting would add indirection without reducing complexity.

**Goal:** Reduce complexity across the codebase by consolidating duplicated patterns, splitting oversized files, and moving misplaced types to their proper packages.

**Architecture:** Extract shared service-factory logic in the worker, move portal-only types out of the shared package, consolidate the debounced-search pattern, and deduplicate origin validation and batch methods.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, React, Mantine, Cloudflare Workers

---

## Task 1: Extract service dependency factory (`apps/worker`)

The 13 route files each define their own `getService(c)` factory that manually wires `writeAuditLog`, `publishEntityChanged`, `media`, etc. The boilerplate is identical across routes — only the deps object shape varies per service.

**Files:**
- Create: `apps/worker/routes/service-factory.ts`
- Modify: `apps/worker/routes/gallery.ts`
- Modify: `apps/worker/routes/wiki.ts`
- Modify: `apps/worker/routes/announcements.ts`
- Modify: `apps/worker/routes/events.ts`
- Modify: `apps/worker/routes/guild-war.ts`
- Modify: `apps/worker/routes/users.ts`
- Modify: `apps/worker/routes/badges.ts`
- Modify: `apps/worker/routes/game-data.ts`
- Modify: `apps/worker/routes/admin.ts`
- Modify: `apps/worker/routes/auth.ts`
- Modify: `apps/worker/routes/search.ts`
- Modify: `apps/worker/routes/dashboard.ts`
- Test: Run `npm test` — all 325 existing tests must pass

**Step 1: Read all 13 route factory functions**

Read the `getService` / `get*Service` function in each route file. Catalog which deps each service needs:
- Common: `writeAuditLog(c, input)`, `publishEntityChanged(c, payload)`, `getDb(c)`, `env.MEDIA`
- Auth-specific: `createPasswordHash`, `verifyPassword`, `createSession`, `destroySession`, `deleteUserSessions`, `env.DB` (raw)
- Admin-specific: `writeAuditLogDurable`, `generateId`, `generateInviteCode`, `generateTemporaryPassword`, `env.WS`, `env.SIGNING_SECRET`
- User-specific: `storeProfileImage`, `storeProfileAudio`, `deleteMediaObject`

**Step 2: Create `service-factory.ts`**

```typescript
// apps/worker/routes/service-factory.ts
import type { Context } from "hono";
import type { Bindings } from "../index";
import { writeAuditLog, writeAuditLogDurable } from "../services/audit";
import { publishEntityChanged } from "../services/push";
import { getDb } from "./_shared";

export type CommonDeps = {
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (payload: EntityChangedPayload) => void;
};

export function commonDeps(c: Context): CommonDeps {
  return {
    writeAuditLog: (input) => writeAuditLog(c, input),
    publishEntityChanged: (payload) => publishEntityChanged(c, payload),
  };
}

export function dbAndCommon(c: Context) {
  return { db: getDb(c), ...commonDeps(c) };
}

export function withMedia(c: Context) {
  return { ...dbAndCommon(c), media: (c.env as Bindings).MEDIA };
}
```

Adjust the exact type imports (`AuditLogInput`, `EntityChangedPayload`) to match the existing types used by `writeAuditLog` and `publishEntityChanged`.

**Step 3: Migrate gallery.ts as first route**

Replace the local `getService` function:
```typescript
// Before
function getService(c: Context): GalleryService {
  const env = c.env as Bindings;
  return new GalleryService(getDb(c), {
    media: env.MEDIA,
    writeAuditLog: (input) => writeAuditLog(c, input),
    publishEntityChanged: (payload) => publishEntityChanged(c, payload),
    rawDb: env.DB,
  });
}

// After
import { withMedia } from "./service-factory";
function getService(c: Context): GalleryService {
  return new GalleryService(getDb(c), {
    ...withMedia(c),
    rawDb: (c.env as Bindings).DB,
  });
}
```

Remove now-unused imports of `writeAuditLog` and `publishEntityChanged` from gallery.ts.

**Step 4: Run tests**

Run: `npm test`
Expected: All 325 tests pass

**Step 5: Migrate remaining simple routes**

Apply the same pattern to wiki.ts, announcements.ts, badges.ts, guild-war.ts, game-data.ts, events.ts. Each route replaces its manual deps with `commonDeps(c)`, `dbAndCommon(c)`, or `withMedia(c)` plus any service-specific extras.

**Step 6: Migrate complex routes (admin.ts, auth.ts, users.ts)**

These have service-specific deps (password hashing, session management, etc). Use spread:
```typescript
function getService(c: Context): AdminService {
  const env = c.env as Bindings;
  return new AdminService(getDb(c), {
    ...commonDeps(c),
    writeAuditLogDurable: (input) => writeAuditLogDurable(c, input),
    generateId: () => crypto.randomUUID(),
    // ... remaining service-specific deps unchanged
  });
}
```

**Step 7: Run tests + TypeScript check**

Run: `npm test && npx tsc --noEmit`
Expected: All pass

**Step 8: Commit**

```bash
git add apps/worker/routes/
git commit -m "refactor(worker): extract shared service dependency factory from route files"
```

---

## Task 2: Move `ImageGridEditorItem` from shared to portal

`ImageGridEditorItem` is a frontend-only type (used in 8 portal files, zero worker files) that lives in `apps/shared/types/media.ts`.

**Files:**
- Modify: `apps/shared/types/media.ts` — remove `ImageGridEditorItem`
- Modify: `apps/shared/index.ts` — remove export if present
- Create or modify: `apps/portal/types/media.ts` — add `ImageGridEditorItem`
- Modify: All 8 portal files importing it — update import path

**Step 1: Read the type definition**

Read `apps/shared/types/media.ts` and copy the `ImageGridEditorItem` type.

**Step 2: Move type to portal**

Create `apps/portal/types/media.ts` (or add to an existing portal types file) with the type definition.

**Step 3: Remove from shared**

Delete the type from `apps/shared/types/media.ts`. Remove from `apps/shared/index.ts` if re-exported.

**Step 4: Update imports in portal**

Update all 8 files:
- `apps/portal/components/feature/profile/ProfileProfileTab.tsx`
- `apps/portal/components/shared/ImageGridEditor.tsx`
- `apps/portal/components/feature/events/EventFormModal.tsx`
- `apps/portal/hooks/useEventsMutations.ts`
- `apps/portal/components/feature/admin/AdminMemberMediaTab.tsx`
- `apps/portal/components/pages/EventsPage.tsx`
- `apps/portal/components/feature/admin/useAdminMemberMediaController.ts`
- `apps/portal/services/AttachmentService.ts`

Change: `from "@guild/shared"` → `from "../../types/media"` (adjust relative path per file)

**Step 5: Run tests + TypeScript check**

Run: `npm test && npx tsc --noEmit`
Expected: All pass

**Step 6: Commit**

```bash
git add apps/shared/ apps/portal/
git commit -m "refactor: move ImageGridEditorItem from shared to portal (frontend-only type)"
```

---

## Task 3: Split `useAnnouncementsController` (537 lines)

**Files:**
- Modify: `apps/portal/hooks/useAnnouncementsController.ts`
- Create: `apps/portal/hooks/useAnnouncementsFormController.ts` (form/modal logic)

**Step 1: Read and analyze the hook**

Read the full file. Identify logical sections:
- List/pagination/search state
- Form state and validation (create/edit modal)
- Mutation handlers (create, update, delete, pin, publish)
- Image upload logic

**Step 2: Extract form controller**

Move form-related state and handlers to `useAnnouncementsFormController.ts`. The main hook calls the form hook and merges the results. Keep the public API unchanged — consumers should not need to change their imports.

**Step 3: Run tests**

Run: `npm test`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/portal/hooks/
git commit -m "refactor(portal): split useAnnouncementsController into list + form hooks"
```

---

## Task 4: Split `WikiPage` (530 lines) and `GalleryPage` (459 lines)

These page components mix list view, detail view, form modals, and search into single files.

**Files:**
- Modify: `apps/portal/components/pages/WikiPage.tsx`
- Modify: `apps/portal/components/pages/GalleryPage.tsx`
- Create: `apps/portal/hooks/useWikiPageController.ts`
- Create: `apps/portal/hooks/useGalleryPageController.ts`

**Step 1: Read WikiPage.tsx and GalleryPage.tsx**

Identify state, handlers, and effects that can be extracted into controller hooks (following the same pattern as `useAnnouncementsController`).

**Step 2: Extract controller hooks**

Move state management, search, pagination, and mutation handlers from each page into its own `use*PageController` hook. The page components become pure render components that call the hook.

**Step 3: Run tests**

Run: `npm test`
Expected: All pass, including `WikiPage.test.tsx`

**Step 4: Commit**

```bash
git add apps/portal/components/pages/ apps/portal/hooks/
git commit -m "refactor(portal): extract controller hooks from WikiPage and GalleryPage"
```

---

## Task 5: Consolidate debounced search pattern

6 files use `useDebouncedValue(search, 300)` with identical surrounding patterns (state + debounced value + pass to query). Create a tiny wrapper hook.

**Files:**
- Create: `apps/portal/hooks/useDebouncedSearch.ts`
- Modify: `apps/portal/hooks/useAnnouncementsController.ts`
- Modify: `apps/portal/components/pages/WikiPage.tsx`
- Modify: `apps/portal/components/pages/RosterPage.tsx`
- Modify: `apps/portal/components/pages/GalleryPage.tsx`
- Modify: `apps/portal/components/layout/CmdKSearch.tsx`

**Step 1: Create the hook**

```typescript
// apps/portal/hooks/useDebouncedSearch.ts
import { useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";

export function useDebouncedSearch(delay = 300) {
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, delay);
  return { search, setSearch, debouncedSearch: debounced } as const;
}
```

**Step 2: Replace in each file**

Replace the two-line pattern:
```typescript
// Before
const [search, setSearch] = useState("");
const [debouncedSearch] = useDebouncedValue(search, 300);

// After
const { search, setSearch, debouncedSearch } = useDebouncedSearch();
```

Skip `RegisterPage.tsx` (uses 320ms delay for username validation — semantically different).

**Step 3: Run tests**

Run: `npm test`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/portal/hooks/ apps/portal/components/
git commit -m "refactor(portal): consolidate debounced search into useDebouncedSearch hook"
```

---

## Task 6: Deduplicate origin validation in `index.ts`

The origin validation logic (check `Origin` header against `PORTAL_ORIGIN` and self-origin) is duplicated between the `/api/*` mutation middleware (lines 144-160) and the `/ws` handler (lines 253-261).

**Files:**
- Modify: `apps/worker/index.ts`

**Step 1: Extract helper**

```typescript
function validateOrigin(c: Context<{ Bindings: Bindings; Variables: Variables }>): Response | null {
  const origin = c.req.header("Origin");
  if (!origin) {
    return c.json({ error_code: "FORBIDDEN", message: "Origin header required", request_id: c.get("requestId") }, 403);
  }
  const portalOrigin = c.env.PORTAL_ORIGIN;
  const selfOrigin = new URL(c.req.url).origin;
  if (origin !== selfOrigin && (!portalOrigin || origin !== portalOrigin)) {
    return c.json({ error_code: "FORBIDDEN", message: "Origin not allowed", request_id: c.get("requestId") }, 403);
  }
  return null;
}
```

**Step 2: Use in both locations**

Replace the inline origin checks in the mutation middleware and WebSocket handler with `validateOrigin(c)`.

**Step 3: Run tests**

Run: `npm test`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/worker/index.ts
git commit -m "refactor(worker): deduplicate origin validation in index.ts"
```

---

## Task 7: Split `AdminService` batch methods (523 lines)

`AdminService` has 4 batch methods (`batchUpdateRole`, `batchDeactivate`, `batchReactivate`, `batchDelete`) at lines 183-249 that share identical structure: filter self, guard permissions, update DB, clear sessions, write audit log.

**Files:**
- Modify: `apps/worker/services/AdminService.ts`

**Step 1: Read the 4 batch methods**

Already read (lines 183-249). They share:
- `filter(id !== actorId)` + empty check
- `assertBatchActionAllowed` guard (3 of 4)
- DB update + session delete
- Username collection
- Audit log write

**Step 2: Extract shared batch executor**

```typescript
private async executeBatch(
  actorId: string,
  userIds: string[],
  opts: {
    action: string;
    requireGuard: boolean;
    update: (ids: string[], now: string) => Promise<void>;
    clearSessions?: boolean;
    auditDurable?: boolean;
  },
): Promise<ServiceResult<{ updated: number }>> {
  const targetIds = userIds.filter((id) => id !== actorId);
  if (targetIds.length === 0) return ok({ updated: 0 });

  let existingUsers: { id: string; username: string }[];
  if (opts.requireGuard) {
    const guard = await this.assertBatchActionAllowed(actorId, targetIds);
    if (!guard.ok) return guard.error;
    existingUsers = guard.existingUsers;
  } else {
    existingUsers = await this.deps.db.select({ id: users.id, username: users.username })
      .from(users).where(and(inArray(users.id, targetIds), isNull(users.deletedAt)));
  }

  if (existingUsers.length > 0) {
    const existingIds = existingUsers.map((r) => r.id);
    await opts.update(existingIds, this.now().toISOString());
    if (opts.clearSessions) {
      await this.deps.db.delete(sessions).where(inArray(sessions.userId, existingIds));
    }
  }

  const usernames = existingUsers.map((r) => r.username);
  const writeLog = opts.auditDurable ? this.deps.writeAuditLogDurable : this.deps.writeAuditLog;
  await writeLog({
    entityType: "user", action: opts.action, actorId, entityId: "batch",
    diffTitle: usernames.join(", "),
    detailText: JSON.stringify({ user_ids: targetIds, usernames, count: existingUsers.length }),
  });
  return ok({ updated: existingUsers.length });
}
```

**Step 3: Rewrite batch methods using executor**

Each batch method becomes ~5-10 lines (pre-checks + `executeBatch` call). `batchUpdateRole` keeps its extra role-validation logic before calling the executor.

**Step 4: Run tests**

Run: `npm test`
Expected: All pass

**Step 5: Commit**

```bash
git add apps/worker/services/AdminService.ts
git commit -m "refactor(worker): deduplicate AdminService batch methods via shared executor"
```

---

## Task 8: Clean up `isUploadPath` in `index.ts`

The `isUploadPath` function (lines 88-106) uses a chain of `if (path.includes(...) && path.endsWith(...))` that can be simplified.

**Files:**
- Modify: `apps/worker/index.ts`

**Step 1: Simplify**

```typescript
const UPLOAD_SUFFIXES = ["/images", "/icons"];
const UPLOAD_MEDIA_PREFIXES = ["/media/images", "/media/audio", "/gallery/images"];

function isUploadPath(path: string): boolean {
  if (UPLOAD_MEDIA_PREFIXES.some((p) => path.includes(p))) return true;
  return UPLOAD_SUFFIXES.some((s) => path.endsWith(s));
}
```

Wait — this broadens the match. Keep the original semantics: only `/announcements/*/images`, `/events/*/images`, `/wiki/articles/*/images`, `/game-data/*/icons`, plus the media/gallery paths. Simplify to:

```typescript
function isUploadPath(path: string): boolean {
  return (
    path.includes("/media/images") ||
    path.includes("/media/audio") ||
    path.includes("/gallery/images") ||
    (path.endsWith("/images") && (path.includes("/announcements/") || path.includes("/events/") || path.includes("/wiki/articles/"))) ||
    (path.endsWith("/icons") && path.includes("/game-data/"))
  );
}
```

**Step 2: Run tests**

Run: `npm test`
Expected: All pass

**Step 3: Commit**

```bash
git add apps/worker/index.ts
git commit -m "refactor(worker): simplify isUploadPath predicate"
```

---

## Scope Decisions (Not Included)

The following were identified during research but **excluded** from this plan:

- **Guild war hooks** (660 + 592 + 511 + 303 lines): These are domain-complex analytics/drag-and-drop controllers. Their size reflects genuine complexity, not poor structure. Splitting would add indirection without reducing complexity.
- **Notification store** (494 lines): Single responsibility (WebSocket + notification state). Size is justified.
- **AdminService overall** (523 lines): Only the batch methods are deduplicated (Task 7). The rest has distinct per-method logic.
- **`refineEventRules` in shared schemas**: Complex validation that serves both worker and portal. No simplification without breaking the validation chain.
- **Mixed raw D1 + Drizzle ORM**: Some queries use raw D1 for performance (batch operations, complex joins). This is intentional, not accidental.
- **Rate-limit declarations in index.ts**: Already uses `createRateLimitMiddleware` factory — the 6 instances have different configs and cannot be further consolidated.
