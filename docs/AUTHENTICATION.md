# Authentication and account security

[Documentation home](../README.md) · [中文版本](./AUTHENTICATION.zh.md)

This document describes the authentication behavior shipped in `v1.0.0`. Operational configuration belongs in [SETUP.md](./SETUP.md), and vulnerability handling belongs in [SECURITY.md](./SECURITY.md).

## Account model

- The internal user ID is the durable owner key for roles, profiles, content, sessions, audit records and linked identities.
- A private login name is used only for local authentication and credential management. A separate display name appears in member-facing interfaces.
- Registration requires a valid invitation code. OAuth cannot create an uninvited member.
- Local credentials remain available even when external sign-in providers are configured.
- Site Config owns the public site name and guild logo shown on login, registration, recovery, verification and status pages. Uploaded site media takes precedence over the deployment default.

## Supported flows

### Invitation registration

The visitor verifies an invitation, then submits a unique login name, display name and new password. One transaction consumes the invitation and creates the user, credential, profile and audit record. A collision or unavailable invitation consumes nothing.

### Local sign-in and sessions

Login accepts the private login name and password and returns only a generic credential failure for unknown, unusable and incorrect accounts. The “stay signed in” choice selects the documented session lifetime. Session tokens are random, stored only as digests and sent in HTTP-only cookies.

The browser coordinates login, registration, forced password completion and logout through Web Locks. These flows require HTTPS in deployments or localhost during development. Session revisions prevent stale cross-tab responses from restoring an earlier identity.

### Password and login-name changes

An authenticated member may change the private login name or password after supplying the current password. Successful security changes increment the authentication revision and invalidate older sessions as defined by the service.

Every new password uses the same policy:

- 8–128 characters;
- at least one Unicode uppercase letter;
- at least one Unicode lowercase letter; and
- at least one special character other than a space.

Numbers are optional. There is no common-password collection. The Portal localizes and displays the same rules enforced by the shared schema and service.

### Administrator credential reset

An authorized administrator must confirm their own current password. The reset installs a random temporary login name and password, expires after 15 minutes, is single-use and forces the target member to choose a permanent password. It also rotates the target authentication revision, revokes existing sessions and linked OAuth identities, invalidates pending link challenges and writes the audit event atomically.

The final owner recovery path is an operator maintenance procedure documented in [SETUP.md](./SETUP.md); it does not depend on saved recovery codes, email or OAuth.

### Optional OAuth

Google, Discord and KOOK adapters are available when both Site Config and complete deployment credentials enable the provider. One internal account may link multiple providers after current-password confirmation. Linking never merges accounts by email. Unlinking requires the current local password and invalidates older authentication state.

WeChat is reserved in the shared provider model but remains unavailable. The server rejects attempts to enable it until an implementation is verified against official rules.

### Optional verified email

When a mail provider is configured, a member may add, verify, replace or remove a contact email after current-password confirmation. The server stores only a digest of each expiring single-use verification token. Verification tokens stay in the URL fragment and short-lived session storage so they do not enter ordinary query logs or browser history.

Email is contact information. It is not a login name, invitation substitute, automatic account-merge key or required recovery channel.

## Password hashing and login protection

Passwords use the self-describing format `pbkdf2-sha256$iterations$salt$hash` with a 16-byte random salt and a 256-bit derived key. The default and minimum configured cost is **10,000 iterations**, selected for the Cloudflare Worker CPU budget. An operator may explicitly raise it only after measuring the target runtime; the allowed maximum is 10,000,000.

Login spends one fixed configured derivation budget even when the account is missing or its stored hash is unusable. A valid lower-cost hash is upgraded after successful login. A stored hash above the configured budget is not authenticated, so operators must migrate stronger hashes before lowering a previously raised setting.

Source-wide and source/login-pair throttles run before account lookup and PBKDF2 work. The product intentionally has no persistent account cooldown or administrator lock-reset screen.

## Request and session security

- Mutations require an allowed `Origin` and `X-Requested-With: XMLHttpRequest`.
- Authentication, invitation, OAuth and email flows have purpose-specific rate limits.
- OAuth uses expiring single-use state, PKCE where supported and a browser-bound HTTP-only transaction cookie. Provider tokens are discarded after identity resolution.
- Protected identity mutations and their audit events commit in the same database transaction.
- Backend authorization is authoritative; route and component guards only shape the interface.
- Login names, password material, session tokens, OAuth tokens and verification tokens must not appear in public APIs, URLs, analytics or logs.

## Configuration boundary

Non-secret provider switches live in Site Config. OAuth client secrets and mail credentials live only in Wrangler secret storage or a protected VPS environment file. Partial credential pairs fail configuration validation; public capabilities expose availability without exposing credentials.

Cloudflare and VPS compose the same authentication services and contracts. Runtime adapters provide outbound provider calls, cookies and storage ports; they do not implement different account policy.

## Required validation

Changes to authentication must cover the affected shared schema, service transaction, route, both runtime compositions and Portal flow. Include focused negative checks for generic failures, throttling order, replay, collisions, session invalidation, audit atomicity and secret redaction. Run the release checks described in [CONTRIBUTING.md](./CONTRIBUTING.md) before publishing a release candidate.
