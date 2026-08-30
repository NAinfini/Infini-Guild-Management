# Authentication, account linking, and messaging roadmap

> Status: Phase 0–3 is included in the `v0.1.0` source release. Deployment remains an explicit operator action. [README.md](../README.md), [SETUP.md](./SETUP.md), and [SECURITY.md](./SECURITY.md) remain the operational references.
>
> [Documentation home](../README.md) · [中文版本](./AUTHENTICATION.zh.md)

## Final product decision

Infini Guild Management will keep a zero-dependency local sign-in path while separating private credentials from public identity.

| Area | Decision |
| --- | --- |
| Membership creation | Invite-only. |
| Registration | One 10-character uppercase alphanumeric invite code (also shareable as a registration link), private login name, public display name, password, and password confirmation. No OAuth, email, or phone step. |
| Default sign-in | Private login name plus password. This works without any external account or service. |
| Public identity | The display name appears on the roster and elsewhere in the portal. Authentication never queries the display-name field. |
| OAuth | Google, Discord, and KOOK are optional, individually configured enhancements. One internal account may link multiple providers, and any linked provider signs into that same account. WeChat has a reserved Site Config flag but is deliberately unavailable pending official-rule verification. |
| Email | Optional verified contact information added from the member's profile. It is not required for registration or local sign-in. |
| Phone messaging | Optional and provider-dependent. It is not registration, primary sign-in, or the sole recovery factor. No provider has been selected. |
| Recovery | Permission-gated, audited administrator credential reset. Saved recovery codes are intentionally excluded. |
| Service ownership | Every deployment owner supplies and pays for their own provider accounts, domains, credentials, quotas, and compliance. The project operates no shared gateway. |

The project should **not remove local login-name-and-password sign-in** in this phase. Requiring email would be a poor default for some Chinese guild members, while OAuth-only sign-in would make a self-hosted installation depend on external applications that the site owner must register and maintain. Local credentials preserve the setup-and-go baseline; optional OAuth improves convenience and reduces password use for members who link it.

Separating the public display name from the private login name is worthwhile, but the login name is not a secret or a second factor. It reduces opportunistic guessing and credential stuffing only after a member chooses a login value that is no longer publicly displayed; migrated accounts initially retain their already-known value. Strong passwords, caller-scoped throttling, generic failures, session security, and safe recovery remain the actual security controls. Invite-only registration limits unauthorized account creation, not attacks against existing accounts.

## Identity vocabulary and invariants

- **Internal user ID** is the only durable owner key used by roles, profiles, content, audit records, sessions, and external identities.
- **Login name** is private account data used only by the local authentication and credential-management flows. It must never appear in roster, profile, search, analytics, audit labels, URLs, browser telemetry, or ordinary administrator member lists.
- **Display name** is public guild identity. For the first implementation it remains case-insensitively unique, preserving the current roster behavior, but it has no authentication meaning.
- **Password** is always stored as a self-describing one-way hash. Plaintext passwords and temporary credentials are never persisted or logged.
- **External identity** is a provider plus that provider's stable subject identifier. Provider nicknames and email addresses are presentation/contact claims, not identity keys.
- **Email and phone** are optional verified contacts, not automatic account-linking keys.
- Every protected identity mutation writes its audit event in the same database transaction as the mutation.

The registration UI should explain that the login name is private and recommend using a value different from the display name. Equality is allowed and the server does not reject it, but the member then gives up the privacy benefit of the split.

## User journeys

### 1. Invite registration

1. A guild administrator creates one 10-character uppercase alphanumeric invite code under the existing invite policy. The database stores that code directly, and authorized administrators can view it again.
2. The administrator may share the code for manual entry or a registration link containing the same code. The registration page then asks for the login name, display name, password, and password confirmation.
3. The server normalizes the invite code to uppercase and validates it before performing an availability check or password hashing.
4. One transaction consumes the invite link, creates the internal user, creates local credentials, creates the profile, and writes the registration audit event. A collision or unavailable invite consumes nothing.
5. Registration creates a normal session. OAuth, email, and phone are not shown in this flow.

OAuth must never turn an unlinked visitor into a member. Invite redemption remains the only registration path in this roadmap.

### 2. Local sign-in

The sign-in form treats the submitted value only as a login name and queries the credential record, never the display-name field. All invalid combinations return the same public response. If a member deliberately chose identical values, that text can authenticate because it is also their login name, not because display-name login is supported.

