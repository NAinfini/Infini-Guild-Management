# Events (`/events`)

@FEATURE: EVENTS_UNIFIED
@ROLE: External (read-only), Member, Moderator, Admin
@REALTIME: PUSH_ENABLED (< 2s for signups)
@SCHEDULING: TIMEZONE_AWARE + CONFLICT_DETECTION

## Summary

Unified events system for weekly missions, guild wars, social events, and other events. Each event has one signup list (no teams on Events page). Card-based list sorted by start time.

## Event Types

- `weekly_mission`
- `guild_war`
- `social`
- `other`
- (Future: `patch_day`, `tournament`)

## Core Fields (v1)

- type, title, description
- start time (store UTC, display local)
- optional end time
- capacity (max participants; optional)
- pinned/featured (Admin/Mod)
- signup locked (Admin/Mod)
- attachments (images only in v1; shown in detail, not on card)
- recurrence rule (optional; see Recurring Events below)

## Features

### View Modes

- Two view modes on `/events`: **Card List** (default) and **Calendar View**
- Toggle button in top-right of events page (list icon / calendar icon)
- View preference saved in localStorage
- Both views share the same data source and filters

### Events Card List

- Default sort: start time ascending (soonest first)
- Each card shows:
  - Header: type chip + start time + status + small icon actions
  - Title + short description (2-3 line clamp)
  - Participants: `MemberGrid2x5` (10 slots) — username + class + power(card background color follow class color)
  - `+N` chip opens full participant list

### Card Actions (Icon Buttons)

- Join/Leave: single toggle icon (state-based, with tooltip)
- Copy All Members: `@wechat_name` default, fallback `@username`
- Admin/Mod only: Edit, Duplicate, Pin toggle, lock toggle, archive.

### Signup Rules

- Join = add user to signup list
- Leave = remove user from signup list
- If signup locked: members cannot Join/Leave; Admin/Mod can still edit participants
- Capacity: show `current/max` if set; Join disabled when full (Admin/Mod can override)

### Soft Conflict Warning

- If joining overlaps with another joined event: show warning "Conflicts with: <Event>"
- Still allow Join (non-blocking)

### Copy Formats

- Copy All Members: comma-separated `wechat_name` (fallback `username`)
- With label: `<event_name>: @wechat1, @wechat2, ...`

### Archived Events

- Main view fetches only non-archived events
- Archived button triggers server fetch

### Event Editor (Admin/Mod)

Modal (desktop) / full-screen modal (mobile).
- Type / title / description / link
- Start time / end time
- Max participants
- Attachments (images only)
- Add/remove members
- Delete / duplicate / archive
- Recurrence settings (see below)

### Recurring Events

@FEATURE: RECURRING_EVENTS

Events support both one-off and recurring schedules.

#### Recurrence Rules

- Recurrence evaluation anchor is UTC (no guild-timezone or creator-timezone mode in v1)
- **Frequency options:** daily, weekly, monthly
- **Weekly:** select day(s) of week (e.g., every Tuesday and Thursday)
- **Monthly:** select day of month (e.g., 1st, 15th) or relative (e.g., "2nd Tuesday")
- **End condition:** never / after N occurrences / until date

#### How Recurring Events Work

- Recurring events use a "series" model: one parent event defines the recurrence rule
- System auto-generates upcoming instances (next 8 weeks of instances)
- Each instance is a real event row in D1 with its own signup list
- Instance fields inherit from parent but can be individually edited (title, description, capacity)
- Editing the parent updates all future unmodified instances
- Editing a single instance detaches it from the series for that field
- Exception cap: max 50 detached/overridden instances per series

#### Recurrence Data Model

```sql
-- Added to events table:
recurrence_rule TEXT,        -- JSON: { frequency, interval, daysOfWeek[], endAfter, endDate }
series_id TEXT,              -- links instances to parent series (nullable for one-offs)
is_series_parent BOOLEAN,    -- true for the template event
instance_date TEXT,          -- the specific date this instance represents
```

#### Instance Generation

- Cron job (Cloudflare Worker scheduled trigger) runs daily
- Generates instances for the next 8 weeks
- Skips dates that already have an instance
- Admin/Mod can manually generate or skip specific dates

#### UI for Recurring Events

- Event editor: toggle "Recurring" → shows frequency picker + end condition
- Card list: recurring events show a small repeat icon
- When editing a recurring instance: prompt "Edit this event only" vs "Edit all future events"
- When deleting: prompt "Delete this event only" vs "Delete all future events"
- If series reaches 50 exceptions: block new per-instance overrides and require editing parent/future scope

### Calendar View

@FEATURE: EVENTS_CALENDAR

#### Layout

