# Admin Console (`/admin`)

@FEATURE: ADMIN_CONSOLE
@ROLE: Moderator, Admin only (External and Member: no access)

## Summary

Centralized Admin/Moderator operations: member management, invite links, audit logs, bot settings, role management, and system health. 6 tabs: Member Management, Invite Links, Audit Log, Bot Settings, Roles, and Status/Health.

## Access

- External: no access
- Member: no access
- Moderator: member profile editing, invite usage stats (read-only), audit log viewing. Event/guild-war moderation permissions are defined in `events.md` and `guild-war.md`, not here.
- Admin: full member + role management

## Layout

- Uses global app shell: left sidebar + top-right profile dropdown
- 6 tabs:
  1. Member Management
  2. Invite Links
  3. Audit Log
  4. Bot Settings
  5. Roles
  6. Status / Health

---

## Tab 1: Member Management

### Goals

- Manage members and permissions safely
- Fast search/filter, minimal clicks, strong audit visibility

### Desktop UI

- Top controls: search (username / wechat_name), filter chips (role, class, active/inactive)
- Main area: Ant Design Table (dense mode via dev-kit)
  - Columns: username, wechat_name, role, class(es), power, notes
  - Row selection: multi-select with checkboxes
  - Row click selects; double click opens details modal
  - Detail modal is a shared component (reused in Guild War member view)

#### Batch Operations (Admin only)

- Select multiple members via checkboxes
- Batch action toolbar appears when 2+ members selected:
  - "Change Role" → dropdown (Member / Moderator) + confirmation dialog
  - "Deactivate" → confirmation dialog with count
  - "Reactivate" → confirmation dialog with count
- Each batch action creates individual audit log entries per member
- Max batch size: 50 members per operation
- Progress indicator for large batches

### Mobile/Tablet UI

- DataGrid becomes card list: username, role, active chip, class summary
- Tap opens full-screen details sheet (same tabs)
- Filters use bottom sheet modal

### Member Details modal

Tabs:
1. **Overview** — username, wechat_name, role, class, power, note, vacation, active time ranges
2. **Profile** — title_html preview + safe rendering, bio edit
3. **Media** — image/video url gallery, audio, upload/replace
4. **Admin actions** — role change, deactivate/reactivate, reset password

MUST enforce:
- Admin/Mod can edit everything EXCEPT `username` and `password`

### Role Change Guardrails

- Promoting/demoting Admin and moderator: explicit confirmation dialog required

### Permissions Matrix

| Action | Moderator | Admin |
|--------|-----------|-------|
| Edit member profiles | Yes | Yes | 
| Edit media | Yes | Yes | 
| Change role to Member | No | Yes |
| Change role to Moderator | No | Yes | 
| Change role to Admin | No | Yes |
| Deactivate member | No | Yes |
| Reset password | No | Yes |


### Edit Ergonomics

- All edits: react-hook-form + explicit Save/Cancel
- "Unsaved changes" indicator in modal
- Validate with zod; sanitize title_html with DOMPurify

---

## Tab 2: Invite Links (Admin write, Moderator read-only)

@FEATURE: INVITE_LINKS

### Goal

Manage invite links for member onboarding. See `auth.md` for full invite link registration flow.

### UI

- "Create Invite Link" button → modal:
  - Max uses (number input, admin-defined; no hard upper cap in v1)
  - Expiry (date picker, default 7 days from creation; admin can override or clear)
  - Generate button → shows copyable link
- Active links table:
  - Columns: link URL (truncated + copy), max uses, used count, expires_at, created_by, created_at
  - Row actions: Copy link, Revoke (`revoked_at` soft revoke + confirmation)
- Expired/fully-used links auto-hidden (toggle to show)
- Moderator view:
  - Stats-only table (no raw URL column, no copy action)
  - Visible columns: created_at, expires_at, max_uses, used_count, usage_rate

### Permissions

- Only Admin can create/revoke invite links
- Moderator can view invite usage statistics only (read-only, no URL/copy)

---

## Tab 3: Audit Log

@FEATURE: AUDIT_LOG

### Access

Admin/Moderator only.

### UI

- Standalone tab (not a sub-tab)
- Filters: entity type, actor (user), date range, search in detail_text
- Each entry: readable card line "Actor did Action on Entity (time)"
- Expand to see detail_text
- Archive Explorer (Admin only): month picker (`YYYY-MM`) for R2 archived audit data
- Archive queries show "slow query" hint (cold storage path) and load asynchronously
- Archive queries use monthly manifest/index metadata first, then open matching data files
- Month list defaults to last 12 months (can expand to older archived months)
- Download button for selected archive month (`.ndjson.gz`)
- "Download CSV" button: frontend downloads `.ndjson.gz`, converts in-browser, then downloads CSV to client

### Audit Diff View

- Show human-readable diff header (before/after summary) above detail_text
- Examples: `title_html changed`, `vacation range changed`, `role changed`
- Keep detail_text for debugging, never rely on raw JSON only

## Audit Log Pagination

### Pagination Strategy

**Default Filter (Required):**
- Date range: **90 days** (last 90 days by default)
- Cannot query without date range (prevents full-table scans)
- Max range: 365 days

**Pagination:**
- Offset-based (traditional page numbers)
- Page size: 50 entries per page
- UI shows page numbers with prev/next + jump-to-page input
- Total count returned in response for page indicator

**API Endpoint:**
```typescript
GET /api/admin/audit-logs
{
  page: 1,
  limit: 50,
  filters: {
    date_range: {
      start_at: '2026-01-01',  // REQUIRED
      end_at: '2026-01-30'     // REQUIRED
    },
    entity_type?: string,
    actor_id?: string,
    search?: string
  }
}

Response:
{
  entries: [...],
  total: number,
  page: number,
  limit: number,
  total_pages: number,
  range_start: string,
  range_end: string
}
```