If an administrator issued temporary credentials, successful proof creates only a restricted password-change session. The member must choose a permanent login name/password as required before the portal grants a normal session.

### 3. OAuth sign-in

The sign-in page renders a button only for an implemented provider when it is enabled in Site Config and its runtime credentials are complete. After a valid provider callback:

- a linked `(provider, subject)` signs into exactly the same internal account every time;
- an unlinked subject does not create or merge an account and receives a generic instruction to sign in locally and link it from the profile;
- a disabled, deleted, or otherwise policy-blocked internal account is still rejected by local policy; and
- the application discards provider access and refresh tokens after reading the identity unless a future, separately approved feature truly needs them.

A member may link every implemented provider enabled by the site owner. Each linked provider is an independent way to authenticate the same internal user ID and therefore reaches the same role, profile, content, and sessions policy. WeChat is not an implemented provider and never renders a button or accepts a callback in this release.

### 4. Profile and security management

An authenticated member can:

- change the private login name;
- change the public display name;
- change the password;
- link or unlink one Google, Discord, or KOOK identity each when that provider is enabled;
- add, replace, verify, or remove an email address when email is enabled; and
- manage a phone contact only after a concrete messaging provider is implemented and configured.

Changing the login name, changing the display name, changing the password, linking or unlinking OAuth, and adding, resending, or removing a verified contact require the member's current local password in that request. This is direct reauthentication, not a time-based “recently authenticated” flag. These password checks are rate-limited by both internal user ID and trusted client source. Authentication-factor changes increment the account authentication revision and invalidate older sessions; changing only the display name does not.

### 5. Administrator recovery

Ordinary member recovery remains human-mediated and does not depend on email or OAuth:

1. An administrator with the credential-reset permission supplies their own current password in the reset request.
2. The reset transaction atomically installs a random temporary login name and password, marks the password single-use with a short expiry, increments the target authentication revision, revokes all target sessions and linked OAuth identities, invalidates unfinished OAuth link challenges, and writes the audit event.
3. The temporary login name and plaintext password are returned once and never stored in plaintext. At first use, the member receives only a restricted session and must set a permanent login name and password.
4. The administrator never receives the former private login name.

The final owner cannot depend on an ordinary web administrator for recovery. Both runtimes need a documented, local maintenance command that can rotate the final owner's credentials with direct host/Cloudflare deployment authority. This path remains independent of email and OAuth, protects the last active owner invariant, and is audited where the database is available. There are no saved recovery codes.

## Target data model

This is a conceptual contract; Drizzle schema modules remain the relational source of truth when implemented.

| Table | Required target fields and constraints |
| --- | --- |
| `users` | Existing user ID and membership fields plus `display_name`; case-insensitive unique display-name index for the first release. The old `username` column is removed. No login name, email, phone, or provider subject appears in public user read models. |
| `user_credentials` | `user_id` primary/foreign key, `login_name`, `password_hash`, `auth_revision`, `temporary_password_expires_at`, `temporary_password_used_at`, and timestamps. Case-insensitive unique login-name index. A temporary credential is represented by its expiry/used fields without a duplicate forced-change flag. |
| `external_identities` | ID, user ID, provider enum, provider subject, created/last-used timestamps. `UNIQUE(provider, provider_subject)` and, initially, `UNIQUE(user_id, provider)`. |
| `sessions` | Token digest, user ID, expiry/creation time, session scope (`normal` or `password_change`), and the authentication revision captured when the session was issued. Revision mismatch invalidates the session. |
| `invite_links` | A directly stored, case-insensitively unique 10-character uppercase alphanumeric code, creator and assigned-role IDs, bounded use count, expiry, creation time, and optional revocation time. Authorized invite-list responses include the code. |
| `oauth_challenges` | Random state digest, provider, purpose (`login` or `link`), optional target user ID, nonce/PKCE material, expiry, and consumed time. Short-lived and single-use. |
| `user_emails` | One email per user in the first release, normalized email with a uniqueness constraint, verified timestamp, and update time. It is never an implicit login identity. |
| `email_verification_challenges` | User ID, pending normalized email, random token digest, expiry, consumed time, and bounded send/resend metadata. There is no unused challenge-purpose field. |
| `site_config` | Four non-secret OAuth enable flags, one each for Google, Discord, KOOK, and WeChat, all defaulting to false. Credentials are never stored here; the WeChat flag is reserved and cannot become effectively enabled until an official adapter is verified. |

