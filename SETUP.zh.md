# 自托管安装指南

本文是模块化后端的权威安装指南。每套部署必须二选一：

| 运行时 | 数据库 | Blob | 实时与调度 | 进程模型 |
| --- | --- | --- | --- | --- |
| Cloudflare | D1 | 一个 `BLOBS` R2 桶 | Durable Object 与 Cron Triggers | Cloudflare 托管 |
| VPS | 一个本地 SQLite 文件 | 一个文件系统根目录 | 进程内 WebSocket hub 与 scheduler | 一个 Node.js 进程 |

两端共用应用服务、HTTP 路由、Drizzle schema 和 core migration。绝不能让 Cloudflare 与 VPS 各自修改一份数据后再尝试合并。

English version: [SETUP.md](./SETUP.md)

## 环境要求

- Node.js 24.18.0 或更新版本
- pnpm 11.17.0
- Git 或源码压缩包
- Cloudflare：支持 Workers、D1、R2、Durable Objects、Cron Triggers 与 Rate Limiting 的账号
- VPS：当前 64 位 Linux、持久磁盘、TLS 反向代理，以及 systemd 等服务管理器

在仓库根目录安装：

```bash
pnpm install --frozen-lockfile
```

## 命令总览

| 用途 | 命令 |
| --- | --- |
| 创建本地配置 | `pnpm setup:local --runtime cloudflare` 或 `pnpm setup:local --runtime vps` |
| 开发 | `pnpm dev`（默认 Cloudflare）、`pnpm cloudflare dev` 或 `pnpm vps dev` |
| 构建共享门户 | `pnpm build:portal` |
| 本地构建 Cloudflare | `pnpm cloudflare build` |
| 本地构建 VPS | `pnpm vps build` |
| 检查两种运行时类型 | `pnpm typecheck` |
| 运行测试 | `pnpm test` |
| 生成 Drizzle SQL | `pnpm db:generate` |
| 组装预发布 core migration | `pnpm db:assemble` |
| 初始化/校验 VPS 数据库 | `pnpm db:migrate:vps --database <sqlite-path>` |
| 校验 VPS 数据库/Blob 快照 | `pnpm verify:data:vps --database <sqlite-path> --blobs <blob-root>` |
| 在 VPS 应用已审核私有 SQL | `pnpm db:migrate-private:vps --database <sqlite-path> --migration <sql-path>` |
| 准备首位站点所有者 | `pnpm prepare:site-owner -- ...` |
| 准备旧双列凭据 | `pnpm prepare:credential-import -- ...` |
| 启动 VPS | `pnpm start:vps` |
| 本地发布门禁 | `pnpm release:check` |
| 部署 Cloudflare | `pnpm deploy:cloudflare` |

`release:check` 只在本地执行：扫描已跟踪内容、校验两份模板、检查两端类型、运行测试并构建门户。它不会创建、迁移、部署或修改远程资源。`deploy:cloudflare` 与其刻意分离，是真实远程变更。

## 本地开发

### Cloudflare

```bash
pnpm dev
```

`pnpm dev` 默认执行 `pnpm cloudflare dev`。它会自动创建缺失且被忽略的本地配置与两个独立密钥，保留已有文件，然后把共享迁移和本地开发 seed 应用到 D1，在 8787 端口启动 Wrangler，并在 5173 端口启动 Vite；不需要 Cloudflare 登录或远程资源。

打开 `http://localhost:5173`。

### VPS

```bash
pnpm vps dev
```

该命令会在缺失时从 `scripts/templates/vps.env.example` 创建被忽略的 `apps/vps/.env` 和两个独立密钥，且不会覆盖已有文件。随后它初始化或校验 `data/infini-guild.sqlite`，应用与 Cloudflare 相同的本地开发 seed，在 8787 端口启动后端、在 5173 端口启动 Vite。打开 `http://localhost:5173`。

