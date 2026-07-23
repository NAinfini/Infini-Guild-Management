# Security policy

## Supported version

Security fixes are made on the latest `main` branch. Until the project publishes versioned releases, older commits are not separately supported.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability.

Use this repository's **Security → Advisories → Report a vulnerability** flow. Include:

- the affected route, page, or configuration;
- the impact and minimum steps needed to reproduce it;
- whether real user data or credentials may be exposed;
- a suggested fix, if you have one.

Do not include real passwords, session cookies, invite codes, signing secrets, Cloudflare tokens, account IDs, or production database exports.

Maintainers will acknowledge a complete report, assess severity, and coordinate a fix before public disclosure. Please allow reasonable time for remediation.

Repository owners must enable **Private vulnerability reporting** in GitHub's code-security settings before making the repository public.

## Deployment responsibility

Self-hosters are responsible for protecting their Cloudflare account, rotating secrets, applying database migrations, and keeping dependencies current. Start with [SETUP.md](./SETUP.md) and keep populated `.dev.vars`, `.env`, and `wrangler.jsonc` files out of Git.
