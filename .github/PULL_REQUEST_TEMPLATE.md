## Summary

Describe the user-facing problem and the smallest change that fixes it.

## Validation

- [ ] Scoped tests/checks are listed below and pass
- [ ] `pnpm typecheck` passed for both Cloudflare and VPS when TypeScript or shared contracts changed
- [ ] `pnpm check:secrets` was run when configuration, deployment, or environment handling changed
- [ ] `pnpm release:check` was run when this is a release candidate
- [ ] No populated `.env`, `.dev.vars`, private migration, secret, runtime-state, database, blob, backup, or build-artifact files are included
- [ ] No real `apps/cloudflare/wrangler.jsonc`, account/resource identifiers, or unreviewed production binding changes are included
- [ ] Shared schemas, Drizzle schema, SQL, Cloudflare, VPS, and portal consumers are synchronized where applicable
- [ ] User-facing text and shared documentation are present in both English and Chinese
- [ ] `docs/CHANGELOG.md` is updated for notable behavior, security, data, or operational changes

Commands/results:

```text
List only the checks actually run.
```

## Related issue

Link an issue when one exists.
