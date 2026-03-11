# Auth — Login / Session / Registration (`/login`, `/register/:inviteCode`)

@FEATURE: AUTH
@ROLE: All (login required for mutations)

## Summary

Username + password login, HttpOnly cookie sessions, and invite-link-based registration. No open registration — new members join via Admin-generated invite links.

## Access

- External: can browse read-only pages without login
- Members/Admin/Mod: login required for all mutations and protected pages
- Unregistered users with valid invite link: can access registration page only

## Login Page

### Layout

Minimal centered card:
- Username field
- Password field
- Login button
- "Stay logged in" checkbox

### UX Requirements

- **Show/hide password** (eye icon toggle)
- **Caps Lock warning** when detected
- **Loading state:** login button becomes spinner + disabled; inputs disabled during request
- **Error states:** inline banner area (keeps layout stable); generic "Invalid credentials" (no username probing)
- **Return-to handling:** preserve `returnTo` URL from redirect; on success, redirect back (else Dashboard)
- **Rate limit feedback:** "Too many attempts, try again in X seconds"; never reveal whether username exists

### Stay Logged In

- If selected: session persists for 30 days
- If not: session is browser-session only (ends when browser session is closed)

## Session Rules

- HttpOnly cookie session (Worker issues cookie)
- Client stores no password, ever
- All privileged requests require session cookie
- Session expiry mid-action: preserve form state, redirect to login with `returnTo`, allow re-submit after re-login

### Session Timeout Behavior

- When session expires (cookie TTL exceeded or server invalidates):
  1. Next API call returns `401 UNAUTHORIZED`
  2. Client preserves current form state in memory
  3. Redirect to `/login` with `returnTo` query param set to current page
  4. Show banner: "Session expired. Please log in again."
  5. After successful re-login, redirect back to `returnTo` URL
- No background session heartbeat — expiry is detected on next API call only

## Logout

- Located in top-right profile dropdown
- Clears session cookie
- Also available on My Profile page

## Password Storage (D1)

### Table: `user_auth_password`

- `password_hash` — hashed password
- `salt` — per-user salt
- `updated_at` — last change timestamp

## Rate Limiting

- Login: rate limit by username + IP bucket (Worker-side)
- UI: "Too many attempts, try again in X seconds"
- Never reveal if username exists
- Generic error messages only

## Password Reset Policy

- No self-service password reset (no "forgot password" flow)
- Admin resets passwords manually via Admin Console → Member Management → Member Detail → Admin Actions tab
- Admin sets a temporary password; member changes it in My Profile → Account tab after next login
- Password reset is audited (entity_type: `user`, action: `password_reset`)

## Security

- Rate limit login attempts at Worker level
- Generic error messages ("Invalid credentials")
- Audit: record password resets and role changes
- Do NOT record login success/failure spam
- HttpOnly, Secure, SameSite cookie attributes

## Post-Login Flow

- Redirect to Dashboard (default)
- Or redirect to `returnTo` URL if user was redirected from a protected page

## Post-Logout Flow

- Clear session cookie
- Redirect to login page (or public dashboard if External view is enabled)

---

## Invite Link Registration (`/register/:inviteCode`)

@FEATURE: INVITE_REGISTRATION

### Flow

1. Admin creates bulk invite link in Admin Console (N uses, default expiry 7 days)
2. Admin shares link URL: `https://{domain}/register/{inviteCode}`
3. New member opens link → system validates invite code
4. If valid: show registration form (username + password + confirm password)
5. On submit: create account as `member` role, increment `used_count`, auto-login, redirect to Dashboard
6. If invalid/expired/exhausted: show friendly "This invite link is no longer valid" page with no further action

### Registration Page Layout

Minimal centered card (same style as login):
- Invite status banner: "You've been invited to join [Guild Name]"
- Username field (3-50 chars, unique check on blur)
- Password field
- Confirm password field
- Register button

### UX Requirements

- Show/hide password toggle (same as login)
- Real-time username availability check (debounced 500ms)
- No password policy hints in v1
- Loading state on submit
- Error states: "Username already taken", "Passwords don't match", "Invite link expired"
- On success: auto-login + redirect to Dashboard + welcome toast

### Invite Link Data Model (D1)

```sql
CREATE TABLE invite_links (
  id TEXT PRIMARY KEY,          -- nanoid
  code TEXT UNIQUE NOT NULL,    -- short URL-safe code (nanoid, 12 chars)
  created_by TEXT NOT NULL,     -- admin user_id
  max_uses INTEGER NOT NULL,    -- how many times this link can be used
  used_count INTEGER DEFAULT 0,
  expires_at TEXT,              -- ISO timestamp, default 7 days from creation (nullable if admin clears)
  created_at TEXT NOT NULL,
  revoked_at TEXT               -- nullable, set when admin revokes
);
```

### Validation Rules

- `code` must be URL-safe (alphanumeric + hyphen)
- `max_uses` must be >= 1
- `used_count < max_uses` to allow registration
- `expires_at` must be in the future (if set)
- `revoked_at` must be null
- Username: 3-50 chars, alphanumeric + underscore, unique
- Password: no length/complexity policy in v1 (must be non-empty and match confirm password)

### Security

- Rate limit registration by IP (prevent brute-force invite code guessing)
- Invite codes should be long enough to prevent guessing (12+ chars)
- Registration endpoint validates invite code server-side before accepting form data
- No information leakage: invalid codes get same generic error as expired ones


## Permissions

| Action | External | Member | Moderator | Admin |
|--------|----------|--------|-----------|-------|
| View login page | Yes | Yes | Yes | Yes |
| Login | N/A | Yes | Yes | Yes |
| Logout | N/A | Yes | Yes | Yes |
| Register via invite | Yes (with valid link) | N/A | N/A | N/A |
| Create invite links | No | No | No | Yes |
| Revoke invite links | No | No | No | Yes |

## Audit

- Password resets: logged
- Role changes: logged
- Invite link creation/revocation: logged
- New member registration: logged (entity_type: `user`, action: `register`)
- Login/logout: NOT logged (no spam)
