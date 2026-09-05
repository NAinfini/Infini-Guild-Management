# AGENTS.md — 仓库代理指南

本文定义本仓库中编码代理的稳定工作契约。编辑前应先阅读相关实现；本文指向权威来源，而不重复维护完整文件清单。

## 仓库基线

- Infini Guild Management 是一个双语 React 门户，使用一个模块化后端和两种部署 adapter。
- 部署可选择 Cloudflare Workers（D1、R2、Durable Objects）或一台 VPS 上的单个 Node 进程（SQLite、文件系统 Blob、进程内 WebSocket）。业务行为绝不能按运行时分叉。
- 门户使用 React、TypeScript、Vite、由 Base UI 支撑的 shadcn/ui 组合、Tailwind CSS utility、TanStack Router/Query、Zustand 和 TipTap。
- 支持的 Node、pnpm 和依赖版本在 `package.json` 中声明。

## 权威来源

- `apps/shared/`：wire schema、权限 ID、内置角色、硬限制和运行时无关工具。
- `packages/kernel/`：错误、请求/授权上下文和平台端口。
- `packages/server/`：领域服务与授权政策，不能导入 HTTP 或运行时 adapter。
- `packages/persistence-sqlite/`：共享 Drizzle 模型、store、SQLite invariant，以及 D1 与 VPS 共用的唯一迁移链。
- `packages/transport-http/`：HTTP 解析、presenter、安全中间件和路由 factory。
- `packages/application/`：门户 API 与定时任务的唯一 composition root。
- `apps/cloudflare/`：D1/R2/DO/限流/静态资源/定时任务 adapter 及 Cloudflare 根 handler。
- `apps/vps/`：Node SQLite/文件系统/WebSocket/scheduler/静态资源 adapter 及 VPS 运行时。
- `apps/portal/`：SPA；`router.tsx` 拥有路由，`components/layout/route-metadata.ts` 拥有导航，service/hook 拥有编排。
- `packages/persistence-sqlite/src/migrations/generated/0000_core.sql`：1.0.0 发布的唯一冻结 core schema，包含完整结构与权威种子数据。
- `docs/SETUP.md` 与 `docs/SETUP.zh.md`：部署、迁移、bootstrap、备份和恢复流程。

编辑前使用 `rg --files` 和定向 symbol 搜索，不维护第二份完整文件清单。

## 常用命令

```bash
pnpm dev
pnpm cloudflare dev
pnpm vps dev
pnpm dev:portal
pnpm build:portal
pnpm cloudflare build
pnpm vps build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm db:generate -- --name <migration-name>
pnpm db:migrate:cloudflare:local
pnpm db:migrate:vps --database <path>
pnpm config:check --runtime cloudflare --config apps/cloudflare/wrangler.jsonc
pnpm config:check --runtime vps --config apps/vps/.env
pnpm release:check
```

使用覆盖改动的最窄验证。`release:check` 只在本地运行，绝不能部署或修改远程数据库或 Blob store。

## 工作规则

1. 编辑前检查精确 symbol 和测试。
2. 保留无关未提交工作，绝不 reset、clean 或覆盖共享工作区。
3. 修复根因，不添加兼容分支、静默 fallback、重复 service 或伪成功占位。
4. 保持单向依赖：shared/kernel → server → persistence/transport → application → runtime adapter。
5. 非平凡行为加入最小相关测试，并准确报告实际运行内容。
6. 未经明确授权，不提交、推送、发布、部署或修改生产基础设施。
7. 未经明确授权、验证过的备份和测试过的恢复路径，绝不执行远程迁移。

## 契约与授权

- 请求/响应 body schema 位于 `apps/shared/schemas/`，TypeScript 类型从 schema 推断。Query string schema 是 transport 细节，放在 `packages/transport-http` 对应路由 factory 旁。
- 路由 factory 解析 HTTP 并调用 service。业务政策和授权位于领域 service；门户权限守卫只改善 UX。
- 每个请求只接收一个不可变 `RequestContext`。`AuthorizationContext` 只能来自服务端解析的会话；门户“以某身份查看”不能进入授权或持久化查询。
- 受保护修改在业务变化的同一 SQL 事务中写入审计行。Blob 字节可先 staged，数据库拥有关联与生命周期状态。
- 修改请求要求允许的 `Origin` 和 `X-Requested-With: XMLHttpRequest`。Body 限制、限流、ETag、安全 header、会话解析和功能守卫应集中维护。
- 授权来自 D1 角色及其权限行。角色管理动态配置，数据库保证最后一位角色拥有 `admin.roles.manage` 的活跃用户不被移除。
- 登录凭据失败使用通用响应。按来源和来源/登录名组合的限流在账号查询或 PBKDF2 前执行；不存在持久账号冷却或管理员解锁路径。

