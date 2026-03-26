# My Profile (`/profile`)

@FEATURE: MY_PROFILE
@ROLE: Member, Moderator, Admin (External: no route access)

## Summary

Member self-service editing for profile, availability, and account settings. Admin/Mod can also open any member in edit mode via Admin Console.

## Access

- External: no access to `/profile`
- External member preview is available via Roster profile modal (public fields only)
- Member/Moderator/Admin: access own profile route

## Layout

### Desktop

- Left column: Profile preview + quick actions
- Right column: Tabbed editor

### Mobile

- Stacked sections with tabs in top bar

## Left Column: Profile Preview

- Card with subtle gradient + glow on hover (consistent with portal style)
- Skeleton loading while fetching
- Empty states for missing media/availability

Shows how user appears on Roster:
- Avatar (if applicable)
- Username
- Active status chip
- title_html rendered (sanitized)
- Image/video counts

### Quick Actions

- "Edit my display (Title/Bio/Media)" -> opens member modal in Roster in edit mode
- Profile completion chip (local-only): highlights missing pieces (no bio / no availability / no audio)
- Open Analytics (focus me) — members only;

## Right Column: Tabs

v1 uses exactly 4 tabs:
- Profile
- Media
- Availability
- Account

### Tab 1: Profile

Editable fields (member self-service):
- **username** (login name) — MUST be UNIQUE; if changed, require re-login after save
- **power** (造诣) — total power value
- **classes** (multiple, ordered):
  - Ordered list; first item = Primary Class (show "Primary" badge)
  - Drag/drop reorder + "Set as primary" action
  - Prevent duplicates
  - Classes:鸣金虹,鸣金影,牵丝玉,牵丝霖,破竹风,破竹尘,破竹鸢,裂石威,裂石钧
    mingjin classes: blue
    qiansi classes: green
    pozhu classes:purple
    lieshi classes:dark red
- **title_html** - HTML styled title with tooltip explaining styling, copy example button
- **bio** - Plain text biography

Rules:
- react-hook-form + Save/Cancel

### Tab 2: Media

Editable media fields (member self-service):
- **Images**: max 10 images, 5 MB each
    - Client-side conversion to WebP before upload
    - Drag/drop reorder
    - Delete option
    - Preview grid
  - **Audio**: max 1 audio file, 20 MB
    - Client-side conversion to Opus/OGG (48kbps, 16kHz, mono) REQUIRED before upload
    - If browser cannot encode Opus: show toast error "Your browser doesn't support audio conversion. Please try a different browser or upload an Opus/OGG file directly."
    - No fallback to original format — Opus only
    - Upload/replace/remove
    - Playback preview
  - **Video URLs**: max 10 video links (no raw uploads)
    - Whitelist: youtube.com, youtu.be, bilibili.com, vimeo.com
    - Add/remove/reorder URLs
    - Validation on client and server
  - **Upload progress**: Show conversion progress (10%, 20%...) and upload progress separately

#### Media Conversion (Client-side, before upload)

- Images → WebP (Canvas API)
- Audio → Opus/OGG, 48kbps, 16kHz, mono (Web Audio + MediaRecorder). No fallback — if browser can't encode, show error toast and reject upload.
- Video URLs → stored as-is (no conversion)

#### Video URL Whitelist

```javascript
const ALLOWED_HOSTS = ['youtube.com', 'youtu.be', 'bilibili.com', 'vimeo.com', 'tiktok.com', 'douyin.com'];
// Validation: regex match + domain check (client + server)
```

#### Media Cleanup Strategy

- Delete old file immediately when replaced (optimistic delete)
- If delete fails: log error, continue (file becomes orphan)
- No soft-delete for media
- No version history/rollback

#### Scheduled Media Orphan Cleanup

- Cloudflare Worker cron job runs daily at 3 AM UTC
- Scans R2 bucket for files not referenced in any D1 record (member_profiles media columns)
- Deletes orphaned files older than 7 days (grace period prevents race conditions with in-progress uploads)
- Logs cleanup results: files scanned, orphans found, orphans deleted
- No user-facing UI — admin can check cleanup stats in Status/Health tab

Rules:
- react-hook-form + Save/Cancel

### Tab 3: Availability

- Weekly windows editor (Microsoft Teams-style):
  - Grid by day with addable time blocks
  - Click to create, drag edges to resize
  - Multiple blocks per day (e.g., 08:00-10:00 + 17:00-18:00)
  - clear day
- Vacation range: start/end date
- "Active now (estimated)" derived from windows (client calc)

### Tab 4: Account

- Change password: current password, new password, confirm
- Change username: current password required, must be unique, invalidates all sessions (see `Global.md` Username Change section)
- Logout button (also in top-right dropdown)

#### Discord Account Linking

- "Link Discord" section:
  - If not linked: instructions + "Enter verification code" input (6-digit)
  - Flow: member uses `/link <username>` in Discord → bot DMs a 6-digit code → member enters code here
  - On success: shows linked Discord username + "Unlink" button
  - Code expires after 5 minutes
- "Unlink Discord" button with confirmation
- See `bot-integrations.md` for full linking flow

#### Notification Preferences

- "Discord event reminders" toggle (opt out of DM reminders)
- Only visible if Discord account is linked

## Saving & Audit

- Each tab has own Save/Cancel (no global auto-save)
- "Unsaved changes" indicator per tab
- Confirm before leaving with unsaved changes
- After save: "Saved" toast + last_saved_at timestamp
- Audited changes: title_html, bio, availability, vacation, media
- No audit spam for "opened page"


## Permissions

| Action | External | Member | Moderator | Admin |
|--------|----------|--------|-----------|-------|
| View own profile | No | Yes | Yes | Yes |
| Edit own profile | No | Yes | Yes | Yes |
| Edit other profiles | No | No | Yes | Yes |
| Change password | No | Own only | Own only | Reset only |

## Data


## Freshness
- On-demand only; refresh after save/login/logout
- No background polling for profile page
