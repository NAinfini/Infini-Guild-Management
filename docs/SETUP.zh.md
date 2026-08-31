# 自托管安装指南

[文档首页](../README.md) · [English version](./SETUP.md)

这是模块化后端的权威安装指南。每套部署只能选择一种运行时：

| 运行时 | 数据库 | Blob | 实时与调度 | 进程模型 |
| --- | --- | --- | --- | --- |
| Cloudflare | D1 | 一个 `BLOBS` R2 桶 | Durable Object 与 Cron Triggers | Cloudflare 托管 |
| VPS | 一个本地 SQLite 文件 | 一个文件系统根目录 | 进程内 WebSocket hub 与 scheduler | 一个 Node.js 进程 |

两种运行时共用应用服务、HTTP 路由、Drizzle schema 和 core migration。它们是两种部署方案，而不是同一站点的两份可独立修改数据：绝不能分别修改 Cloudflare 与 VPS 数据后再尝试合并。

## 环境要求

- Node.js 26.5.1 或更新版本
- pnpm 11.17.0
- Git 或源码压缩包
- Cloudflare：支持 Workers、D1、R2、Durable Objects、Cron Triggers 与 Rate Limiting 的账号
- VPS：当前 64 位 Linux、持久磁盘、TLS 反向代理，以及 systemd 等服务管理器

在仓库根目录安装锁定的依赖版本：

```bash
pnpm install --frozen-lockfile
```

## 命令参考

| 用途 | 命令 |
| --- | --- |
| 创建本地配置 | `pnpm setup:local --runtime cloudflare` 或 `pnpm setup:local --runtime vps` |
| 开发 | `pnpm dev`（Cloudflare）、`pnpm cloudflare dev` 或 `pnpm vps dev` |
| 构建共享门户 | `pnpm build:portal` |
| 本地构建 Cloudflare | `pnpm cloudflare build` |
| 本地构建 VPS | `pnpm vps build` |
| 检查两种运行时类型 | `pnpm typecheck` |
| 运行测试 | `pnpm test` |
| 生成下一条 Drizzle 迁移 | `pnpm db:generate -- --name <migration-name>` |
| 初始化或校验 VPS 数据库 | `pnpm db:migrate:vps --database <sqlite-path>` |
| 校验 VPS 数据库/Blob 快照 | `pnpm verify:data:vps --database <sqlite-path> --blobs <blob-root>` |
| 在 VPS 应用已审核私有 SQL | `pnpm db:migrate-private:vps --database <sqlite-path> --migration <sql-path>` |
| 准备首位管理员 | `pnpm prepare:first-admin -- ...` |
| 启动 VPS | `pnpm start:vps` |
| 本地发布门禁 | `pnpm release:check` |
| 隔离浏览器 E2E | `pnpm test:e2e` |
| 部署 Cloudflare | `pnpm deploy:cloudflare` |

`release:check` 只在本地执行：它会扫描已跟踪内容、校验两份模板、检查两端类型、运行测试并构建门户，但不会创建、迁移、部署或修改远程资源。`deploy:cloudflare` 则刻意单独提供，因为它会进行真实的远程变更。

## 本地开发

### Cloudflare

```bash
pnpm dev
```

`pnpm dev` 默认执行 `pnpm cloudflare dev`。它会创建缺失且被忽略的本地配置文件，但不会替换已有文件；随后将共享迁移和本地开发 seed 应用到 D1，在 8787 端口启动 Wrangler，并在 5173 端口启动 Vite。不需要登录 Cloudflare，也不需要任何远程资源。

打开 `http://localhost:5173`。

### VPS

```bash
pnpm vps dev
```

若文件尚不存在，该命令会从 `scripts/templates/vps.env.example` 创建被忽略的 `apps/vps/.env`，且不会覆盖已有文件。然后它会初始化或校验 `data/infini-guild.sqlite`，应用与 Cloudflare 相同的本地开发 seed，在 8787 端口启动后端、在 5173 端口启动 Vite。打开 `http://localhost:5173`。