开发 seed 只会写入全新数据库，可安全重复执行，也不会进入生产迁移。使用密码 `admin123` 可登录 `admin`、`moderator_01`，以及任意 `member_01`–`member_08`，分别验证站点所有者、管理员和成员流程。种子覆盖全部活动类型、邀请码与公告状态、周期活动、投票、抽奖、Wiki 修订与还原、仓库流水类型、进行中及胜/负/平帮会战、图库、审计/错误记录，并写入可真实读取的本地 WebP/Ogg 媒体对象。若数据库已经存在非开发用户，seed 会直接跳过，避免把 mock 数据混入现有站点。

## 共享 schema 与迁移

权威预发布基线位于：

```text
packages/persistence-sqlite/src/migrations/generated/0000_core.sql
packages/persistence-sqlite/src/migrations/generated/manifest.json  # 只含一个 0000 条目
```

Cloudflare D1 与 VPS SQLite 使用完全相同的 `0000_core.sql` 字节。`app_migrations` 是应用自身的序号/校验和账本，也是运行时启动校验的权威来源；Cloudflare 还维护 `d1_migrations`，供 Wrangler 记录已经应用的文件。两张表归属不同、都必须保留；空、未知或错版 schema 会被拒绝，不会静默修补。

只有修改共享 Drizzle schema 的维护者才在预发布阶段运行：

```bash
pnpm db:generate
pnpm db:assemble
pnpm test
```

预发布开发期间，应从空的本地 generated migration 目录重新生成 `0000_core.sql`，再运行 `db:assemble` 加入已审核不变量、权威 seed、应用账本行与单条目 manifest。`db:assemble` 不是生产迁移命令。首次公开发布前，获准变更会替换这份基线；发布后，已经应用的文件不可修改，后续变更必须新增编号迁移。

本次预发布折叠取代了废弃的 `0000`–`0002` 历史。任何 `app_migrations` 已包含该链的现有 D1 或 VPS 数据库，都不能直接部署当前 exact manifest。下一次部署前必须先备份，再选择从当前 `0000_core.sql` 重建，或执行经过明确规划与验证的显式重基线。应用不会加入运行时兼容分支，也不会自动改写远程账本；除非操作者另行明确执行获准的 Wrangler `--remote` 命令，仓库命令绝不会修改远程 D1。

初始化或校验 VPS SQLite：

```bash
pnpm db:migrate:vps --database /srv/infini/data/infini-guild.sqlite
```

该命令只会向空数据库应用基线；未知非空数据库会被拒绝，随后校验精确的 `app_migrations` 账本、全部权威 schema 对象、SQLite 完整性与所有外键。

可用以下只读命令校验已停止的 VPS 部署、恢复快照或准备好的转移数据；它不会修改任一数据存储：

```bash
pnpm verify:data:vps --database /srv/infini/data/infini-guild.sqlite --blobs /srv/infini/data/blobs
```

校验器以只读方式打开 SQLite，并复用应用使用的 manifest 与 Blob inventory 服务。它会为缺失对象、元数据不一致及超过 24 小时的孤儿候选输出 JSON，发现任何问题时以非零状态退出。扫描期间必须停止应用写入，或针对成对快照运行，避免两个存储在扫描中发生变化。该命令不具备复制或删除能力。

Cloudflare 必须先备份目标、审核确切迁移与绑定，再由操作者亲自明确授权远程 Wrangler 操作：

```bash
pnpm exec wrangler d1 migrations apply DB --remote --config apps/cloudflare/wrangler.jsonc
```

仓库 setup、CI、测试与 release check 永远不会运行这条远程命令。

## 配置与密钥

两端的 `IG_PBKDF2_ITERATIONS` 默认都是 `10000`，可配置到 `10000000`。存储的 hash 自带成本；调高配置后，旧的有效 hash 会在用户下一次成功登录时升级。生产前应在实际运行时上基准测试，绝不能低于 10000。

### Cloudflare 生产

