# 参与 Infini Guild Management 开发

[文档首页](../README.md) · [English version](./CONTRIBUTING.md)

感谢你帮助改进项目。开始前请阅读 [SETUP.zh.md](./SETUP.zh.md) 和 [AGENTS.zh.md](../AGENTS.zh.md)。保持改动聚焦、根据证据工作，并遵守模块化后端边界。

## 基本规则

1. 重大功能、跨系统重构、基础设施变更及新依赖应先讨论，再开始实现。
2. 每个 pull request 只处理一个关注点；在共享工作区中不要覆盖无关改动。
3. 不为 Cloudflare 和 VPS 编写两套业务实现。两种运行时组合相同的契约、服务、store、路由和迁移。
4. wire contract 变化时，同步更新 `apps/shared`、后端 package、运行时 adapter 和门户调用方。
5. 绝不提交 secret、私有迁移 SQL、已填写环境文件、数据库、Blob 数据、生成的运行时状态或构建产物。

## 分支与提交

从 `main` 创建分支，使用 `feat/`、`fix/`、`docs/` 或 `chore/` 等清楚前缀。提交标题使用清晰的祈使句；可使用 Conventional Commit，但不强制。

## 架构边界

### 共享与领域代码

- 运行时无关的 Zod schema、权限 ID、内置角色、限制和工具放在 `apps/shared/`。
- `packages/kernel/` 拥有错误、不可变请求/授权上下文及端口。
- `packages/server/` 拥有领域服务和授权政策，不得导入 Hono、Drizzle、Cloudflare 或 Node 运行时 adapter。
- 每个修改型服务都需要审计修改，并与业务变化原子持久化。
- 固定活动/公会战规则保留在源码中，不添加动态游戏规则表。

### 持久化与 HTTP

- `packages/persistence-sqlite/` 拥有共享 Drizzle schema，以及 D1 与 VPS SQLite 共用的具体 store。
- `packages/transport-http/` 拥有解析、presenter、路由 factory、修改安全、body 限制、Range、ETag 和错误 envelope。
- 路由使用注入的 `RequestContext`，不自行解析会话或重复权限检查。
- 集合必须有界，并使用稳定 keyset 分页或有文档的小型硬限制。热点路径应加入查询计划断言。

### 运行时 adapter

- `packages/application/` 是唯一 composition root。
- `apps/cloudflare/` 实现 D1、R2、Durable Object、Cloudflare 限流、静态资源和定时事件 adapter。
- `apps/vps/` 实现 Node SQLite、文件系统 BlobStore、进程内 WebSocket、限流、scheduler、静态文件及有界停机。
- 运行时 adapter 可以实现端口，但不能分叉业务规则。

### 门户

- 组件通过既有 service 和 hook 获取数据，不直接使用原始 HTTP 模块。
- TanStack Query 管理服务端状态；Zustand 管理既有客户端、会话和 UI 状态。
- 路由行为位于 `apps/portal/router.tsx`；导航元数据位于 `apps/portal/components/layout/route-metadata.ts`。
- 每条面向用户的文字都要加入英文和中文。保留无障碍、主题、减少动效、响应式任务一致性和既有设计系统。

### 媒体

- 领域代码通过 `MediaService` 操作；存储 key 和列表不能决定所有权、授权或配额。
- Cloudflare R2 与 VPS 文件系统实现相同的流式 `BlobStore`，包括完整性元数据和字节 Range。
- 数据库关联与生命周期状态和领域数据、审计记录原子变化。有界垃圾回收处理上传失败留下的 staged 资产。

### Schema 与迁移

- `packages/persistence-sqlite/src/schema/` 中的 Drizzle module 是关系模型事实来源；命名 SQL 文件包含必要触发器和表选项。
- `0000_core.sql` 基线已冻结。每次 schema 变化都需要新的连续序号迁移和 manifest checksum；绝不修改已应用迁移。
- 保持 Node SQLite 与本地 D1 一致性测试通过，不添加运行时专属 schema 变体。
- 未经明确授权、可验证备份和经过测试的恢复路径，不执行远程迁移。
- 密码只使用自描述 hash 格式，禁止运行时双读其他凭据格式。