开发 seed 只会写入全新数据库，可安全重复执行，且绝不会进入生产迁移。对已由开发 seed 建立的数据库再次执行时，会保留全部开发数据，只把这些已知账号的 `admin123` 凭据刷新为当前 10,000 次 hash。使用密码 `admin123` 可登录 `admin`、`moderator_29`–`moderator_31`，或任意 `member_01`–`member_28`，以验证管理员、版主和成员流程。种子覆盖全部活动类型、邀请链接与公告状态、周期活动、投票、抽奖、Wiki 修订和还原历史、仓库流水类型、进行中及胜/负/平帮会战、图库、审计和错误记录，以及可真实读取的本地 WebP/Ogg 媒体对象。若数据库已存在非开发用户，seed 会直接跳过，避免把 mock 数据混入现有站点。

## 共享 schema 与迁移

已合并的 0.1.0 基线冻结在：

```text
packages/persistence-sqlite/src/migrations/generated/0000_core.sql
packages/persistence-sqlite/src/migrations/generated/manifest.json  # 单一合并 core；后续变化追加条目
```

Cloudflare D1 与 VPS SQLite 使用同一组有序迁移文件，从 `0000_core.sql` 开始；它包含原 `0017_notice_delivery` 之前所有迁移的最终结构与种子数据。`app_migrations` 是应用拥有的序号/校验和账本，也是启动校验的权威来源。Cloudflare 还维护 `d1_migrations`，供 Wrangler 记录已应用文件名。应保留其历史行，允许其中存在当前目录已没有的旧文件名。空、未知或不匹配的应用 schema 会被拒绝，绝不会被静默修补。

本次 0.1.0 刷新包含所有者明确授权的一次性合并。既有数据库必须先用标签 `archive/pre-core-20260830` 完成原 18 个迁移，再按 [PRODUCTION_D1_UPGRADE.zh.md](./PRODUCTION_D1_UPGRADE.zh.md) 执行经过备份、演练的账本切换。**不得向已有数据库执行新 core，也不能认为 Wrangler 跳过同名文件就已更新应用账本。** 此次切换后 core 不可变；后续 schema 变更新增下一个连续序号、从未使用过的文件名及精确校验和，并通过 D1/SQLite 一致性检查。运行时不会静默改写已有账本。

如果要用新的 exact manifest 替换非空开发数据库，且其 `app_migrations` 账本不一致，必须先备份，再使用经过明确规划、验证且保留数据的升级流程。应用刻意不提供运行时兼容分支或远程账本自动改写。除非操作者另行明确执行带 `--remote` 的 Wrangler 命令，仓库命令绝不会修改远程 D1。当前生产升级与回滚流程以 [PRODUCTION_D1_UPGRADE.zh.md](./PRODUCTION_D1_UPGRADE.zh.md) 为准。

初始化或校验 VPS SQLite：

```bash
pnpm db:migrate:vps --database /srv/infini/data/infini-guild.sqlite
```

该命令会向空数据库应用有序迁移链。对于未知的非空数据库，它会停止而不是猜测。之后它会校验精确的 `app_migrations` 账本、全部权威 schema 对象、SQLite 完整性与所有外键。

下面的只读命令可校验已停止的 VPS 部署、恢复快照或准备好的转移数据，不会修改任一数据存储：

```bash
pnpm verify:data:vps --database /srv/infini/data/infini-guild.sqlite --blobs /srv/infini/data/blobs
```

校验器以只读方式打开 SQLite，并复用应用使用的 manifest 与 Blob inventory 服务。它会为缺失对象、元数据不一致及超过 24 小时的孤儿候选输出 JSON；只要发现任何问题，便以非零状态退出。扫描前必须停止应用写入，或针对成对快照运行，避免两个存储在扫描中发生变化。该命令不能复制或删除数据。