Do not add a provider-token table, a generic central identity broker, an unused SMS abstraction, or duplicate runtime-specific identity models. Add an exact messaging port only when a concrete second delivery provider exists. All ownership continues to point to the internal user ID.

## OAuth account-linking contract

Every implemented provider follows one account-linking policy even though protocol details differ:

1. Linking starts only from an authenticated profile/security page and requires the current local password in the start request.
2. The authorization request uses high-entropy `state`, OIDC `nonce` where applicable, PKCE where supported, a short expiry, single-use challenge storage, and an exact configured redirect URI.
3. The callback atomically validates state plus a short-lived HttpOnly browser-transaction cookie, then validates issuer/audience where applicable, nonce, PKCE, provider errors, and the stable subject before touching account links. A callback copied into another browser cannot replace that browser's session.
4. Link insertion and its audit event are atomic. If `(provider, subject)` already belongs to another user, linking fails without identifying that user.
5. Repeating an OAuth sign-in for the same link creates a session for the same internal user; it never creates a duplicate account.
6. Email equality, display-name equality, or provider nickname equality never merges accounts.
7. Unlinking is audited, requires the current local password, increments the authentication revision, and invalidates older sessions. Local credentials remain, so unlinking cannot remove the last sign-in method in this phase.

Stable identity keys must come from the provider: Google `sub`, Discord user ID, and KOOK user ID. Changing an OAuth application/client can change the subject namespace and therefore requires an explicit migration; silently switching credentials is unsafe.

### WeChat stop condition

The repository carries the `wechat` provider enum and false-by-default Site Config column so a later verified migration does not need another provider-model change. Official WeChat callback and token rules could not be verified from accessible official documentation during this work. Therefore no token/callback adapter exists, runtime availability is always false, and the application rejects an attempt to enable it. It must not be presented as a working sign-in or linking option until an implementation is checked against the official rules.

Each provider requests only identity scopes. The implementation must not request guild, messaging, contacts, or other unrelated permissions.

## Password, login, and session security

### Password policy and hashing

The current code writes self-describing PBKDF2-HMAC-SHA256 hashes with a default and minimum of 10,000 iterations. This default is kept for the Cloudflare Workers CPU limit; a site owner may explicitly configure up to 10,000,000 after measuring the target runtime. Login verification spends one fixed configured PBKDF2 budget for unknown, unusable, malformed, lower-cost, and current-cost credentials. A stored hash above the configured budget is not authenticated, so a deployment that has written higher-cost hashes must not be lowered without first migrating those credentials.

Implementation requirements:

- benchmark the lowest supported Cloudflare and VPS environments and choose the highest safe configured cost;
- retain algorithm/cost metadata and rehash after successful login only when the configured cost increases;
- never lower a stored hash cost;
- require 8 to 128 characters, at least one uppercase letter, one lowercase letter, and one punctuation/symbol character for new passwords; permit spaces and Unicode, but do not count spaces as special characters; reject the bounded common-password denylist; and
- rehash structurally valid lower-cost hashes immediately after successful verification without adding a second authentication path.

Site owners with additional measured Workers or VPS CPU budget may raise the PBKDF2 setting explicitly. A future move to another password hash must be runtime-neutral and use the self-describing migration path; Cloudflare and VPS must not silently implement different authentication strength.

### Brute-force and enumeration controls

- Apply both an IP-wide limiter and a client/IP-plus-login-name limiter before expensive work.
- Spend one fixed PBKDF2 iteration budget for every credential attempt so account state and stored hash cost do not create a timing oracle.
- Return the same credential error for unknown, disabled, deleted, expired-temporary-password, and wrong-password accounts.
- Do not create an account-wide cooldown or an administrator lock-reset path; those expose shared account state and permit targeted denial of service.
- Rate-limit invite verification, registration, OAuth starts/callbacks, email sends/resends, and every current-password verification. Email verification tokens are high-entropy, single-use, user-bound values rather than guessable codes.
- Do not expose a public private-login-name availability endpoint. Registration may return a field conflict only after validating a live invite; display-name availability may remain public because display names are public.

### Session and sensitive-action controls