## 修改行为

API 变化：

1. 更新共享请求/响应 schema。
2. 更新领域服务及其授权和审计行为。
3. 更新 store 事务与路由/presenter。
4. 验证两种运行时 composition path。
5. 只有产品契约变化时才更新门户调用方。

Schema 变化：

1. 更新 Drizzle schema 和命名 invariant SQL。
2. 添加下一个连续序号迁移及 manifest checksum。
3. 运行 schema 一致性、Node SQLite 和本地 workerd D1 测试。
4. 更新共享契约和领域/store 测试。

## 验证

### 复现 CI

在 Git 检出的仓库根目录运行命令。CI 使用 **Ubuntu 24.04**，操作系统镜像更新由 GitHub 维护。Node 和 pnpm 是安装时强制检查的精确版本要求。使用提交的 lockfile，不重新解析新版本。

CI 在推送到 `main` 或向 `main` 提交拉取请求时运行，避免同一功能分支因 push 和 PR 重复执行。

| 工具 | 本次发布使用的版本 | 事实来源 |
| --- | --- | --- |
| Node.js | 26.5.1 | `.node-version` 与 `package.json` engines |
| pnpm | 11.17.0 | `package.json` packageManager 与 engines |
| TypeScript 编译器 | Native 7.0.2 | `@typescript/native` 别名，脚本明确调用该编译器 |
| TypeScript 库 | 6.0.2 | `typescript` 指向 `@typescript/typescript6`，供 ESLint 等工具使用 |
| ESLint | 10.9.1 | 根目录 `eslint.config.js`，不使用旧 `.eslintrc` 文件 |
| Vitest / Vite | 4.1.11 / 8.2.2 | 根目录 `package.json` 与 `pnpm-lock.yaml` |
| Playwright | 1.62.1 | 按自带浏览器清单安装 Chromium 151.0.7922.34，revision 1234 |
| Wrangler / Miniflare | 4.127.1 / 5.20260828.0-alpha | 成对锁定，用于本地 workerd 配置转换 |
| 其他全部包 | 精确解析版本 | `pnpm-lock.yaml`，包括传递依赖 |

通过 Node 版本管理器切换到 Node 26.5.1，然后运行：