## 门户

- 组件通过既有 service/hook 使用服务端数据，不直接使用原始 API client。
- TanStack Query 拥有服务端状态；Zustand 只用于既有客户端、会话和 UI 状态。
- `router.tsx` 拥有路由访问和功能守卫，不创建第二份导航注册表。
- Base UI primitive 拥有键盘、焦点、dialog、menu、selection 和表单行为；`components/ui/` 下源码自有的 shadcn/ui 组合提供样式边界。使用语义主题 token，并保留明暗主题、减少动效、键盘焦点和响应式任务一致性。
- 每次面向用户的修改都同步英文和中文 UI 资源。
- 遵循 `docs/DESIGN.md`；精确值漂移时以源码 CSS 为准。

## 固定游戏规则

游戏规则是源码拥有的契约，不属于站点配置数据：

- 活动类型为 `weekly_mission`、`guild_war`、`social`、`poll`、`raffle` 和 `other`；
- 公会战结果为 `win`、`loss` 和 `draw`；
- KDA 为 `(kills + assists) / max(deaths, 1)`，只在展示时舍入；
- 数据定义使用一个用户输入的 `name`，数值以 SQLite `REAL` 保存。

不得添加动态游戏规则表或第二套翻译/精度模型。

## 媒体与 Blob

- `MediaService` 与 D1/SQLite 元数据拥有身份、授权、配额、生命周期和关联。
- `BlobStore` 只保存 stream 与验证过的元数据；Cloudflare 映射到 R2，VPS 映射到配置的文件系统目录。
- API 响应只暴露媒体 ID，不暴露存储 key。
- Range/HEAD/ETag 行为必须保持流式，并在两种运行时一致。
- 垃圾回收只考虑已过期且无关联的数据库资产，并删除记录中的精确 key；绝不从路径推断所有权，也不把存储扫描当作权威来源。

## Schema 与迁移

- `packages/persistence-sqlite/src/schema/` 下的 Drizzle module 是关系模型事实来源；命名 `.sql` invariant 覆盖 Drizzle 无法表达的行为。
- 1.0.0 仅发布 `0000_core.sql` 这一冻结的合并基线。后续 schema 变化应添加下一个连续序号迁移和精确 manifest 条目，不得重新生成 core。合并前数据库必须执行 `docs/PRODUCTION_D1_UPGRADE.zh.md` 所述经过验证、维护期保护的账本切换；绝不对已有业务表重放 core。
- 保留 Wrangler 拥有的 `d1_migrations` 历史，其中可以包含旧文件名；应用拥有的 `app_migrations` 必须与当前 manifest 精确一致。不得为不同变化复用历史迁移文件名。
- Node SQLite 与本地 workerd D1 必须应用相同字节，并通过 schema/索引/触发器一致性测试。
- 内置角色、权限、站点配置默认值和 schema 元数据由共享常量生成。
- 私有首位 owner SQL 在已忽略的 `private-migrations/` 下生成，绝不提交。
- 运行时迁移校验支持有序多文件链。绝不编辑已经发布或应用到受保护数据库的迁移。

## 系统测试与清理

- 管理 API 测试控制台使用受权限保护的运行注册表；每个创建的工件和错误都按精确主键记录。
- 重排记录有界 before-image，并以 compare-and-swap 恢复；清理绝不 reseed 或按宽泛模式删除。
- cleanup/finalize 幂等执行并明确报告冲突；有界定时任务回收遗弃运行。

## 运行时边界

- Cloudflare 配置从 `apps/cloudflare/wrangler.example.jsonc` 复制；本地 D1/R2 binding 必须保留 `remote: false`，secret 使用 Wrangler secret storage。
- VPS 配置从 `scripts/templates/vps.env.example` 复制；secret 和数据路径必须受文件系统权限保护。
- VPS 有意限定为单个 Node 进程。未增加共享 WebSocket 传递、限流和分布式任务协调前，不得暗示多进程安全。
- 两种运行时挂载相同应用路由、schema 版本守卫、通知政策和任务协调器；运行时专属代码只实现端口。

## 交付

- 保持 `README.md`/`docs/README.zh.md` 与 `docs/SETUP.md`/`docs/SETUP.zh.md` 同步。
- 重要安全、数据或运维行为在 `docs/CHANGELOG.md` 的 `Unreleased` 下更新。
- 交付前运行 `git diff --check`、相关聚焦测试、两种运行时 typecheck、secret/config 检查；准备发布时运行 release gate。
- 确认没有生产标识、本地数据库、生成的私有 SQL、secret 或运行时状态受到 Git 跟踪。