Keep HTTP-only, same-site cookies, rolling and absolute expiry, a bounded session count, CSRF/origin protections, and authentication-revision invalidation on credential or account-state changes. HTTPS uses `__Host-ig_session` and `__Host-ig_session_oauth_transaction`, both with `Secure`, `Path=/`, and no `Domain`; plain HTTP development uses the unprefixed local cookie. OAuth callbacks retain state and browser-cookie validation. Never put session tokens, invite codes, OAuth tokens, verification tokens, or temporary credentials in logs.

## Optional service configuration

OAuth uses a two-part gate:

1. The site owner turns each provider on or off independently in Site Config. All four flags default to off.
2. The runtime supplies that provider's client ID/secret and callback prerequisites through deployment configuration.

An implemented provider is effectively enabled only when its Site Config flag is on and its runtime configuration is complete. The public authentication-capabilities response exposes only this effective state, so the login page cannot render a broken button. The reserved WeChat flag is always effectively disabled.

- Site Config off with no credentials: disabled; local sign-in remains intact.
- Site Config off with complete credentials: configured but disabled until the owner turns it on.
- Site Config on with complete credentials: enabled.
- A partial credential pair: `config:check` and startup fail with a specific non-secret error.
- Site Config on with missing credentials: enabling is rejected; if a complete credential pair is later removed, that provider fails closed and disappears from public capabilities while local sign-in and the administration UI continue.

The non-secret enable flags belong in Site Config and are permission-gated and audited. Provider credentials live only in Wrangler secret storage or a protected VPS environment file. They never belong in Site Config, D1/SQLite settings, client bundles, API responses, or repository examples with real values. Runtime validation rejects partial pairs; `config:check` prints the exact redirect URLs the owner must register without printing credentials.

| Capability | Site-owner setup | Application behavior |
| --- | --- | --- |
| Google | Site Config flag plus owner-created OAuth/OIDC client, client ID/secret, exact callback | Optional linked sign-in using OIDC `sub` |
| Discord | Site Config flag plus owner-created application, client ID/secret, exact callback | Optional linked sign-in using Discord user ID |
| KOOK | Site Config flag plus owner-created application, client ID/secret, exact callback | Optional linked sign-in using KOOK user ID |
| WeChat | Reserved Site Config flag only | Unavailable: no adapter, callback route, or login/link button until official rules are verified |
| Email | Owner's Cloudflare account, onboarded domain, sender, and runtime-specific binding/token | Optional profile verification and transactional notices |
| Phone messaging | A future owner-selected provider and its own credentials/costs | Disabled until a provider and exact threat model are approved |

There is deliberately no Infini Gateway, shared OAuth application, shared Cloudflare token, shared sending domain, shared SMS account, or project-paid quota. Avoiding provider registration would require the project to operate a central identity/messaging service, accept cross-instance availability and breach risk, process other deployments' identity traffic, and pay their costs; that model is rejected.

## Email confirmation on Cloudflare and VPS

Registration does not send email. When email is enabled, a signed-in member adds or replaces an address from the profile:

1. The server creates a high-entropy, expiring, single-use verification token and stores only its digest with the pending address.
2. The runtime sends a bilingual transactional message. A provider/API failure is reported; the application must not claim that mail was sent.
3. The link carries the token in the URL fragment so it is not sent in the initial request or a referrer, then opens a same-origin confirmation page. Verification is consumed by an explicit protected `POST`, not a state-changing `GET` that mail scanners can trigger.
4. Successful consumption atomically installs the verified address and writes the audit event. A new address does not replace an existing verified address until it succeeds.
5. Resend and attempt limits apply per user, address, and client. Responses do not reveal whether an address belongs to another account.

Email is initially a verified contact and notification channel, not a login name, automatic merge key, registration gate, or sole password-recovery path.

| Runtime | Recommended integration | Owner responsibility |
| --- | --- | --- |
| Cloudflare | Native Cloudflare Email Service `send_email` binding | Enable Email Sending, onboard the domain/sender, use Workers Paid for arbitrary recipients, and bind the sender. No API token is needed by application code. |
| VPS | HTTPS Cloudflare Email Sending REST API | Supply the Cloudflare account ID, a scoped `Email Sending: Edit` API token, and an onboarded sender domain. The VPS calls Cloudflare over TLS; it does not run a mail server. |
| SMTP on VPS | Not implemented in this release | Cloudflare offers SMTP submission, but the shipped VPS adapter uses the REST API only. Do not configure SMTP and assume the application will use it. |
| No email configuration | None | Email UI and sends stay disabled; invite registration, local login, and administrator recovery continue to work. |