- Three sub-views: **Month** (default) / **Week** / **Day**
- Sub-view toggle in calendar header
- Navigation: prev/next arrows + "Today" button to snap back
- Current day highlighted with accent border

#### Month View

- Standard grid (7 columns × 5-6 rows)
- Each day cell shows stacked event pills (colored by event type)
- Event pill: truncated title + start time + type color dot
- Max 3 pills per cell; overflow shows "+N more" chip that expands to popover
- Click event pill → opens event detail (same as card list click behavior)
- Click empty day area → Admin/Mod: quick-create event for that date

#### Week View

- 7-column time grid (hours on Y-axis, days on X-axis)
- Events rendered as time blocks spanning their duration
- Events without end time: render as 1-hour default block
- Overlapping events: side-by-side stacking within the same time slot
- Drag to resize event duration (Admin/Mod only)

#### Day View

- Single-column time grid (hours on Y-axis)
- Full event cards in time slots (more detail than week view)
- Sidebar: list of all events for that day with participant counts

#### Calendar Interactions

- Click event → same behavior as card list (open detail / join-leave)
- Hover event pill → tooltip with title, time, participant count, type
- Join/Leave: available from event tooltip or detail modal (same as card list)
- Mobile: month view only (week/day too cramped); tap event pill → detail modal

#### Availability Overlay (optional toggle)

- "Show team availability" toggle (visible to all logged-in users)
- Overlays aggregated member availability blocks on the calendar
- Heat-map style: darker = more members available at that time
- Helps Admin/Mod schedule events when most members are free
- Data source: `member_profiles.availability` (already stored as weekly UTC blocks)

### Smart Scheduling

- Every event stores in UTC
- Conflict detection on signup: check overlap with other joined events

### Local "NEW/UPDATED" Indicators

- localStorage `last_seen_events_at` timestamps
- Show NEW/UPDATED chips when `updated_at` is newer
- "Mark all as read" button

### Event Conflict

- If member has conflict event at same time, soft warn user about the conflicting event, but allow sign up afterwards.
- Warning format: "⚠️ Conflicts with: <Event Title> (<start time>)"
- Non-blocking — user can dismiss and proceed with signup


## Loading & Empty States

- Skeleton loading for card list
- No upcoming events: "No upcoming events" + Admin/Mod CTA "Create event"
- Filtered empty: "No events match your filters" + "Reset filters"
- Archived empty: "No archived events yet"


## Permissions

| Action | External | Member | Moderator | Admin |
|--------|----------|--------|-----------|-------|
| View events | Yes (read-only) | Yes | Yes | Yes |
| Join/Leave | No | Yes | Yes | Yes |
| Copy members | No | Yes | Yes | Yes |
| Create/Edit event | No | No | Yes | Yes |
| Archive/Delete | No | No | Yes | Yes |
| Pin/Feature | No | No | Yes | Yes |
| Lock signup | No | No | Yes | Yes |
| Manage participants | No | No | Yes | Yes |

## Data

### Tables

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,              -- nanoid
  type TEXT NOT NULL CHECK(type IN ('weekly_mission', 'guild_war', 'social', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  start_at TEXT NOT NULL,           -- ISO UTC timestamp
  end_at TEXT,                      -- ISO UTC timestamp (nullable)
  capacity INTEGER,                 -- max participants (nullable = unlimited)
  pinned BOOLEAN DEFAULT FALSE,
  signup_locked BOOLEAN DEFAULT FALSE,
  archived_at TEXT,                 -- soft delete timestamp
  created_by TEXT NOT NULL,         -- user_id
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Recurring event fields
  recurrence_rule TEXT,             -- JSON: { frequency, interval, daysOfWeek[], endAfter, endDate }
  series_id TEXT,                   -- links instances to parent series (nullable for one-offs)
  is_series_parent BOOLEAN DEFAULT FALSE,
  instance_date TEXT                -- the specific date this instance represents
);

CREATE TABLE event_participants (
  id TEXT PRIMARY KEY,              -- nanoid
  event_id TEXT NOT NULL REFERENCES events(id),
  user_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  UNIQUE(event_id, user_id)
);
```

### Indexes

- `events(start_at)` — sort by upcoming
- `events(series_id)` — find instances of a series
- `events(archived_at)` — filter archived
- `event_participants(event_id)` — list participants
- `event_participants(user_id)` — find user's events (for conflict detection)

## Audit

- Create/edit/archive/delete events writes to AUDIT_LOG
- entity_type = `event`
- Participant changes (force-join/leave) are audited

## Freshness

- Push-enabled: < 2s for signup changes
- Safety poll: 60s while viewing
- ETag on all endpoints

## Security

- Sanitize description text
- Server-side capacity enforcement
- Server-side signup lock enforcement