1. 把 `apps/cloudflare/wrangler.example.jsonc` 复制为被忽略的 `apps/cloudflare/wrangler.jsonc`。
2. 填写自己的 `DB`、`BLOBS`、`ASSETS`、`NOTIFICATIONS`，以及五个限流绑定：`AUTH_RATE_LIMITER`、`READ_RATE_LIMITER`、`MUTATION_RATE_LIMITER`、`UPLOAD_RATE_LIMITER`、`WEBSOCKET_RATE_LIMITER`。
3. 设置公开 HTTPS 源、允许源、routes 与 cron。
4. 把两个密钥写入 Cloudflare Secret，绝不能放进 `vars`：

```bash
pnpm exec wrangler secret put IG_INVITE_TOKEN_SECRET --config apps/cloudflare/wrangler.jsonc
pnpm exec wrangler secret put IG_AUDIT_DOWNLOAD_SECRET --config apps/cloudflare/wrangler.jsonc
```

5. 本地校验：

```bash
pnpm config:check --runtime cloudflare --config apps/cloudflare/wrangler.jsonc
```

真实账号 ID、数据库 ID、桶名、域名与密钥只能放在被忽略的部署配置或 Cloudflare Secret 中，不得提交。

### VPS 生产

运行一次 setup，然后编辑被忽略的 `apps/vps/.env`：

```bash
pnpm setup:local --runtime vps
pnpm config:check --runtime vps --config apps/vps/.env
```

把 `IG_PUBLIC_URL` 设为外部 HTTPS 源；把 `IG_DATABASE_PATH`、`IG_BLOB_PATH`、`IG_STATIC_PATH` 设为持久化绝对路径；两个密钥分别使用至少 32 字节的独立随机值。让 `IG_HOST` 只监听 TLS 反向代理后的私网/回环地址。`IG_TRUSTED_PROXY_IPS` 只能填写你控制的精确代理 IP。

使用专属操作系统账号保护 `.env`、SQLite、Blob 根目录、备份和 `private-migrations/`。不要运行多个 VPS 应用进程、replica、Node cluster worker 或网络共享 SQLite writer。首版 VPS 只支持一台主机上的一个进程。

## 建立首位 `site_owner`

在 core schema 已存在、开放注册前完成。之后的所有者必须通过登录后的管理流程维护。

先运行一次 `mkdir private-migrations` 创建已被忽略的工作目录。

创建新所有者时，在当前 shell 中设置 `IG_BOOTSTRAP_PASSWORD`，但不要让值进入命令历史；可选设置 `IG_PBKDF2_ITERATIONS`，然后生成私有 SQL：

```bash
pnpm prepare:site-owner --mode create --user-id owner-1 --username Owner_1 --output private-migrations/0001_site_owner.sql
```

若要提升一个现有有效用户，请确保未设置 `IG_BOOTSTRAP_PASSWORD`：

```bash
pnpm prepare:site-owner --mode promote --user-id existing-user-id --output private-migrations/0001_site_owner.sql
```

生成器拒绝覆盖文件，也不会打印密码或 hash。完成后立即从 shell 清除 `IG_BOOTSTRAP_PASSWORD`。

VPS 上先停止服务并备份两类数据，再用事务化私有迁移命令：

```bash
pnpm db:migrate-private:vps --database /srv/infini/data/infini-guild.sqlite --migration private-migrations/0001_site_owner.sql
```

该命令会在执行前后校验 `app_migrations`、SQLite 完整性与外键，拒绝嵌入式事务控制，使用 `BEGIN IMMEDIATE`，并在任意失败时回滚。

Cloudflare 刻意不提供自动远程私有迁移。备份后，把已审核 SQL 放入不入库的部署私有迁移目录，让被忽略的 Wrangler 配置暂时把 `migrations_dir` 指向该目录，再由操作者明确运行上文相同的 `wrangler d1 migrations apply ... --remote` 流程。完成后恢复权威迁移目录。绝不能提交该 SQL。

## 离线迁移旧双列密码

旧 Worker 把密码材料分存在 `password_hash` 与 `salt`。只导出必要行到私有 JSON：

```json
[
  { "user_id": "user-1", "password_hash": "pbkdf2-sha256$10000$...", "salt": "..." }
]
```

离线生成一次性 SQL：