Running Postfix or another MTA on the VPS is technically possible but is not bundled or recommended: the owner would inherit reverse-DNS, blocked-port, SPF/DKIM/DMARC, bounce, abuse, reputation, and deliverability operations. A future generic SMTP relay adapter may be accepted for owners who already operate a relay, but it must not become the default or run inside the Node process.

Cloudflare Email Service requires the sending domain to be onboarded in the site owner's Cloudflare account with the required Cloudflare-managed DNS records. As verified on 2026-08-22, arbitrary-recipient Cloudflare Email Sending requires Workers Paid. Workers Paid has a USD $5/account/month minimum; Email Sending includes 3,000 messages/account/month and then costs $0.35 per 1,000. These are account-level quotas, including for a VPS using the REST API, so every independent site uses its own account and token. Email Sending is currently Beta and must not be the only recovery path. Email Routing is inbound forwarding and is not a substitute for Email Sending.

## Phone messaging boundary

Phone messaging remains an optional later phase, not an empty adapter shipped now. Before implementation, select a provider that supports the deployment's countries, sender-registration rules, pricing, and data-handling requirements. The owner then supplies that deployment's account and credentials.

If the channel is SMS/PSTN, normalize verified numbers to E.164, store verification state separately, use short-lived limited-attempt codes, and apply send/verify abuse limits. Do not use SMS as the preferred or only administrator factor: NIST classifies PSTN out-of-band authentication as restricted. Passkeys or authenticator-app TOTP are better future setup-and-go second-factor candidates because the project does not need to operate a messaging service.

## Migration from the current schema

The released `0000_core.sql` baseline stays frozen. Implement the change with the next contiguous migration and the exact migration-manifest entry, using identical SQL bytes for D1 and VPS SQLite.

1. Create `users.display_name` and `user_credentials.login_name` as migration staging fields.
2. Copy every current `users.username` value into both fields without changing its text. Existing password hashes remain unchanged.
3. Make the new fields required, recreate their case-insensitive unique indexes, and rebuild the affected SQLite tables so the old `users.username` column is removed. The final schema has one display-name source and one login-name source, not three parallel fields.
4. Existing members keep signing in with their current username because that value is now their real `login_name`. There is no forced rotation, restricted migration session, or compatibility fallback. The site owner will notify members; they may later change their login name and display name independently from their profile. Once a login name changes, the old value stops working because authentication has only one lookup field.
5. Change all public read models, search, roster, profile links, selectors, and audit labels to `display_name`. Return `login_name` only from the authenticated member's security endpoint.
6. Replace or remove `/api/auth/check-username`; never repurpose it into an unauthenticated login-name enumeration endpoint.
7. Retire persistent login-lock enforcement and its administrator reset endpoint. Migration `0013_remove_login_failures` drops the obsolete trigger and table completely.
8. In the OAuth phase, create provider enable flags with false defaults and create empty external-identity/challenge tables; do not fabricate links for existing members. In the email phase, create empty email/challenge tables; do not fabricate addresses or verification state. Local password sign-in remains complete before any member links OAuth or adds email.
9. Extend audit action contracts and SQL invariants with each shipped phase. Keep protected mutation plus audit atomic.
10. Prove migration, backfill, old-column removal, index, constraint, trigger, and schema parity in Node SQLite and local workerd D1 before any protected remote migration.

No deployment may apply the remote migration without explicit authorization, a verified backup, and a tested recovery path.

## Implementation plan

### Phase 0 — close current security gaps

- Apply IP-wide plus IP/login-pair throttling before account lookup and PBKDF2.
- Remove persistent account cooldowns and use fixed-budget verification plus generic failures.
- Apply the shared 8-to-128-character password policy for registration/change/reset, the bounded weak-password denylist, visible form guidance, generic failure responses, and tests.
- Make administrator reset revoke sessions and OAuth links; require the administrator's current password, temporary expiry, single-use/forced-change state, authentication-revision rotation, and atomic audit.

**Exit:** focused service/route tests pass, throttled requests perform neither account lookup nor PBKDF2, and both runtimes enforce the same behavior.

