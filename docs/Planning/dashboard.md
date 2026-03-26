# Dashboard (`/`)

@FEATURE: DASHBOARD
@ROLE: External (read-only), Member, Moderator, Admin
@REALTIME: MIXED (events: push + safety poll 60s; announcements/roster: poll)

## Summary

Quick "what's happening" overview on load. Two-column desktop layout; single-column stacked on mobile.

## Layout

### Desktop (2-column)

| Left Column | Right Column |
|-------------|-------------|
| Upcoming Events (next 7 days, 5 list rows) | My Signups (tooltip bar strip) |
| Last Guild War (carousel over recent 4 wars) | Notifications Card |
| Active / Total Members count | - |

### Mobile

- Single-column stacked: Upcoming Events → My Signups → Notifications → Last War → Members

## Features

### Upcoming Events Card

- **Window:** next 7 days
- **Count:** latest 5 upcoming items across all event types, displayed as compact list rows
- **Pinned/Featured strip:** if any event is pinned (Admin/Mod controlled), show a slim "Featured" strip above the list

#### Each Event Row Shows

- Date badge: month (short uppercase) + day number
- Event type chip with icon + start time (HH:MM)
- Title (1 line)
- First 5 participant avatars with username tooltip
- `+N` text showing remaining participants (display only, not clickable)
- Arrow button to navigate to event detail page

#### Dashboard Card Behavior

- Dashboard cards are **read-only** — no Join/Leave/Copy actions
- All mutations (join, leave, copy signup) happen on `/events/$id` detail page
- Click arrow button → navigate to event detail for full actions

### My Signups (Tooltip Bar Strip)

- Compact horizontal bar strip showing events the user has signed up for
- Each bar shows event title, colored by event type
- Hover bar shows tooltip with event details (time, type, participant count)
- Click navigates to event detail
- Only shows events the current user has signed up for
- Compact design — bars with tooltips, not full event cards

### Notifications Card

**Status**: Component implemented but **not rendered** in v1 (feature disabled)

- Component exists at `apps/portal/components/dashboard/NotificationsCard.tsx`
- Shows announcements with "Mark All as Read" button
- Click navigates to announcements page
- Not included in DashboardPage layout (intentionally disabled for v1)

### Last Guild War Card

- Carousel showing the most recent 4 wars (swipeable/navigable)
- Each war slide shows:
  - Top row: wins/loss + kills (both sides)
  - Secondary row: total credits / towers / base HP / distance (both sides)
  - Highlights: overall top KDA + MVPs (damage / tank / healing)
- "View history" link navigates to Guild War History with selected war preselected

### Active Members Card

- Simple stat: "Active: X / Total: Y" with a small donut or progress ring
- "Active" = members not soft-deleted (vacation members still count as active)
- Click navigates to `/roster`

## Loading & Empty States

- Skeleton loading for all cards while fetching
- No upcoming events: "No upcoming events" + Admin/Mod CTA "Create event"
- No war history: "No wars recorded yet"
- No notifications: "No new updates"

## Permissions

| Action | External | Member | Moderator | Admin |
|--------|----------|--------|-----------|-------|
| View dashboard | Yes (read-only) | Yes | Yes | Yes |
| Join/Leave events | No | Yes | Yes | Yes |
| Copy signup | No | Yes | Yes | Yes |

## Data & Freshness

- Events: push-enabled (< 2s), safety poll 60s
- Announcements: poll only, focus revalidate
- Roster/Active Now: poll 600s, focus revalidate
- Guild War history: immutable, ETag + staleTime: Infinity
