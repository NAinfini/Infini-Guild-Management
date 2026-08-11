# Security policy

## Supported version

Security fixes land on the latest `main` branch and ship with the next tagged release. Older tags are not separately patched.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use this repository's **Security → Advisories → Report a vulnerability** flow and include:

- the affected route, page, or configuration;
- the impact and minimum reproduction steps;
- whether credentials, private guild data, or real user data may be exposed;
- a suggested fix, if available.

Never include real passwords, session cookies, invite codes, `IG_INVITE_TOKEN_SECRET`, `IG_AUDIT_DOWNLOAD_SECRET`, Cloudflare API tokens, private guild data, or production database exports. Resource names, D1/R2 identifiers, and routes from your `wrangler.jsonc` are configuration identifiers rather than authentication secrets — and that file is untracked, so the repository never publishes them — but you may still redact identifiers you do not intend to disclose.

Maintainers will acknowledge a complete report, assess severity, and coordinate remediation before public disclosure. Repository owners must enable GitHub private vulnerability reporting before making a fork public.

## Implemented security boundaries

- Backend permission checks are authoritative; client-side guards only shape the interface.
- Sessions use HTTP-only cookies. Mutations require origin validation and `X-Requested-With`, and sensitive route groups have dedicated rate limits.
- Passwords are stored as self-describing PBKDF2-SHA256 hashes. The iteration count defaults to 10,000 so logins fit the Workers free-plan CPU budget and is configurable via `IG_PBKDF2_ITERATIONS`; deployments with a larger CPU budget should raise it, and existing accounts rehash only when the configured cost is higher.
- Login failures are tracked independently of sessions. Three failures are free, the fourth starts a timed lock, later lock periods increase to a bounded maximum, and an administrator with the required permission can inspect and atomically clear the current lock state.
- `site_owner` is the trust-root role above admin. Multiple owners are supported, but the database prevents removal, demotion, disabling, deletion, or grant removal from the final active owner.
- Rich-text documents are validated server-side against a strict node/mark whitelist, member-authored inline HTML passes one shared sanitizer, and responses use CSP, HSTS, frame denial, `nosniff`, referrer, and permissions policies.
- Persisted images use validated WebP variants and profile audio uses validated Ogg/Opus. The shared media service compares declared MIME types with magic bytes, verifies the Opus codec, and rejects SVG.
- `IG_INVITE_TOKEN_SECRET` authenticates invite tokens. `IG_AUDIT_DOWNLOAD_SECRET` signs actor-bound, expiring audit archive downloads. Rotate either secret if exposure is suspected.
- Audit archives and content media share one logical BlobStore with separate keyspaces. Cloudflare maps it to R2; VPS maps it to the configured filesystem root. Database manifests, never object listings, are authoritative.

## Self-hosting responsibility

[SETUP.md](./SETUP.md) is the canonical deployment and update guide. Operators choose either Cloudflare or the single-process VPS runtime. They are responsible for protecting runtime access, using Wrangler secret storage or a protected VPS environment file, applying reviewed migrations, keeping dependencies current, and backing up both SQLite/D1 data and blob storage before an authorized production migration.

Media deletion is always tied to a specific database lifecycle transition: garbage collection considers only expired, unlinked assets and deletes the exact recorded blob keys. No job scans storage and guesses what is unreferenced. The admin system-test console is permission-gated; its run registry records every fixture and error by exact ID, stores before-images for reversible catalog changes, and performs bounded cleanup after abandoned runs. Never manually patch a production database or rewrite/delete production blob objects; use the reviewed migration, admin, and maintenance workflows.