Cloudflare 必须先备份目标、审核确切迁移与绑定，再明确授权针对已核实数据库名的远程操作。已发布迁移链包含 CASE 触发器，因此须使用下述经审核的原子 file-import 流程，不要直接为本地 `migrations apply` 命令添加 `--remote`。

仓库 setup、CI、测试与 release check 永远不会执行远程迁移。

### 含 `CASE` 触发器主体的远程 D1 迁移

本地通过并不能证明远程 query 传输能接受含 `CASE`/`BEGIN`/`END` 的已发布 `CREATE TRIGGER` 迁移。生产写入前，先使用经批准的只读 `EXPLAIN` 对照，分别通过远程 `--command` 与远程 `--file` 验证 parser 行为；该对照不执行 DDL。

初始化或升级遇到这类语法时，保持已发布 SQL 和 manifest 不变。仓库外经审核的生成器必须以迁移原始 UTF-8 字节加上锁定 Wrangler 的 `buildMigrationQuery` 为该文件名和配置账本表生成的精确 `d1_migrations` 后缀，生成一个受保护的复合文件。得到明确授权后，每次导入一个文件：

```bash
pnpm exec wrangler d1 execute <verified-database-name> --remote --config <protected-config> --file <protected-composite-file>
```

每次导入后核对两张账本及生成的 schema/数据指纹。不得先导入裸迁移、再手动补账本；在精确语法通过只读 parser 检查前，不得对含触发器 SQL 使用远程 `migrations apply` 或 `--command`。维护窗口保护条件见[生产 D1 升级手册](./PRODUCTION_D1_UPGRADE.zh.md)。

## 配置与密钥

两端的 `IG_PBKDF2_ITERATIONS` 默认均为 `10000`，可接受不超过 `10000000` 的整数。项目为适配 Cloudflare Workers 的 CPU 限制而保持 `10000` 默认值；拥有更多且经过实测 CPU 预算的站主可以显式提高。存储的 hash 自带成本；只有部署显式配置了更高值时，较低成本 hash 才会在成功登录后重哈希。登录始终消耗同一个配置迭代预算，高于该预算的已存 hash 不会被认证。提高配置后，不得在尚有高成本凭据时把它降低；修改已部署值前必须先完成基准测试并规划凭据迁移。

HTTPS 部署固定使用 `__Host-ig_session`，OAuth 浏览器事务另用 `__Host-ig_session_oauth_transaction`；两者均为 `Secure`、仅当前主机、且 `Path=/`。从旧版无前缀 HTTPS Cookie 升级时，现有用户会按设计一次性退出；不得增加旧 Cookie fallback。纯 HTTP 本地开发仍使用 `ig_session`。

### Cloudflare 生产

1. 将 `apps/cloudflare/wrangler.example.jsonc` 复制为被忽略的 `apps/cloudflare/wrangler.jsonc`。
2. 填写 `DB`、`BLOBS`、`ASSETS`、`NOTIFICATIONS` 与 `AUTH_LOGIN_RATE_LIMITER` Durable Object 绑定，以及八个原生限流绑定：`AUTH_RATE_LIMITER`、`AUTH_IP_RATE_LIMITER`、`READ_RATE_LIMITER`、`CONTENT_VIEW_RATE_LIMITER`、`EXPENSIVE_READ_RATE_LIMITER`、`MUTATION_RATE_LIMITER`、`UPLOAD_RATE_LIMITER`、`WEBSOCKET_RATE_LIMITER`。`CONTENT_VIEW_RATE_LIMITER` 会分别按可信客户端与已登录账号限制公告和 Wiki 的原始打开计数。原生认证限流仍是快速第一层；`AUTH_LOGIN_RATE_LIMITER` 会在账号查询或密码计算前，对来源级及来源/登录名组合计数做强一致串行化。`AUTH_RATE_LIMITER` 还会按内部用户 ID 与可信客户端来源保护当前密码校验。
3. 在 `compatibility_flags` 中保留 `nodejs_als`。Worker 通过 AsyncLocalStorage 解析每个请求的 ExecutionContext，缺少该标志时产物无法加载。在该标志引入前创建的部署配置，必须在下次部署前加入它。`pnpm config:check` 会拒绝缺少该标志的配置。
4. 设置公开 HTTPS 源、允许源、routes 与 cron 配置。
5. 在本地校验配置：

