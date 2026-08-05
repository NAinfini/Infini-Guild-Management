# Security policy

## Supported version

Security fixes are made on the latest `main` branch. Until versioned releases are published, older commits are not separately supported.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use this repository's **Security → Advisories → Report a vulnerability** flow and include:

- the affected route, page, or configuration;
- the impact and minimum reproduction steps;
- whether credentials, private guild data, or real user data may be exposed;
- a suggested fix, if available.

Never include real passwords, session cookies, invite codes, `SIGNING_SECRET`, Cloudflare API tokens, private guild data, or production database exports. Resource names, D1/R2 identifiers, and public routes already present in the tracked `wrangler.jsonc` are configuration identifiers rather than authentication secrets, but a private fork may still redact identifiers it does not intend to publish.

Maintainers will acknowledge a complete report, assess severity, and coordinate remediation before public disclosure. Repository owners must enable GitHub private vulnerability reporting before making a fork public.

## Implemented security boundaries

- Backend permission checks are authoritative; client-side guards only shape the interface.
- Sessions use HTTP-only cookies. Mutations require origin validation and `X-Requested-With`, and sensitive route groups have dedicated rate limits.
- Rich text is sanitized and responses use CSP, HSTS, frame denial, `nosniff`, referrer, and permissions policies.
- Persisted images are limited to WebP/GIF and profile audio to Ogg/Opus. The Worker compares declared MIME types with magic bytes, verifies the Opus codec, and rejects SVG.
- `SIGNING_SECRET` protects audit archive download tokens and authenticates internal Worker-to-Durable-Object push publication. Rotate it if exposure is suspected.
- Audit archives and their authoritative manifests share the single `MEDIA` R2 bucket with content media, but application keyspace checks keep content operations out of the archive prefix.

## Self-hosting responsibility

[SETUP.md](./SETUP.md) is the canonical deployment and update guide. Self-hosters are responsible for protecting Cloudflare access, storing secrets only in Cloudflare secret storage, applying reviewed migrations, keeping dependencies current, and backing up data before authorized remote migrations.

Keep production defaults at `MEDIA_ORPHAN_DELETE_MODE=report` and `ENABLE_PRODUCTION_SYSTEM_TESTS=false` until an operator explicitly reviews and authorizes a change. Never manually patch production D1 or rewrite/delete production R2 objects; use the application's reviewed migration, admin, and maintenance workflows.
