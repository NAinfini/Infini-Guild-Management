# Settings (`/settings`)

@FEATURE: SETTINGS
@ROLE: External (theme/locale only), Member, Moderator, Admin

## Summary

Centralized place for user preferences. The only place for Theme and Localization controls (plus future toggles). All settings are client-side only.

## Access

- External: limited (theme/locale only) via `/settings`
- Members: full
- Admin/Mod: same as members, plus any admin-only toggles added later

## Layout

### Desktop

- 2 columns: Left = settings categories, Right = selected panel

### Mobile

- Category list becomes top segmented control or list with drill-in

## Categories (v1)

### 1. Appearance

- Theme selector (card grid showing all built-in theme profiles):
  - Each card: theme name + preview swatch + glow preview
  - Built-in profiles: dark, light
  - Switching themes with optional view transitions
- Motion mode selector:
  - Off / Minimum / Reduced / Full
  - Respects OS `prefers-reduced-motion` as initial default
  - Controls motion components (`RevealOnScroll`, `StaggerList`, etc.)
- "Fancy effects" toggle:
  - Glows on/off
  - 3D card tilt on/off (roster cards)
  - fancyEffects preference stored in localStorage
- "Push notification sound" toggle:
  - Enable/disable audio feedback for push notifications
  - pushNotificationSound preference stored in localStorage

### 2. Language

- Localization selector (dropdown): English / Chinese (expandable later)
- All date/time displays use local time (data stored UTC)
- String keys MUST be centralized (no hardcoded UI strings)


## Theme Integration

- Mantine ThemeProvider at app root for theme context
- Theme switching with optional view transitions
- Built-in theme profiles: dark, light
- Components use Mantine theme tokens — never hardcode colors, spacing, or shadows
- Persistence: localStorage (no D1 persistence for theme)
- Runtime switching (no reload)


## Localization Controller Requirements

- Central I18nController:
  - Current locale (e.g., `en`, `zh`)
  - String lookup by key
  - Locale-aware formatting helpers (date/time/number)
  - Persistence: localStorage
- No hardcoded user-facing strings
- Dates stored UTC, localized for display only


## Permissions

| Action | External | Member | Moderator | Admin |
|--------|----------|--------|-----------|-------|
| Change theme | Yes | Yes | Yes | Yes |
| Change language | Yes | Yes | Yes | Yes |
| All settings | Limited | Yes | Yes | Yes |

## Error Handling

- If localStorage is unavailable (private mode / blocked storage), keep settings in memory for current session and show a non-blocking warning.
- If theme profile key is invalid or missing, fallback to default theme profile and log a client warning.
- If locale key is invalid, fallback to `en` and re-render UI strings safely.
- If runtime theme switch fails, keep previous theme and show toast: "Could not apply theme, reverted."

## Security

- Settings page stores no secrets, tokens, or credentials.
- Only preference keys are persisted locally (theme, motion mode, locale, fancy-effects toggle).
- Never trust client-side role checks for privileged behavior; role gating is UI-only and must remain server-enforced elsewhere.
- Sanitize any user-visible dynamic labels before render if they are ever sourced from external data.

## Freshness

- Settings are client-side only: apply immediately on change (no polling, no push).
- Rehydrate from localStorage on app boot before first paint when possible to avoid theme/locale flash.
- Recompute dependent UI (dates, numbers, motion mode) immediately after locale/theme changes.

