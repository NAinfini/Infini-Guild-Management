## Summary

Describe the user-facing problem and the smallest change that fixes it.

## Validation

- [ ] Scoped tests/checks are listed below and pass
- [ ] `pnpm typecheck` was run when TypeScript or shared contracts changed
- [ ] `pnpm check:secrets` was run when configuration, deployment, or environment handling changed
- [ ] `pnpm release:check` was run when this is a release candidate
- [ ] No populated `.env`, `.dev.vars`, secret, runtime-state, or build-artifact files are included
- [ ] Tracked `apps/worker/wrangler.jsonc` changes contain no secrets and no unreviewed production binding changes
- [ ] Shared schemas, Drizzle schema, SQL, Worker, and portal consumers are synchronized where applicable
- [ ] User-facing text and shared documentation are present in both English and Chinese
- [ ] `CHANGELOG.md` is updated for notable behavior, security, data, or operational changes

Commands/results:

```text
List only the checks actually run.
```

## Related issue

Link an issue when one exists.
