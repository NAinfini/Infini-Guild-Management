## Summary / 摘要

Describe the user-facing problem and the smallest change that fixes it. / 说明面向用户的问题及解决该问题的最小完整改动。

## Validation / 验证

- [ ] Scoped tests/checks are listed below and pass / 下方列出范围内检查且均已通过
- [ ] `pnpm typecheck` passed for both Cloudflare and VPS when TypeScript or shared contracts changed / TypeScript 或共享契约变化时，两种运行时均通过类型检查
- [ ] `pnpm check:secrets` was run when configuration, deployment, or environment handling changed / 配置、部署或环境处理变化时已执行 secret 检查
- [ ] `pnpm release:check` was run when this is a release candidate / 发布候选已执行 release gate
- [ ] No populated `.env`, `.dev.vars`, private migration, secret, runtime-state, database, blob, backup, or build-artifact files are included / 未包含已填写环境文件、私有迁移、secret、运行时状态、数据库、Blob、备份或构建产物
- [ ] No real `apps/cloudflare/wrangler.jsonc`, account/resource identifiers, or unreviewed production binding changes are included / 未包含真实 Wrangler 配置、账号/资源标识或未经审核的生产 binding 变化
- [ ] Shared schemas, Drizzle schema, SQL, Cloudflare, VPS, and Portal consumers are synchronized where applicable / 相关共享 schema、Drizzle schema、SQL、两种运行时和门户调用方保持同步
- [ ] User-facing text and shared documentation are present in both English and Chinese / 面向用户文字和共享文档均有中英版本
- [ ] `docs/CHANGELOG.md` and `docs/CHANGELOG.zh.md` are updated for notable behavior, security, data, or operational changes / 重要行为、安全、数据或运维变化已同步更新双语日志

Commands/results:

```text
List only the checks actually run. / 只列出实际运行的检查。
```

## Related issue / 相关 issue

Link an issue when one exists. / 存在相关 issue 时添加链接。
