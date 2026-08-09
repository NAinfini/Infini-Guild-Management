# Security policy

## Supported version

Security fixes land on the latest `main` branch and ship with the next tagged release. Older tags are not separately patched.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use this repository's **Security → Advisories → Report a vulnerability** flow and include:

- the affected route, page, or configuration;
- the impact and minimum reproduction steps;
- whether credentials, private guild data, or real user data may be exposed;
- a suggested fix, if available.

Never include real passwords, session cookies, invite codes, `SIGNING_SECRET`, Cloudflare API tokens, private guild data, or production database exports. Resource names, D1/R2 identifiers, and routes from your `wrangler.jsonc` are configuration identifiers rather than authentication secrets — and that file is untracked, so the repository never publishes them — but you may still redact identifiers you do not intend to disclose.

Maintainers will acknowledge a complete report, assess severity, and coordinate remediation before public disclosure. Repository owners must enable GitHub private vulnerability reporting before making a fork public.

## Implemented security boundaries

- Backend permission checks are authoritative; client-side guards only shape the interface.
- Sessions use HTTP-only cookies. Mutations require origin validation and `X-Requested-With`, and sensitive route groups have dedicated rate limits.
- Passwords are stored as self-describing PBKDF2-SHA256 hashes. The iteration count defaults to 10,000 so logins fit the Workers free-plan CPU budget and is configurable via `PBKDF2_ITERATIONS`; paid-plan deployments should raise it toward the OWASP-recommended 600,000, and existing accounts rehash to the new cost on their next login.
- Rich-text documents are validated server-side against a strict node/mark whitelist, member-authored inline HTML passes one shared sanitizer, and responses use CSP, HSTS, frame denial, `nosniff`, referrer, and permissions policies.
- Persisted images are limited to WebP/GIF and profile audio to Ogg/Opus. The Worker compares declared MIME types with magic bytes, verifies the Opus codec, and rejects SVG.
- `SIGNING_SECRET` protects audit archive download tokens and authenticates internal Worker-to-Durable-Object push publication. Rotate it if exposure is suspected.
- Audit archives and their authoritative manifests share the single `MEDIA` R2 bucket with content media, but application keyspace checks keep content operations out of the archive prefix.

## Self-hosting responsibility

[SETUP.md](./SETUP.md) is the canonical deployment and update guide. Self-hosters are responsible for protecting Cloudflare access, storing secrets only in Cloudflare secret storage, applying reviewed migrations, keeping dependencies current, and backing up data before authorized remote migrations.

Media deletion is always tied to a specific write: a path deletes only the object it just orphaned, and lease reclamation deletes only keys that expired without ever gaining a database reference. No job scans the bucket and decides what looks unreferenced. The admin system-test console is always available in production so operators can health-check every API without a code change; it is safe to expose because admin permissions gate every request, the run registry tracks each fixture, and cleanup deletes by exact ID only. Never manually patch production D1 or rewrite/delete production R2 objects; use the application's reviewed migration, admin, and maintenance workflows.
