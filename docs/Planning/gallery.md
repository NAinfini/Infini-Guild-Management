# Gallery (`/gallery`)

@FEATURE: GALLERY
@ROLE: External (read-only), Member, Moderator, Admin
@REALTIME: POLL_ONLY (600s, focus revalidate)

## Summary

Community screenshot and video clip gallery. Members upload freely; Admin/Mod can delete any item. Masonry grid layout with lightbox viewer. No comments, no likes — just a visual archive.

## Features

### Gallery Grid

- Masonry grid layout (responsive: 2 col mobile, 3 sm, 4 lg, 5 xl)
- Staggered entrance animation
- Each item: thumbnail + uploader username overlay (bottom-left) + type badge (photo/video)
- Infinite scroll pagination (load 20 items per batch)
- Sort: newest first (default), oldest first

### Upload (Members only)

- "Upload" button (top-right, visible only to logged-in members — hidden for External visitors)
- Upload modal:
  - Drag-drop zone or file picker
  - Max 20 images per upload batch
  - Max 10 MB per image
  - Client-side WebP conversion before upload
  - Upload progress bar per file
  - Optional caption per image (plain text, 200 char max)
- Video: URL-only (same whitelist as profile — YouTube, Bilibili, Vimeo)
  - Max 10 video URLs per upload batch
  - Optional caption per URL
- R2 key: `{instance}/gallery/{itemId}_{shortHash}.webp`

### Lightbox Viewer

- Click any gallery item → full-screen lightbox overlay with backdrop blur
- Navigation: left/right arrows + swipe on mobile
- Photo: zoom support (pinch or double-click, max 2.6x)
- Video: iframe embed (same embed logic as roster profile modal)
- Caption displayed below image/video
- Uploader username + upload date in footer
- Admin/Mod: "Delete" button in lightbox header
- Close: X button or Escape key

### Filters

- Filter chips: All / Photos / Videos
- Search: caption text + uploader username
- Date range filter (optional)

### Moderation (Admin/Mod)

- Delete any gallery item (hard delete — immediate R2 cleanup)
- Confirmation dialog before delete
- No edit — if wrong, delete and re-upload
- Bulk delete: multi-select mode with checkboxes + "Delete selected" button

## Data Model

```sql
CREATE TABLE gallery_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('image', 'video')),
  url TEXT NOT NULL,
  caption TEXT,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Loading & Empty States

- Skeleton loading: placeholder cards in masonry grid
- Empty: "No screenshots yet — be the first to share!" + upload CTA for members
- Upload in progress: dimmed overlay with progress bars

## Permissions

| Action | External | Member | Moderator | Admin |
|--------|----------|--------|-----------|-------|
| View gallery | Yes | Yes | Yes | Yes |
| Upload images/videos | No | Yes | Yes | Yes |
| Delete own items | No | Yes | Yes | Yes |
| Delete any item | No | No | Yes | Yes |
| Bulk delete | No | No | Yes | Yes |

## Audit

- Gallery uploads are NOT audited (too noisy, per Global.md)
- Gallery deletions by Admin/Mod ARE audited
- entity_type = `gallery_item`
- Actions: `delete`

## Performance

- Thumbnails: generate smaller preview on upload (or use R2 image resizing if available)
- Lazy-load images as user scrolls (intersection observer)
- Infinite scroll with cursor-based pagination (not offset)

## Freshness

- Poll: 600s, focus revalidate
- Manual refresh button
- ETag on list endpoint
