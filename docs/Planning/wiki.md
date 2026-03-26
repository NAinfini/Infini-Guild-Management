# Wiki / Tutorials (`/wiki`)

@FEATURE: WIKI
@ROLE: External (read-only), Member (read-only), Moderator, Admin
@REALTIME: POLL_ONLY (600s, focus revalidate)

## Summary

CMS-style knowledge base stored in D1. Admin/Mod create and edit articles using the shared TipTap rich text editor (same as Announcements). Articles are organized by category with a sidebar navigation tree.

## Content Model

### Article Fields

- `id` — nanoid
- `title` — plain text
- `slug` — URL-friendly (auto-generated from title, editable)
- `category_id` — FK to `wiki_categories`
- `body_json` — TipTap JSON (same format as announcements)
- `sort_order` — integer for manual ordering within category
- `archived_at` — soft delete timestamp (nullable; consistent with events/announcements pattern)
- `created_by` — user ID
- `updated_by` — user ID
- `created_at` — UTC
- `updated_at` — UTC

### Category Fields

- `id` — nanoid
- `name` — display name
- `slug` — URL-friendly
- `sort_order` — integer for sidebar ordering
- `parent_id` — nullable FK to self (one level of nesting max)

### Data Model

```sql
CREATE TABLE wiki_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0,
  parent_id TEXT REFERENCES wiki_categories(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE wiki_articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES wiki_categories(id),
  body_json TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  archived_at TEXT,                  -- soft delete timestamp (consistent with events/announcements pattern)
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Features

### Article List (Flat List + Reader Pane)

- Desktop: left panel with flat searchable article list + right reader pane showing selected article
- Mobile: article list view, tap article to navigate to reader view
- Article list shows article titles with category badge, sorted by category then sort_order
- Active article highlighted in list
- Search bar at top of list: searches title + body across all articles
- Category filter dropdown above article list to narrow by category

### Article Viewer

- Rendered TipTap JSON → sanitized HTML (DOMPurify, same rules as announcements)
- Images render inline, lazy-loaded
- Code blocks with syntax highlighting
- Tables rendered
- Breadcrumb: Category > Article Title
- "Last updated by [username] on [date]" footer
- Admin/Mod: "Edit" button in top-right

### Article Editor (Admin/Mod)

- Modal on mobile, side panel or full page on desktop
- Fields:
  - Title (plain text input)
  - Category (dropdown selector)
  - Slug (auto-generated, editable)
  - Sort order (number input)
  - Body: TipTap rich text editor (shared component — see `announcements.md` for TipTap spec)
- Publishing controls:
  - Save (immediate)
  - Cancel
  - "Unsaved changes" indicator
  - Archive toggle (soft delete)

### Category Management (Admin only)

- Manage categories in a simple list editor (accessible from wiki page header or admin console)
- Add / rename / reorder / delete categories
- Delete only allowed if category has no articles (or move articles first)
- Max nesting: 1 level (parent → child, no deeper)

### Image Handling

- Same as announcements: inline via TipTap, uploaded to R2, WebP conversion
- R2 key: `{instance}/wiki/{articleId}/{ordinal}_{shortHash}.webp`
- Max 10 images per article, 5 MB each

## Loading & Empty States

- Skeleton loading for article list and content
- Empty category: "No articles in this category" + Admin/Mod CTA "Create article"
- Empty wiki: "Wiki is empty" + Admin/Mod CTA "Create first article"

## Permissions

| Action | External | Member | Moderator | Admin |
|--------|----------|--------|-----------|-------|
| View articles | Yes | Yes | Yes | Yes |
| Search wiki | Yes | Yes | Yes | Yes |
| Create/Edit articles | No | No | Yes | Yes |
| Archive/Unarchive | No | No | Yes | Yes |
| Delete articles | No | No | No | Yes |
| Manage categories | No | No | No | Yes |

## Audit

- Create/edit/archive/delete writes to AUDIT_LOG
- entity_type = `wiki_article`
- Actions: `create`, `update`, `archive`, `delete`
- Category changes: entity_type = `wiki_category`

## Freshness

- Poll: 600s, focus revalidate
- ETag on list + detail endpoints
- Articles are mostly static — long cache is fine