```bash
pnpm config:check --runtime cloudflare --config apps/cloudflare/wrangler.jsonc
```

#### Cloudflare 上的可选 OAuth 与已验证邮箱

本地“私密登录名 + 密码”不需要任何外部账号；以下选项全部不配置时仍完整可用。启用 Google、Discord 或 KOOK 前，先在对应供应商控制台创建应用，并登记 `config:check` 输出的精确回调地址：

```text
https://你的_IG_PUBLIC_URL/api/auth/oauth/google/callback
https://你的_IG_PUBLIC_URL/api/auth/oauth/discord/callback
https://你的_IG_PUBLIC_URL/api/auth/oauth/kook/callback
```

每个供应商的 ID 与 secret 都通过 Wrangler 保存；仓库约定两者均不进入已提交的 `vars`：

```bash
pnpm exec wrangler secret put IG_OAUTH_GOOGLE_CLIENT_ID --config apps/cloudflare/wrangler.jsonc
pnpm exec wrangler secret put IG_OAUTH_GOOGLE_CLIENT_SECRET --config apps/cloudflare/wrangler.jsonc
# Discord 使用 IG_OAUTH_DISCORD_CLIENT_ID / IG_OAUTH_DISCORD_CLIENT_SECRET；
# KOOK 使用 IG_OAUTH_KOOK_CLIENT_ID / IG_OAUTH_KOOK_CLIENT_SECRET。
```

两项都存在后，再到“管理后台 → 站点配置”只开启对应供应商。运行时拒绝不完整的凭据对。如果数据库开关仍开启但凭据后来被移除，仅该供应商会变为不可用且按钮消失；本地登录与站点其他功能继续工作。即使提供预留变量，本版本也不会启用微信，因为尚未提供经官方规则核验的 adapter。

