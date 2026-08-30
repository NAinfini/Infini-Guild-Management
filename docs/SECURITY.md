# Security policy

[Documentation home](../README.md)

## Supported version

Security fixes go to the latest `main` branch and ship in the next tagged release. We do not backport fixes to older tags.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use this repository's **Security → Advisories → Report a vulnerability** flow. Please include:

- the affected route, page, or configuration;
- the impact and the shortest reproduction steps;
- whether credentials, private guild data, or real user data could be exposed; and
- a suggested fix, if you have one.

Do not include real passwords, session cookies, live invite codes, Cloudflare API tokens, private guild data, or production database exports. Resource names, D1/R2 identifiers, and routes in `wrangler.jsonc` are configuration identifiers, not authentication secrets. That file is untracked, so the repository never publishes them, but you may still redact identifiers you do not want to share.

Maintainers will acknowledge complete reports, assess severity, and coordinate a fix before public disclosure. Repository owners must enable GitHub private vulnerability reporting before making a fork public.

## Security boundaries in the product

- Backend permission checks are authoritative. Client-side guards only shape the interface.
- Sessions use HTTP-only cookies. Mutations require origin validation and `X-Requested-With`; sensitive route groups have dedicated rate limits.
- Passwords use self-describing PBKDF2-SHA256 hashes. `IG_PBKDF2_ITERATIONS` defaults to 10,000 for the Cloudflare Workers CPU limit and may be explicitly raised to 10,000,000 after runtime measurement. Login spends one fixed configured iteration budget. Lower-cost hashes rehash after successful login, while hashes above the runtime budget are not authenticated; once higher-cost hashes exist, migrate them before lowering the configured value.
- Login failures return the same generic credential error for unknown, unusable, and wrong-password accounts. Source-wide and source/login-pair throttles run before account lookup and password derivation. There is no persistent account cooldown and no administrator lock-reset path.
- Roles and grants are D1-owned. User management is strictly downward, and the database atomically preserves at least one active user whose current role grants `admin.roles.manage`.
- Rich-text documents are validated server-side against a strict node/mark whitelist. Member-authored inline HTML passes through one shared sanitizer. Responses use CSP, HSTS, frame denial, `nosniff`, referrer, and permissions policies.
- Persisted images use validated WebP variants, and profile audio uses validated Ogg/Opus. The shared media service compares declared MIME types with magic bytes, verifies the Opus codec, and rejects SVG.
- Invitations use one random 10-character uppercase alphanumeric code. The code is stored directly and is visible to authorized invite administrators because it is intended for manual entry and repeat sharing until revoked, expired, or exhausted. Verification and registration are rate-limited, and logs redact the code. Audit archives use the normal authenticated session and `admin.audit.export` authorization on every list, HEAD, range, and download request.
- Audit archives and content media share one logical BlobStore with separate keyspaces. Cloudflare maps it to R2; VPS maps it to the configured filesystem root. Database manifests, not object listings, are authoritative.

## Self-hosting responsibility

[SETUP.md](./SETUP.md) is the canonical deployment and update guide. Operators choose either the Cloudflare runtime or the single-process VPS runtime. They are responsible for protecting runtime access, using Wrangler secret storage or a protected VPS environment file, applying reviewed migrations, keeping dependencies current, and backing up SQLite/D1 data and blob storage before an authorized production migration.

Media deletion is always tied to a specific database lifecycle transition. Garbage collection considers only expired, unlinked assets and deletes the exact recorded blob keys; no job scans storage and guesses what is unreferenced. The admin system-test console is permission-gated. Its run registry records every fixture and error by exact ID and stores before-images for reversible catalog changes. Normal, stopped, and failed test runs clean themselves immediately; bounded scheduled recovery handles only runs abandoned by a browser, network, or runtime failure. Do not manually patch a production database or rewrite/delete production blob objects; use the reviewed migration, admin, and maintenance workflows.