```bash
pnpm prepare:credential-import --input private-migrations/legacy-credentials.json --output private-migrations/0002_credentials.sql
```

生成器最多校验 10,000 个唯一用户，不需要明文密码即可转换旧格式，断言每个目标用户存在，并拒绝覆盖输出。VPS 使用 `db:migrate-private:vps` 应用；Cloudflare 使用上文由操作者明确授权的私有 Wrangler migration 流程。输入和输出都不得进入源码、日志、工单或聊天；完成后按保留政策删除或加密归档。

## 生产启动与部署

### Cloudflare

```bash
pnpm release:check
pnpm cloudflare build
# 先备份，再由操作者明确应用已审核远程迁移。
pnpm deploy:cloudflare
```

`deploy:cloudflare` 会发布代码与静态资源。授权前必须核对 Cloudflare 账号、bindings、routes 和 migration 状态。

### VPS

```bash
pnpm release:check
pnpm vps build
pnpm db:migrate:vps --database /srv/infini/data/infini-guild.sqlite
pnpm verify:data:vps --database /srv/infini/data/infini-guild.sqlite --blobs /srv/infini/data/blobs
pnpm start:vps
```

让服务管理器以专属用户运行 `start:vps`，工作目录设为仓库/发布根目录，并确保只有该用户可读 `apps/vps/.env`。TLS 在反向代理终止，`/api`、`/ws` 与静态请求都转发到同一 Node 进程。开放流量前配置失败重启、优雅 `SIGTERM` 与持久磁盘挂载。

## 备份与恢复

### VPS

1. 停止唯一应用进程并确认退出。
2. 把 SQLite 文件和整个 Blob 根目录复制进同一个带时间戳的加密快照，保留权限与元数据。
3. 两份复制都完成后才能重启；定期在另一台主机演练恢复。

恢复时停止服务，把损坏数据移开，同时恢复配对的 SQLite 与 Blob 快照，依次运行 `db:migrate:vps` 和 `verify:data:vps`，再启动并检查 `/api/health`。绝不能只恢复其中一侧：数据库记录负责授权精确 Blob key。

### Cloudflare

远程迁移或部署前，由操作者明确授权 Wrangler `d1 export --remote` 导出 D1，并通过 S3 兼容备份工具把全部 R2 对象及元数据复制到独立存储。另行记录不含密钥的 Worker 配置与资源绑定，密钥保存在独立 secret manager。恢复到新的 D1/R2 资源，核对记录数与对象元数据，更新被忽略的 bindings，再部署。源码、单独 D1 导出或单独 R2 版本记录都不是完整备份。

## 更新与 CI

两端通用流程：阅读 release notes，停止写入或安排维护窗口，完整备份，使用锁定 pnpm 版本安装，运行 `release:check`，审核新迁移，向所选后端应用，然后启动/部署并检查健康状态。

GitHub workflow 只执行本地门禁，不登录 Cloudflare、不创建资源、不操作远程 D1/R2、不部署，也不启动生产 VPS。

## 常见问题

- 缺少配置：重新运行 `pnpm setup:local --runtime cloudflare|vps`；已有文件会被保留。
- 端口已占用：先停止占用 5173（以及 VPS 后端使用的 8787）的已有服务，再重新运行命令。开发端口会刻意保持固定；Cloudflare 不会静默跳到其他端口，因为这会破坏已配置的 Origin 与 Cookie。
- schema 503/启动拒绝：确认所选数据库已应用共享迁移，且有序的 `app_migrations` 账本与当前 release 一致；不要绕过校验。
- VPS 写竞争：确认只有一个应用进程打开 SQLite，且文件位于本地持久磁盘而非 NFS/SMB。
- 上传失败：确认唯一 `BLOBS` binding 或 Blob 根目录可写且容量足够；不要创建第二个媒体命名空间。
- 安装求助：提供运行时、确切命令和已脱敏错误。删除密码、Cookie、邀请 token、`.env`、`.dev.vars`、私有迁移、Cloudflare token 与公会数据。