如需可选的个人资料邮箱验证，请在站主自己的 Cloudflare Email Sending 账号中接入发件域，取消 `EMAIL` `send_email` binding 的注释，将其限制到指定发件人，并把 `vars.IG_EMAIL_FROM` 设为相同地址。binding 与发件人必须同时存在；Worker 应用代码不需要 API token。向任意收件人发送目前要求 Workers Paid，启用前请核对最新的 [Cloudflare 定价](https://developers.cloudflare.com/email-service/platform/pricing/)。邮箱始终可选，不是登录名，也不是唯一恢复方式。

真实账号 ID、数据库 ID、桶名、域名与密钥只能放在被忽略的部署配置或 Cloudflare Secret 中，绝不能提交。

#### Cloudflare 边缘滥用防护清单

应用内限额是 Worker、D1、R2 与 Durable Object 工作量的最后一道保护。开放生产流量前，还必须核验源码无法配置或证明的账号级边缘控制：

- 所有公开 DNS 记录都通过 Cloudflare 代理，移除可直连源站的备用域名，并且不开放 R2 公网域名。D1 权威媒体只能经 Worker 完成授权读取。
- 生产环境保持关闭 `workers_dev` 与 preview URL，避免备用 Worker 域名绕过自定义域名策略。
- 启用账号可用的 Cloudflare 托管 WAF 规则，并为 `/api/auth/*`、`/api/search`、`/api/users`、`/api/guild-war/analytics`、`/api/media/*`、`/api/health` 与 `/ws` 设置账号级限流。认证与昂贵读取应比已缓存 HTML 或公开媒体使用更严格的预算。
- 只在确认普通 API 与 WebSocket 客户端不会被误挑战后启用账号可用的机器人管理功能；绝不能在 `/api/health` 前放交互式挑战。
- 为持续 Worker CPU、429/5xx、D1 读写、R2 操作/出口流量、Durable Object 连接数和异常费用增长设置告警。仓库中的 10% 可观测性采样只用于诊断，不能替代账号告警。
- 每次修改 route 或 binding 后，核实生产自定义域名指向预期 Worker 版本，并确认没有源站、preview 或开发域名仍可公开访问。

这些是部署前置条件，并不代表当前 Cloudflare 账号已经启用。每次发布前都要在 Dashboard 中核实。

### VPS 生产

先运行一次 setup，再编辑被忽略的 `apps/vps/.env`：

```bash
pnpm setup:local --runtime vps
pnpm config:check --runtime vps --config apps/vps/.env
```

将 `IG_PUBLIC_URL` 设为外部 HTTPS 源；将 `IG_DATABASE_PATH`、`IG_BLOB_PATH`、`IG_STATIC_PATH` 设为持久化绝对路径；当前模板不要求独立的应用密钥，仅在启用 OAuth 或邮箱验证时配置受保护凭据。让 `IG_HOST` 只监听 TLS 反向代理后的私网或回环地址。`IG_TRUSTED_PROXY_IPS` 只能填写由你运营的精确代理 IP。运行时解析出的可信客户端身份会划分认证限流；绝不能信任未列入该集合的对端传来的转发头。

如需可选 Google、Discord 或 KOOK OAuth，请创建供应商应用，在 VPS 的 `IG_PUBLIC_URL` 下登记上文相同的精确回调路径，并在受保护的 `.env` 中填写对应 ID/secret 对（Google 为 `IG_OAUTH_GOOGLE_CLIENT_ID` 与 `IG_OAUTH_GOOGLE_CLIENT_SECRET`，Discord、KOOK 同理）。只填一项会使配置无效；之后再到“管理后台 → 站点配置”开启对应供应商。删除凭据只会关闭该供应商，本地登录继续可用。本版本微信仍不可用。

如需 VPS 上的可选个人资料邮箱验证，必须同时配置 `IG_EMAIL_FROM`、`IG_CLOUDFLARE_EMAIL_ACCOUNT_ID` 和最小权限的 `IG_CLOUDFLARE_EMAIL_API_TOKEN`。VPS 通过站主自己的 Cloudflare Email Sending REST API 以 HTTPS 发送；它不自建 SMTP，本项目也不运营或付费维护共享邮件网关。三项全部留空时，只关闭邮箱管理。当前未实现手机/SMS。

使用专属操作系统账号保护 `.env`、SQLite 文件、Blob 根目录、备份和 `private-migrations/`。不要运行多个 VPS 应用进程、replica、Node cluster worker 或网络共享 SQLite writer。首版 VPS 只支持一台主机上的一个进程。

在 POSIX 主机上，正常 VPS 启动会自行设置 `0077` umask，不依赖 service manager 的设置。在创建、收紧或使用任一精确数据路径前，它会确认每个现存祖先都是真实目录，且所有者只能是 root 或服务账号。允许 group/other 写入的祖先必须带 sticky bit；配置的数据叶节点本身绝不能允许 group/other 写入。最终 canonical path 还必须与请求的 resolved path 一致。通过后，它会将 SQLite 的直接父目录与 Blob 根目录创建或收紧为 `0700`，将 SQLite 文件及当前存在的 `-wal`/`-shm` sidecar 创建或收紧为 `0600`。服务创建或访问某个精确 Blob 子目录/对象时，也会为该精确路径应用同样的模式；它绝不会递归修改现有目录树。

Node 没有可将整段路径遍历绑定到同一目录描述符的 `openat` 类 API，因此这些检查无法防住 root 或服务账号自身在多次系统调用之间竞态替换路径。必须阻止其他账号修改完整祖先链，也不得让另一个进程共用服务身份。Windows 运行时仍会拒绝点时检查中看到的符号链接/junction，并要求最终 canonical path 匹配，但不适用 POSIX 所有者和 mode 检查；请用 NTFS ACL 只授予专属服务账号控制配置的叶节点以及**所有能够重命名或替换这些节点的祖先**。

Blob 上传会同步完成的数据文件；在 POSIX 上，返回成功前还会同步已发布对象的目录项与临时文件删除。上传临时文件只存在于保留目录 `.infini-guild-blob-temp-v1`，绝不会进入 Blob inventory。之后每次上传都会在该目录做有界恢复：最多扫描 128 项、最多删除 16 个已至少一小时无活动且名称精确匹配的临时文件；不会扫描 Blob 树，也不会删除普通文件、近期文件或当前进程仍在使用的临时文件。

## 建立首位管理员

在 core schema 已存在且开放注册前完成此操作。初始 `admin` 角色等级为 1000，拥有全部权限，但它仍是 D1 中可编辑的角色；此步骤会建立首位角色拥有 `admin.roles.manage` 的有效用户。

先运行一次 `mkdir private-migrations` 创建被忽略的工作目录。

创建新管理员时，在当前 shell 中设置 `IG_BOOTSTRAP_PASSWORD`，但不要让该值进入命令历史。也可设置 `IG_PBKDF2_ITERATIONS`，然后生成私有 SQL：

```bash
pnpm prepare:first-admin --mode create --user-id admin-1 --login-name admin_login --display-name Admin_1 --output private-migrations/0001_first_admin.sql
```

如果要提升一个现有有效用户，请保持 `IG_BOOTSTRAP_PASSWORD` 未设置：

```bash
pnpm prepare:first-admin --mode promote --user-id existing-user-id --output private-migrations/0001_first_admin.sql
```

生成器会拒绝覆盖已有文件，也不会打印密码或 hash。完成后立即从 shell 清除 `IG_BOOTSTRAP_PASSWORD`。

VPS 上先停止服务并备份两类数据，再使用事务化私有迁移命令应用 SQL：

```bash
pnpm db:migrate-private:vps --database /srv/infini/data/infini-guild.sqlite --migration private-migrations/0001_first_admin.sql
```

该命令会在应用 SQL 前后校验 `app_migrations`、SQLite 完整性与外键；它拒绝嵌入式事务控制，使用 `BEGIN IMMEDIATE`，并在任何失败时回滚。

Cloudflare 刻意不提供自动远程私有迁移命令。备份后，将已审核 SQL 放入不入库的部署私有迁移目录，临时让被忽略的 Wrangler 配置把 `migrations_dir` 指向该目录，再由操作者明确运行上文所示的已获授权远程流程。私有 SQL 含 CASE 触发器时，使用上方受保护的 file-import 流程而非远程 `migrations apply`；不得转换或提交 SQL，也绝不手改任一账本。完成后恢复权威迁移目录。

## 生产启动与部署

### Cloudflare

```bash
pnpm release:check
pnpm cloudflare build
# 先备份，再由操作者明确应用已审核远程迁移。含触发器 SQL 使用经审计的 file-import 路径。
pnpm deploy:cloudflare
```

`deploy:cloudflare` 会发布代码与静态资源。授权前应核对所选 Cloudflare 账号、bindings、routes 与 migration 状态。

### VPS

```bash
pnpm release:check
pnpm vps build
pnpm db:migrate:vps --database /srv/infini/data/infini-guild.sqlite
pnpm verify:data:vps --database /srv/infini/data/infini-guild.sqlite --blobs /srv/infini/data/blobs
pnpm start:vps
```

让服务管理器以专属用户运行 `start:vps`。将工作目录设为仓库或发布根目录，并确保只有该用户可读 `apps/vps/.env`。在反向代理处终止 TLS，并将 `/api`、`/ws` 与静态请求转发到同一 Node 进程。开放流量前配置失败重启、优雅 `SIGTERM` 与持久磁盘挂载。

#### 反向代理加固

Node 进程只监听私网地址且不终止 TLS，因此反向代理负责传输层安全。开放流量前必须完成以下全部配置：

- 所有明文 HTTP 请求均以永久重定向（301/308）跳转到 HTTPS。
- HTTPS 响应发送 `Strict-Transport-Security: max-age=31536000; includeSubDomains`，与 Cloudflare 运行时保持一致。
- 使用 brotli 或 gzip 压缩文本响应（HTML、CSS、JavaScript、JSON、SVG）；Node 进程只输出未压缩字节。
- `/ws` 转发 `Upgrade` 与 `Connection` 头，并将客户端地址写入 `X-Forwarded-For`。后端只信任来自 `IG_TRUSTED_PROXY_IPS` 中精确 IP 的该头。

nginx 示例：

```nginx
server {
  listen 80;
  server_name guild.example.com;
  return 308 https://$host$request_uri;
}
server {
  listen 443 ssl;
  http2 on;
  server_name guild.example.com;
  ssl_certificate /etc/ssl/guild.example.com/fullchain.pem;
  ssl_certificate_key /etc/ssl/guild.example.com/privkey.pem;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;

  location /ws {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $remote_addr;
  }
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

使用 Caddy 时，HTTP→HTTPS 重定向会自动生效。补充 `header Strict-Transport-Security "max-age=31536000; includeSubDomains"`、`encode br gzip`，以及覆盖 `/ws` 的 `reverse_proxy 127.0.0.1:8787`；Caddy 会自动转发 WebSocket 升级。

## 维护模式

维护模式只用于需要协调修改数据库或 Blob 存储的工作。普通 Worker 部署是原子切换，不需要进入维护模式。两种运行时都直接内置维护响应，不会读取 D1/SQLite、R2/Blob 根目录、Portal 静态资源、WebSocket 或定时任务。

维护期间：

- 浏览器路由返回中英双语 Lightfall 维护页和 HTTP 503；
- API 返回标准 JSON 503；
- `/api/health` 不探测存储，直接返回 HTTP 200 与 `{ "ok": true, "maintenance": true }`；配置元数据后还会包含公开的 `reason` 与 `until` 字段；
- WebSocket 升级被拒绝，定时任务不会运行。

维护模式是应用入口拦截，不是数据库锁。冻结备份前须等待在途请求和活动任务租约结束。已有 Durable Object 连接及 alarm 不会被自动终止；不能仅凭维护页判断数据库已经静止。

可选的 `IG_MAINTENANCE_REASON` 会显示在公开维护页，长度最多 500 个字符。`IG_MAINTENANCE_UNTIL` 是可选的 UTC 标准 ISO 时间戳（`YYYY-MM-DDTHH:mm:ss.sssZ`），例如 `2026-08-30T12:00:00.000Z`。两者都会在运行时配置加载时校验，并在渲染 HTML 前转义。

### Cloudflare

操作 D1 或 R2 前，先设置可选 Worker Secret：

```powershell
'on' | pnpm exec wrangler secret put IG_MAINTENANCE_MODE `
  --config apps/cloudflare/wrangler.jsonc
```

`wrangler secret put` 会立即创建并部署一个 Worker 版本。普通部署会保留已有 Secret，因此发布兼容代码期间维护状态不会丢失。继续操作前，确认 `/` 返回 503、`/api/site-config` 返回 JSON 503，并且 `/api/health` 返回维护标记。

使用维护公开元数据时，可将以下可选 Worker 变量与模式 Secret 一起配置：

```jsonc
"vars": {
  "IG_MAINTENANCE_REASON": "Database maintenance",
  "IG_MAINTENANCE_UNTIL": "2026-08-30T12:00:00.000Z"
}
```

D1 与 R2 验证全部通过后，删除 Secret：

```powershell
pnpm exec wrangler secret delete IG_MAINTENANCE_MODE `
  --config apps/cloudflare/wrangler.jsonc
```

该命令同样会立即创建并部署一个 Worker 版本。随后验证登录、一个需要认证的读取、`/api/site-config`、一组图片 `view`/`full` 变体和资料音频。任一冒烟检查失败时，先把 Secret 重新设为 `on`，再调查或回滚。

### VPS

修改被忽略的 `apps/vps/.env`，然后重启唯一服务进程：

```dotenv
IG_MAINTENANCE_MODE=on
IG_MAINTENANCE_REASON=Database maintenance
IG_MAINTENANCE_UNTIL=2026-08-30T12:00:00.000Z
```

维护分支只启动 HTTP listener；不会打开 SQLite、检查 Blob 根目录、创建应用、启动 WebSocket 或调度任务。正常模式的启动失败仍会明确失败，绝不会被伪装成计划内维护。

成对完成 SQLite/Blob 操作并验证后，将值改为 `off`，重启服务，再验证登录、API、媒体和 WebSocket。任一检查失败时，立即改回 `on` 并再次重启。

## 备份与恢复

### VPS

1. 停止唯一应用进程，并确认它已经退出。
2. 将 SQLite 文件和完整 Blob 根目录复制到同一个带时间戳的加密快照中，保留文件权限与元数据。
3. 两份复制都完成后才能重启，并应定期在另一台主机演练恢复。

恢复时，停止服务，将损坏数据移开，同时恢复配对的 SQLite 与 Blob 快照，运行 `db:migrate:vps` 和 `verify:data:vps`，再启动服务并检查 `/api/health`。绝不能只恢复其中一侧：数据库记录负责授权精确 Blob key。

### Cloudflare

远程迁移或部署前，通过操作者明确授权的 Wrangler `d1 export --remote` 操作导出 D1。使用 S3 兼容备份工具，将每个 R2 对象及其元数据复制到独立存储。记录不含密钥的 Worker 配置与资源绑定，并将密钥保存在独立 secret manager。恢复到新的 D1/R2 资源后，核对记录数与对象元数据，更新被忽略的 bindings，再部署。源码、单独 D1 导出或单独 R2 对象版本记录都不是完整备份。

## 更新与 CI

无论使用哪种运行时，流程都是：阅读 release notes，停止写入或安排维护窗口，完整备份，使用锁定 pnpm 版本安装，运行 `release:check`，审核新迁移，向所选后端应用迁移，然后启动或部署并验证健康状态。

GitHub workflow 以两个仅限本地的独立任务运行 `release:check` 与隔离 Chromium E2E。它不会登录 Cloudflare、创建资源、操作远程 D1/R2、部署，也不会启动生产 VPS。

## 常见问题

- 缺少配置：重新运行 `pnpm setup:local --runtime cloudflare|vps`；已有文件会被保留。
- 端口已占用：先停止占用 5173 的服务；如使用 VPS，也停止占用 8787 的后端，然后重新运行命令。开发端口刻意保持固定；Cloudflare 不会静默跳到其他端口，因为这会破坏已配置的 Origin 与 Cookie。
- schema 503 或启动拒绝：确认所选数据库已应用共享迁移，且有序的 `app_migrations` 账本与当前 release 一致。绝不要绕过该检查。
- VPS 写竞争：确认只有一个应用进程打开 SQLite 文件，且该文件位于本地持久磁盘而不是 NFS/SMB。
- 上传失败：确认唯一 `BLOBS` binding 或 Blob 根目录可写且容量充足。不要创建第二个媒体命名空间。
- 安装求助：提供运行时、确切命令和已脱敏错误。移除密码、Cookie、有效邀请码、`.env`、`.dev.vars`、私有迁移、Cloudflare token 与公会数据。
