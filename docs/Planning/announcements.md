# Announcements (`/announcements`)

@FEATURE: ANNOUNCEMENTS
@ROLE: External (read-only), Member, Moderator, Admin
@REALTIME: MIXED (publish push + poll safety)

## Summary

Structured, readable announcements feed with rich text editing (TipTap). Cards in a vertical list (newest first). Click card to open detail modal. Published announcements trigger push notifications plus regular polling.

## Rich Text Editor (TipTap)

Shared TipTap editor component used by both Announcements and Wiki.

### Supported Features

- **Text formatting:** bold, italic, underline, strikethrough, links
- **Structure:** headings (H1-H3), bullet lists, numbered lists, blockquotes
- **Media:** inline image embeds (drag-drop upload to R2, WebP conversion)
- **Code:** syntax-highlighted code blocks
- **Tables:** simple 2-3 column tables for structured info

### Editor UX

- Toolbar: formatting buttons grouped logically (text | structure | media | table)
- Slash command menu (`/`) for quick insertion (heading, image, code block, table)
- Drag-drop image upload with progress indicator + WebP conversion
- Paste image from clipboard support
- Mobile: toolbar becomes scrollable horizontal strip
- Keyboard shortcuts: Cmd+B (bold), Cmd+I (italic), etc.

### Storage

- Content stored as TipTap JSON in D1 (not raw HTML)
- Rendered to HTML on display with DOMPurify sanitization
- Images referenced by R2 URL in the JSON

### Security

- DOMPurify sanitization on render (strict allowlist)
- Image uploads validated: type (WebP after conversion), size (5 MB max)
- No script tags, no event handlers, no external resource loading
- Links open in new tab with `rel="noopener noreferrer"`

## Features

### Announcement List

- Split workspace layout: left panel shows announcement list, right panel shows selected announcement detail
- Cards in vertical list in left panel, newest first
- Clicking card shows Announcement Detail in right panel (no modal)
- Mobile: list view with drill-in to detail view
- External view = same UI, read-only
- Admin / Moderator only create announcement button

### Filters

- Default: non-archived announcements only
- Filter chips: All / Pinned / Archived
- For Admin/Mod editors: additional filter chips for Draft / Scheduled statuses
- Archived is NOT loaded by default; fetches from server only when user clicks Archived
- Search: title + body

### Pinned Announcements

- Admin/Mod can pin announcements (no hard cap in v1)
- Pinned ordering is fixed: `pinned_at` descending
- Pinned cards appear at top with pin icon + subtle "featured" styling

### Local "NEW" Indicators

- Track local `last_seen_announcements_at` in localStorage
- Cards created/updated since last seen show a NEW dot

### Announcement Card (List)

Each card shows:
- Title (1 line)
- Created time (local display; stored UTC)
- "NEW" dot (local-only)
- Pin icon (if pinned)
- Admin/Mod only: kebab menu (edit / dupe / archive / delete)

Interactions:
- Click card body -> open detail modal

### Announcement Detail (Modal)

Content:
- Header: title + timestamp + author
- Body: rendered TipTap JSON → sanitized HTML (images inline, tables rendered, code highlighted)
- Full-width reading experience

### Announcement Editor (Admin/Mod)

Modal on mobile, modal on desktop.

Fields:
- Title (plain text input)
- Body: TipTap rich text editor (see Rich Text Editor section above)
- Bot notification toggles:
  - "Notify Discord" checkbox (default: off)
  - "Notify WeChat" checkbox (default: off)
  - Defaults are fixed in v1 (no role-based notification defaults)

Publishing controls:
- Save as Draft (not visible to members)
- Publish Now (immediate)
- Schedule Publish: date/time picker (UTC stored, local displayed) — announcement stays hidden until publish time
- Cancel
- "Unsaved changes" indicator

### Scheduling & Expiry

- **Scheduled publish:** Admin/Mod sets a future publish date+time; announcement is hidden until then
  - Scheduled announcements show "Scheduled: <date>" chip in admin view
  - Cron job (Cloudflare Worker, runs every 15 min) checks for announcements past their `publish_at` and flips them to published
  - Members/External cannot see scheduled announcements
- **Auto-expiry:** Optional expiry date+time; announcement auto-archives when expired
  - Same cron job checks for announcements past their `expires_at` and sets `archived_at`
  - Expired announcements move to Archived filter
  - Expiry is optional — if blank, announcement stays until manually archived
- **Bot notifications:** Discord/WeChat notifications fire at actual publish time (not at creation time for scheduled posts)

### Image Handling

- Images are embedded inline via TipTap editor (drag-drop or paste)
- Uploaded to R2 during editing, URL inserted into TipTap JSON
- Client-side WebP conversion before upload
- Detail modal: images render inline in content flow; click to open full-screen viewer
- Performance: lazy-load images in rendered content

## Loading & Empty States

- Skeleton loading for list fetch
- Empty: "No announcements yet" + Admin/Mod CTA "Create announcement"

## Permissions

| Action | External | Member | Moderator | Admin |
|--------|----------|--------|-----------|-------|
| View announcements | Yes (read-only) | Yes | Yes | Yes |
| Create/Edit | No | No | Yes | Yes |
| Archive/Unarchive | No | No | Yes | Yes |
| Delete | No | No | Yes | Yes |
| Pin/Unpin | No | No | Yes | Yes |

## Data

### Scheduling Fields (D1)

```sql
-- Added to announcements table:
publish_at TEXT,              -- ISO UTC timestamp; nullable (null = immediate publish)
expires_at TEXT,              -- ISO UTC timestamp; nullable (null = no auto-expiry)
status TEXT DEFAULT 'draft',  -- 'draft' | 'scheduled' | 'published' | 'archived'
```

### Media

- Images: max 10 per announcement, each <= 5 MB, converted to WebP
- R2 key: `{instance}/announcement/{announcementId}/{ordinal}_{shortHash}.webp`

## Audit

- Create/edit/archive/delete writes to AUDIT_LOG
- entity_type = `announcement`
- Actions: `create`, `update`, `archive`, `delete`
- detail_text: short summary of changed fields

## Freshness

- Poll (600s) with focus revalidate on return
- Push message `announcement_published` for newly published announcements
- ETag on list + detail endpoints

## Security

- Sanitize any formatted text before render (DOMPurify)
- External is read-only; no mutations