### Phase 1 — split login name and display name

- Add the contiguous migration, shared schemas, store/service contracts, transport routes, and bilingual UI.
- Update registration to the five fields in this decision, with no OAuth/email/phone controls.
- Update login, profile security controls, roster/public APIs, admin reset, and audit presentation.
- Update first-owner bootstrap, administrator-created users, development seeds, end-to-end fixtures, and the private owner-recovery path to the new identity contract.
- Remove private-name enumeration and test that public payloads never contain login names.

**Exit:** a new invite atomically creates separate login-name and display-name fields, which may contain the same value; every existing account has both values backfilled from the old username and can sign in immediately; the old `username` column is absent; authentication never queries `display_name`; Cloudflare and VPS schema/behavior parity passes.

### Phase 2 — optional OAuth linking and sign-in

- Implement one runtime-neutral identity-linking service and explicit provider adapters for Google, Discord, and KOOK. Keep WeChat as an unavailable reserved provider until its official rules are verified.
- Add false-by-default Site Config flags, challenge and initially empty external-identity persistence, strict credential validation, profile link/unlink controls, and effective-enabled-only login buttons.
- Add callback, replay, collision, disabled-account, session, and audit tests. Test that equal emails never merge accounts and repeated provider use never duplicates an account.
- Document exact site-owner console setup and callback URLs in both setup guides.

**Exit:** every implemented provider can be independently switched in Site Config; a button appears only when its flag and credentials are ready; partial credentials fail validation and an enabled provider with missing credentials fails closed; WeChat remains effectively disabled; an unlinked OAuth subject cannot register; one subject maps to one internal account across both runtimes.

### Phase 3 — optional verified email

- Add the runtime-neutral transactional-email port, Cloudflare binding adapter, VPS REST adapter, initially empty email/challenge schema, profile UI, templates, rate limits, and configuration checks.
- Keep email out of registration, login identity, automatic merging, and sole recovery.
- Add delivery-error, scanner-safe confirmation, expiry, replay, resend, privacy, and cross-runtime tests.
- Document Workers Paid/account-level pricing as dated external information and keep the no-email path first-class.

**Exit:** an installation with no email config is unchanged; a configured owner can verify a profile email; failures are explicit; project credentials and costs are never shared.

### Phase 4 — future hardening, separately approved

- Prefer passkeys and/or authenticator-app TOTP before considering SMS as an authentication factor.
- Implement phone verification/messaging only after choosing and threat-modeling a real provider; keep it owner-funded and optional.
- Consider an owner option to disable local password sign-in only after safe enrollment, last-owner protections, provider-health checks, and a tested local recovery command exist. It is not part of the current design.

## Required validation

For every shipped phase, use the narrowest focused tests plus the repository release gates appropriate to the change:

- schema/migration parity and invariant tests on Node SQLite and local workerd D1, including exact username backfill, old-column removal, false OAuth defaults, and empty OAuth/email identity data;
- service tests for transactions, uniqueness, caller-scoped throttling, replay, session revocation, and audit atomicity;
- transport tests for parsing, generic errors, origins/CSRF, cookie behavior, and configured-only routes;
- bilingual Portal component/e2e tests for registration, existing-account login after migration, temporary-password change, profile management, and keyboard/accessibility behavior;
- configuration tests for disabled, complete, partial, and secret-redaction cases;
- `git diff --check`, typecheck, focused tests, both runtime builds/config checks, and `release:check` before release preparation; and
- no production identifiers, secrets, tokens, private migrations, local databases, or provider fixtures in version control.

Stop rather than ship when a provider's stable-subject or callback rules cannot be verified from official documentation, a protected migration lacks a backup/recovery rehearsal, Cloudflare and VPS behavior diverges, or recovery could lock out the final owner.

## Official references

- [Cloudflare Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Email Sending REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
- [Cloudflare Email Sending Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Cloudflare Email Sending SMTP](https://developers.cloudflare.com/email-service/api/send-emails/smtp/)
- [Cloudflare Email Service domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/reference)
- [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2)
- [KOOK OAuth2](https://developer.kookapp.cn/doc/oauth2)
- [WeChat Open Platform website login](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html) (reference retained; its rules were not verified for the current implementation, so WeChat remains unavailable)
- [NIST SP 800-63B authenticators](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