```bash
npm install --global pnpm@11.17.0
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm release:check
# Linux：安装 Chromium 及所需系统库，可能要求 sudo。
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

Windows 或 macOS 使用 `pnpm exec playwright install chromium` 安装浏览器。无需全局安装 TypeScript、ESLint、Vitest、Vite 或 Wrangler。CI 使用按 SHA 锁定的 Actions，不需要生产 secret。完整浏览器测试通过 `pnpm test:e2e --shard=1/3`、`--shard=2/3` 和 `--shard=3/3` 分到三个独立运行器并行执行；本地不带 `--shard` 的命令仍运行全集。分片不会抽样或跳过测试。修改工具版本时，同步更新 manifest、lockfile 和上表；修改 Node 时还要更新 `.node-version`。修改 Playwright 后，重新安装它对应的浏览器。

`pnpm typecheck` 检查工作区（包含测试与配置文件）、Cloudflare 和 VPS；两种运行时刻意使用不同的环境类型。`pnpm lint` 遇到警告或错误都会失败。`release:check` 执行这些检查及全部 Vitest 项目，再构建一次门户及两份服务端产物。独立的 `pnpm cloudflare build`、`pnpm vps build` 仍包含各自类型检查和门户构建；`bundle:*` 只是内部产物步骤，不能替代验证。

Vitest 分为 Portal/jsdom、独立进程中的时区/DST 测试、共享代码/脚本 Node 测试及后端/运行时测试。POSIX 文件权限测试在 POSIX 系统运行，Windows 专属用例在 Windows 运行；这些条件用例属于必要的平台覆盖。Cloudflare 与 VPS 中相似的测试保护不同 adapter，应保留。E2E 分游客、成员和管理员项目，不自动重试；启动两组隔离本地数据库/Blob 环境前会先构建门户和 Worker。测试必须恢复数据库/Blob 基线，清理失败也会使测试失败。

常用聚焦命令：

```bash
pnpm test --project=portal
pnpm test apps/portal/components/pages/StoragePage.test.tsx
pnpm test:e2e --project=admin apps/portal/e2e/specs/admin/profile-account.spec.ts
pnpm test:e2e:ui
```

E2E 默认独占 **8787–8788** 及 inspector **9329–9330** 端口。先停止本地开发服务器，或选用空闲端口。例如 Linux/macOS：

```bash
E2E_PORT_BASE=8887 E2E_INSPECTOR_PORT_BASE=9429 pnpm test:e2e
```

PowerShell：

```powershell
$env:E2E_PORT_BASE = '8887'
$env:E2E_INSPECTOR_PORT_BASE = '9429'
pnpm test:e2e
```

本地资源不足时可用 `E2E_SLOTS=1` 运行单组隔离环境，每个 CI 分片保留两组。不要在同一检出目录同时运行两个 E2E 命令，因为忽略的状态、产物和日志目录仍是共享的。启动会拒绝占用端口及缺失/过期构建；使用 `pnpm test:e2e` 重新构建。Worker 访问日志写入 `apps/portal/e2e/.logs/`，不再刷满控制台；错误仍会显示。失败诊断保留于 `.artifacts/` 和 `.logs/`；每个失败的 CI 分片分别上传 `playwright-report/` 和完整服务器日志，保留七天。不要提交这些生成文件。

### 测试政策

- 测试持久用户行为、业务规则、授权、安全、数据完整性、无障碍和运行时一致性。
- 不测试精确像素、间距、边框宽度、颜色、CSS 类名或样式文件归属；这些属于设计审核，而非稳定产品契约。
- 优先在最低有效层添加一个聚焦测试。只有真实跨页面流程、浏览器行为或单元测试无法保护的集成边界才增加浏览器覆盖。
- 当迁移和恶意输入测试保护真实数据或安全时，即使 fixture 被称为 legacy 也应保留。只有兼容路径被明确删除后，才能删除对应兼容测试。
- 测试应在支持结果错误时失败，而不是在等价实现重构时失败。

按变更风险运行检查：

| 变更 | 最低验证 |
| --- | --- |
| 仅文档 | `git diff --check` 加定向路径/链接搜索 |
| 共享/领域契约 | 聚焦测试及受影响 package typecheck |
| 门户行为/样式 | 聚焦组件测试、typecheck 和相关视觉/无障碍审核 |
| Store/schema | 聚焦 store 测试、schema 一致性、Node SQLite 和本地 D1 迁移测试 |
| 运行时 adapter | 对应 conformance 测试及运行时 typecheck |
| 发布候选 | `pnpm release:check` 与 `pnpm test:e2e` |

常用命令：

```bash
pnpm typecheck
pnpm lint
pnpm test <focused paths>
pnpm build:portal
pnpm cloudflare build
pnpm vps build
pnpm test:e2e
pnpm config:check --runtime cloudflare --config apps/cloudflare/wrangler.example.jsonc --allow-placeholders
pnpm config:check --runtime vps --config scripts/templates/vps.env.example --allow-placeholders
pnpm release:check
```

`release:check` 只在本地运行，并刻意排除浏览器 E2E。CI 会同时运行该命令和三个隔离的 Chromium E2E 分片；所有任务都不会认证 Cloudflare、部署或修改远程 D1/R2。

## Pull request 检查清单

- [ ] Diff 只处理一个关注点，并保留无关工作。
- [ ] 共享契约、领域规则、持久化、HTTP 和两种运行时保持同步。
- [ ] 授权、审计、并发、媒体和清理 invariant 有聚焦负向测试。
- [ ] 相关 typecheck/测试通过，pull request 准确列出实际运行的检查。
- [ ] 共享事实变化时，英文/中文文档或 UI 资源保持同步。
- [ ] 未跟踪 secret、私有 SQL、生产标识、数据库、Blob 或测试产物。
- [ ] CI 或 release-check 脚本没有隐藏部署或远程迁移。

## 许可证

提交贡献即表示同意按照 [MIT License](../LICENSE) 授权该贡献。
