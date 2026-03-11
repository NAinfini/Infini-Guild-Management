# Roster (`/roster`)

@FEATURE: ROSTER
@ROLE: External (read-only), Member, Moderator, Admin
@REALTIME: POLL (600s, focus revalidate)

## Summary

Member directory with fancy, readable cards and a profile modal overlay. External view sees same UI, read-only. Notes are NOT shown anywhere in Roster (notes belong in Admin Console).

## Features

### Roster Card Grid

- Responsive card grid (not a table): 1 col mobile, 2 sm, 3 lg, 4 xl, up to 8 on 2xl
- Staggered entrance animation via dev-kit `StaggerList` (staggerChildren: 0.03)
- Clicking a card opens Profile Modal (overlay)

#### Roster Card Design (from BaiYe Portal)

Rectangular card with 3D tilt animation. Each card is a `<button>` for accessibility.

**Layout (min-height 180px):**
- Top: 170x170 avatar area (rounded-2xl, lazy-loaded, fallback to initial letter)
- Below avatar: media count badges row (photo count + video count + status chip)
- Bottom: username (bold, 15px, truncate) + title_html (1 line clamp)

**Card Animation (desktop hover):**
- 3D perspective tilt: continuous subtle rotation on X/Y axes (12s loop)
- Cycling color glow shadow: red → indigo → green → amber → pink (12s loop)
- Slight lift (y: -2px) + scale (1.02) on hover enter
- Transform origin: center bottom, perspective: 1200px
- Mobile: pressed state only (no hover tilt)

**Media Count Badges:**
- Photo count: blue-tinted pill with image icon + count
- Video count: purple-tinted pill with video icon + count
- Status chip: active (green) / inactive (red) / unknown (neutral) / vacation (overrides)

**Avatar Fallback:**
- If no icon or load error: gradient background with centered circle containing first letter of username
- Lazy loading + async decoding on all avatar images

### Audio Behavior

Two playback modes:
1. Hover playback on roster card (desktop only) — plays full clip, stops on mouse leave
2. Full playback inside Profile Modal
3. do not restart playing when clicked into modal, stop audio after exiting modal


Audio rules:
- Only one hover audio at a time (new hover stops previous)
- Debounce hover ~100ms (no spam)
- Stop immediately on mouse leave
- Respect browser autoplay policies
- Cache/load audio lazily (never fetch all audio on initial roster load)

### Roster Page Controls

- Filter bar (sticky)
- Audio controls (top-right): mute toggle, volume slider (0-100)
- All audio settings per-user in localStorage,
- Lazy-load members on scroll/pagination

### Filters & Sorting

- Search: username + wechat_name
- Sort (client-side): Power desc (default), Username A-Z, Class
- Saved views: per-user localStorage (no DB persistence)

### Profile Modal (Overlay — from BaiYe Portal)

Full-screen overlay with backdrop blur. Animated entrance (y: 24 → 0, scale 0.96 → 1).

**Header Section (top bar):**
- Left: avatar (88x88, rounded-xl, ring border, lazy-loaded with fade-in)
- Right of avatar: 3x2 grid of info fields:
  - Row 1: NAME (username, bold lg) | ACTIVE TIME (summary) | POWER (tabular-nums)
  - Row 2: TITLE (title_html rendered) | CLASS (display name) | BIO (2-line clamp)
- Each field: small uppercase tracking label + value below
- Top-right: Edit button (self or Admin/Mod) + Close (X) button

**Media Gallery (Swiper):**
- Full-width Swiper carousel (no coverflow, clean slide)
- Supports both photos and video URL embeds in one gallery
- Zoom support on photos (pinch or double-click, max 2.6x)
- Navigation: Swiper arrows + swipe on mobile
- Pagination dots when multiple items
- Video items: show play button overlay; click switches to iframe embed mode
- Video embeds: YouTube, Bilibili, TikTok (auto-detect and convert to embed URL)

**Thumbnail Rail (below gallery):**
- Collapsible thumbnail strip (toggle with chevron button)
- 64x64 thumbnails, active item has accent ring
- Video thumbnails show play icon overlay
- Counter: "3 / 12" style
- Max 60 thumbnails displayed

**Video Embed Support:**
- YouTube: `youtube.com/watch?v=` → `youtube.com/embed/`
- Bilibili: `bilibili.com/video/BV...` → `player.bilibili.com/player.html?bvid=`
- Vimeo: `vimeo.com/ID` → `player.vimeo.com/video/ID`
- TikTok: `tiktok.com/.../video/ID` → `tiktok.com/embed/v2/ID`
- Douyin: not embeddable (show "Open in Douyin" link)
- External link button on video embeds to open original URL

**Read-only display** — media is viewed here but NOT edited (editing happens in My Profile)

> Media upload rules (size constraints, conversion, video URL whitelist, cleanup strategy) are defined in `my-profile.md` and `Global.md`. Roster is view-only.

---

### title_html Rules

- Stored as `member_profiles.title_html`
- Rendered with DOMPurify strict allowlist: `span`, `b`, `strong`, `i`, `em`, `u`, `br`
- Tooltip: "Titles support limited HTML styling" + example
- Click copies raw title_html string; toast "Title copied"
- Editor: text input + live preview + "Copy example" button

## Loading & Empty States

- Skeleton loading for roster fetch
- Virtualize card list if roster is large
- Empty: "No members found" + "Reset filters"


## Permissions

| Action | External | Member | Moderator | Admin |
|--------|----------|--------|-----------|-------|
| View roster | Yes  | Yes | Yes | Yes |
| Open profile modal | Yes  | Yes | Yes | Yes |
| Edit own profile | no profile | Yes | Yes | Yes |
| Edit other profiles | No | No | Yes | Yes |
| Play audio | Yes | Yes | Yes | Yes |

## Data

### Media

- Images: max 10, each <= 5 MB, converted to WebP
- Audio: max 1, <= 20 MB after conversion to Opus
- Video URLs: max 10 (links only, no upload)

## Performance

- Roster list fetch is lightweight (no heavy media payloads)
- Lazy media fetch: audio URL only on hover debounce or modal open; gallery only on modal open
- Hover throttle: 200ms debounce (configurable)
- Cache media lookups in-memory during session
- Virtualize if roster is large

## Audit

- Profile edits (title_html, bio, availability, vacation, media) are audited
- No audit for passive reads

## Freshness

- Poll: 600s, focus revalidate
- ETag on roster endpoints