### Retention Policy

**Active Data**
- Keep in `audit_log` table: **90 days**
- Indexed and fast queries
- Data older than 90 days is exported to R2 archive before deletion from D1

**Archive Data (R2)**
- Keep archive objects: **1 year**
- Archive format: newline-delimited JSON gzip (`.ndjson.gz`), partitioned by month (`audit-archive/YYYY/MM/*.ndjson.gz`)
- Manifest/index per month: `audit-archive/YYYY/MM/manifest.json` (counts, entity buckets, file list)
- Default Audit Log view does not read archive data unless user opens Archive Explorer
- Admin can query monthly archive data and download archive files
- Moderator cannot query or download R2 archive

**CSV Export (Frontend Conversion)**
- Trigger model: convert only when user clicks `Download CSV`
- Conversion path: download `.ndjson.gz` -> decompress -> parse NDJSON -> emit CSV
- Execution model: main thread conversion (no worker in v1)
- Size policy:
  - `<= 50 MB` archive input: allow frontend CSV conversion
  - `> 50 MB` archive input: disable CSV conversion and show raw-download-only message
- CSV delimiter: comma (`,`)
- CSV encoding: UTF-8 with BOM (Excel-friendly)
- Output filename: `guild-audit-YYYY-MM-localtime.csv`
- CSV columns (operations profile): `timestamp_utc`, `timestamp_local`, `actor`, `action`, `entity_type`, `entity_id`, `diff_title`, `detail_text`
- `detail_text` export policy: export full text
- Sensitive data policy: role-based masking matrix (below)
- Retry policy: automatic retry once on conversion pipeline failure
- Error UX: categorized errors (`decompress_failed`, `parse_failed`, `encode_failed`) with specific user hints

**CSV Masking Matrix (Role-based)**
- Admin export:
  - `actor` and `entity_id`: unmasked
  - Secrets and credential-like fields in `detail_text`: masked
- Moderator export (if enabled for any CSV endpoint):
  - `actor`: masked
  - `entity_id`: masked
  - `detail_text`: secrets and sensitive identifiers masked
- External export: not allowed

**Cleanup Job:**
- Runs daily at 2 AM UTC
- Export yesterday's 90+ day window to R2 archive (idempotent by file key)
- Update monthly `manifest.json` index after archive write
- Delete exported rows older than 90 days from `audit_log`

**Archive API**
```typescript
GET /api/admin/audit-archive?month=YYYY-MM
// Admin only, paginated read using manifest/index + targeted .ndjson.gz files

GET /api/admin/audit-archive/download?month=YYYY-MM
// Admin only, returns signed R2 download URL(s) for .ndjson.gz files
// Signed URL TTL: 15 minutes
// Every click issues a fresh signed URL (no signed-link reuse)
```

**Export Rate Limit and Audit**
- Rate limit: max 1 archive export action per user per minute
- Every export action MUST be audited (who, when, month, format)
- Export formats audited: `raw_ndjson_gz` and `csv`


---

### Rules

- Log meaningful changes only: profile edits, role changes, war history edits, announcement edits, event edits
- Do NOT log sign-in/out or passive reads
- This list will be very long in the future, dig into cloudflare D1 price calculation to improve efficiency for this part, only query by index, and query only visible row by batch.
---

## Tab 4: Bot Settings (Admin only)

@FEATURE: BOT_SETTINGS

> Full bot feature details in `bot-integrations.md`. This tab is configuration only.

### Discord Settings

- Bot status indicator (connected / disconnected)
- Guild ID input
- Notification channel selector (dropdown of guild channels)
- Team comp channel selector
- Default notification toggles per event type (guild_war default on, others off)
- "Test notification" button — sends a test embed to the selected channel

### WeChat Settings

- Webhook URL (masked input, stored as Worker secret)
- Target group/room IDs (multi-input)
- Default notification toggles per event type
- "Test message" button — sends a test message to configured group

### Permissions

- Only Admin can view/edit bot settings
- Moderator: no access to this tab

---

## Tab 5: Roles (Admin only)

@FEATURE: ROLES_MANAGEMENT

### Goal

Manage portal roles and their permissions. View current role assignments at a glance.

### UI

- Role list: table showing role name, member count, description
- Click role to view members with that role
- Admin can create custom roles (future expansion beyond Member/Moderator/Admin)
- Role assignment changes audited

### Permissions

- Only Admin can view/edit role settings
- Moderator: no access to this tab

---

## Tab 6: Status / Health

@FEATURE: STATUS_HEALTH

### Goal

Simple "is everything connected?" page for multi-endpoint setups.

### Environment Awareness

- Show which environment/bindings are active:
  - Project name
  - Worker API base URL
  - D1 binding name / database name
  - R2 bucket binding / bucket name
- "Copy config summary" (one click) for debugging

### UI

- Cards per backend target: Worker API, D1, R2
- Each card: last check time, status (ok/degraded/down), basic latency bucket, "Retry" button
- Optional small log panel (local-only recent check results)

### Health Checks

- Worker: GET `/health` only
- D1: `SELECT 1`
- R2: HEAD on a known tiny object
- Manual only (no polling loop)

## Data

### Member Notes

- Purpose: private officer/admin notes (not visible to Members/External)
- Where shown: Admin Console -> Member Management -> Member detail modal ONLY
- Note edits must write audit log entry

## Freshness

- Poll: 60s, on-demand refresh for heavy tables
- Prefer virtualization when large
