# 自托管安装指南

本文档是本地安装、Cloudflare 部署、生产初始化、更新与安装故障排查的唯一事实源。README 只链接到这里，不重复维护这些命令。

English version: [SETUP.md](./SETUP.md)

## 需要准备

- [Node.js 24 LTS](https://nodejs.org/) 24.18.0 或更高版本
- pnpm 11.17.0（需要时运行 `npm install --global pnpm@11.17.0`）
- Git，或从 GitHub 下载的项目 ZIP
- 用于生产部署的 [Cloudflare 账号](https://dash.cloudflare.com/sign-up)

本地开发不需要 Cloudflare 账号。自定义域名也不是必需项；生产环境可以先使用 `*.workers.dev`。

## 1. 本地运行

在仓库根目录运行：

```bash
pnpm install
pnpm setup:local
pnpm dev
```

`pnpm setup:local` 会在 `apps/worker/wrangler.jsonc` 不存在时从 `wrangler.example.jsonc` 创建这份不入库的配置文件，并创建带随机本地 `SIGNING_SECRET` 的 `apps/worker/.dev.vars`。它不会覆盖已有配置或 `.dev.vars`。两份文件都已被 git 忽略，不要提交它们。

还有一步一次性安装：E2E 套件（`pnpm test:e2e` 与第 5 步的部署门禁都会运行它）需要 Playwright 浏览器：

```bash
pnpm exec playwright install chromium
```

门户启动后打开 `http://localhost:5173`。本地环境使用可随时重置的演示数据：

| 用户名 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `admin123` | 管理员 |
| `mod_1` | `moderator123` | 管理组 |
| `member_01` | `member1234` | 普通成员 |

`pnpm dev` 会重建本地 D1 并重新写入演示数据。这些账号绝不会自动进入生产环境。

## 生产数据库迁移政策

`apps/worker/db/migrations/0000_core_schema.sql` 是已冻结的 schema 基线：它代表完整的新数据库结构，永远不再编辑或替换。

- 新部署按顺序应用完整迁移链即得到当前 schema；已初始化的部署只应用尚未运行过的文件。
- 每一次 schema 变更都以新的单调编号增量迁移发布，并保护既有数据。任何部署应用过的迁移文件都不得再编辑。
- 绝不要手工修改生产 D1。只通过 Wrangler 应用经过审查的迁移，并在获准的远程迁移前备份生产数据。

数据库刻意不包含运行时游戏规则表。活动类型、战果、战绩键与 KDA 行为是源码拥有的契约，不是站点配置记录。

## 2. 连接 Cloudflare 并创建资源

`apps/worker/wrangler.jsonc` 是你这套部署的 manifest，并且刻意不入库：仓库只跟踪模板 `wrangler.example.jsonc`，`pnpm setup:local` 会把模板复制到位，`.gitignore` 则保证你的副本——连同真实的数据库 ID、桶名、域名与源站——不进版本控制。请把生产 D1 绑定、R2 绑定、路由和品牌信息填成自己拥有的资源。资源名称、ID 与路由是配置标识符，不是凭据；`SIGNING_SECRET` 和 Cloudflare API Token 才是真正的秘密，永远不要写进这个文件。

登录：

```bash
pnpm exec wrangler login
```

创建生产 D1，并更新 `DB` 绑定：

```bash
pnpm exec wrangler d1 create my-guild-db --binding DB --env production --update-config --config apps/worker/wrangler.jsonc
```

创建一个生产 R2 存储桶，并更新 `MEDIA` 绑定：

```bash
pnpm exec wrangler r2 bucket create my-guild-media --binding MEDIA --env production --update-config --config apps/worker/wrangler.jsonc
```

只需要一个 R2 绑定。`MEDIA` 桶同时保存内容媒体、审计归档数据，以及每月归档的权威 manifest。不要另建审计桶，也不要手工重写或删除生产 R2 对象。

资源名已被占用时请更换名称。绑定已有资源时，只修改对应的 `env.production` 绑定。

## 3. 配置生产变量与密钥

在 `apps/worker/wrangler.jsonc` 中连同资源绑定一起核对生产变量：

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "PORTAL_ORIGIN": "",
  "MEDIA_ORPHAN_DELETE_MODE": "report",
  "SITE_NAME": "我的公会",
  "SITE_LOGO_URL": "/guild-logo.svg"
}
```

普通的一体化部署请让 `PORTAL_ORIGIN` 保持为空。只有单独托管的前端需要调用这个 Worker 时才填写，并且必须是裸源站形式，例如 `https://portal.example.com`——不带路径、查询串或末尾斜杠。Worker 会拿请求的 Origin 与该值逐字比较，`pnpm config:check` 会直接拒绝永远匹配不上的值。

在审阅完整媒体扫描前，保持 `MEDIA_ORPHAN_DELETE_MODE=report`；[媒体清理章节](#媒体清理与-media_orphan_delete_mode)解释了两种模式与审阅流程。

`PBKDF2_ITERATIONS` 控制密码哈希成本。默认值 `10000` 是为了让一次登录派生落在 Workers 免费版 CPU 预算内；付费计划为什么应该调高、升级如何平滑生效，见[在 Workers 免费版上运行](#在-workers-免费版上运行)。

把生产密钥保存到 Cloudflare：

```bash
pnpm exec wrangler secret put SIGNING_SECRET --env production --config apps/worker/wrangler.jsonc
```

请使用很长的随机值。`SIGNING_SECRET` 同时用于签发审计归档下载 token，以及认证 Worker 到 Durable Object 的内部推送发布。它只能存放在 Cloudflare Secret 中；不要写入 `wrangler.jsonc`、`.env`、Issue 或提交。

验证 manifest：

```bash
pnpm config:check -- --env=production
```

看到下面内容才继续：

```text
[config] production configuration is ready.
```

## 4. 初始化 D1 并创建首位管理员

应用经过审查的迁移：

```bash
pnpm exec wrangler d1 migrations apply DB --remote --env production --config apps/worker/wrangler.jsonc
```

创建首位管理员：

```bash
pnpm setup:admin -- --env=production
```

该命令只在交互式终端运行，密码输入不会回显；密码必须为 12–128 个字符；只操作明确选择的生产环境；数据库已有任何用户时会拒绝运行；并会清理自己的临时 SQL 目录。密码哈希按默认成本写入；之后调高 `PBKDF2_ITERATIONS` 的话，首次登录会自动升级。后续用户都应通过管理后台创建的邀请链接注册。

## 5. 部署

运行：

```bash
pnpm deploy:production
```

该脚本会执行仓库的生产发布检查、构建门户、预演 Worker 部署，并把 Worker 与静态资源一起发布。不要改用裸 `wrangler deploy`，否则可能发布陈旧前端资源或跳过必要检查。发布门禁包含完整的 Playwright E2E 套件，整个命令可能运行数十分钟；如果第 1 步的 Playwright 浏览器没装，它会在早期直接失败。

部署完成后 Wrangler 会显示公开网址。打开它并使用第 4 步创建的管理员登录。

## 6. 在管理后台完成配置

进入 **管理后台 → 站点配置**，检查：

1. **品牌**：站点名称与上传的 Logo。
2. **功能**：`announcements`、`events`、`guildWar`、`gallery`、`wiki`、`tools`、`storage`。
3. **限制**：单文件上传限制、媒体数量配额、仓储物品图片数。
4. **政策**：展示给成员的请假政策。

随后在 **管理后台 → 邀请链接** 创建成员邀请。不要让任何其他账号复用首位管理员密码。

仓库自带的是部署中立的品牌素材，方便分叉从干净身份起步：`SITE_NAME` 与 `SITE_LOGO_URL` 只在首次启动时播种；`apps/portal/public/guild-logo.svg` 是中性的后备 Logo 资产，可直接替换文件，也可以在管理后台上传 Logo 覆盖它；`.github` 的 Issue 模板链接指向本仓库，公开分叉应改指自己的仓库，让求助与报告到达自己的维护者。

Wrangler 中的 `SITE_NAME` 与 `SITE_LOGO_URL` 是启动后备值。上传的 Logo 与运行时站点配置由应用保存。

## 每种配置应该改哪里

| 修改内容 | 唯一事实源 | 是否要部署 |
| --- | --- | --- |
| 站点名/Logo、七个功能开关、上传限制、媒体配额、仓储策略 | **管理后台 → 站点配置** | 不需要 |
| 成员资料、角色、权限、邀请、职业、职业标签、徽章 | 对应管理后台流程 | 不需要 |
| 公会战分析权重 | 带相应权限的 `/api/admin/analytics-settings` | 不需要 |
| D1、唯一 `MEDIA` R2 桶、环境、域名、后备品牌信息 | `apps/worker/wrangler.jsonc` | 需要 |
| `SIGNING_SECRET` | 通过 `wrangler secret put` 保存的 Cloudflare Secret | 需要 |
| 活动类型、战果、战绩定义、KDA 公式 | 共享源码契约；需要时配套新增量数据迁移 | 构建并部署 |
| 硬安全上限、限流、分页默认值 | `apps/shared/config/limits.ts` | 构建并部署 |

不存在 `FEATURES` 环境变量。不要制造第二套配置来源，也不要通过手工修改生产 D1 或 R2 来改变应用行为。

## 媒体清理与 MEDIA_ORPHAN_DELETE_MODE

每天 00:00 UTC 的维护任务会把 `MEDIA` 桶与数据库对账。两种模式都会做：增量重建媒体引用；逐前缀扫描超过 48 小时宽限期、且没有任何数据库行引用的对象；清理过期上传租约——上传后从未提交的暂存对象在两种模式下都会删除，因为一个到期都没获得引用的租约不可能对应真实内容。审计归档前缀永远不在扫描范围内。

`MEDIA_ORPHAN_DELETE_MODE` 只控制不可逆的那部分：

- `report`（默认）：只统计并记录孤儿候选，不删除任何其他内容。
- `delete`：删除孤儿对象，并清除软删除超过 7 天的用户的全部媒体。

先在 `report` 模式下运行并审阅至少一轮完整扫描。定时任务只把汇总写进日志，所以请用手动触发端点——它会返回完整汇总并持久记入审计日志（需要 `admin.roles.manage` 权限）。在已登录管理员会话的浏览器控制台执行：

```js
await fetch("/api/admin/maintenance/media-orphan-cleanup", {
  method: "POST",
  headers: { "X-Requested-With": "XMLHttpRequest" },
  credentials: "include",
}).then((r) => r.json());
```

连续几天核对各前缀的 `orphansFound`。孤儿应当解释得通——被删的内容、放弃的上传。刚从数据库备份恢复完就出现非零计数是危险信号：旧数据库配上更新的桶，会把真实内容判成孤儿。确认报告无误后，在 `wrangler.jsonc` 中把值改为 `delete` 并重新部署（vars 在部署时生效）。

## 在 Workers 免费版上运行

门户按 Workers 免费版可运行来设计。以下默认值都源自免费版的限制，升级后可逐项调高：

- **密码哈希。** 免费版把单次调用的 CPU 时间限制在约 10 毫秒，这是 `PBKDF2_ITERATIONS` 默认 `10000` 的原因——一次登录派生正好落在预算内。OWASP 对 PBKDF2-SHA256 的建议是 600,000 次，所以付费计划（CPU 上限 30 秒）应在生产 vars 中设置 `"PBKDF2_ITERATIONS": "600000"`。存储的哈希是自描述格式，任何时候改都安全：既有账号继续按存储时的成本校验，并在下一次成功登录时透明地升级到新成本。
- **媒体清理规模。** 每日扫描逐页列举桶内容，受单次调用子请求上限约束（免费版 50、付费版 1,000），媒体库特别大的免费版部署可能一轮跑不完整个扫描。上面的手动触发端点可以按需补跑。
- **日志保留。** 定时任务的汇总只进 Workers Logs，免费版保留期很短。手动清理触发则把汇总记入应用自己的审计日志，不依赖 Workers Logs。

升级在 Cloudflare 控制台完成（Workers & Pages → 计划）；除了上述 vars 不需要改任何代码。

## 可选：自定义域名

在配置检查前选择一种生产访问方式：

1. 使用 `workers.dev`：保持模板默认的 `env.production.workers_dev` 为 `true`，不配置 `routes`。
2. 使用 Cloudflare 管理的自定义域名：把 `workers_dev` 设为 `false`，并添加自己域名的 `routes` 条目（模板里有注释示例），例如 `guild.example.com`。
3. 运行 `pnpm config:check -- --env=production`。
4. 运行 `pnpm deploy:production`。

门户与 API 通常保持同源，因此 `PORTAL_ORIGIN` 仍可留空。

## 更新已初始化站点

在获准迁移前先备份生产数据，然后运行：

```bash
pnpm install
pnpm config:check -- --env=production
pnpm exec wrangler d1 migrations apply DB --remote --env production --config apps/worker/wrangler.jsonc
pnpm deploy:production
```

已初始化站点绝不能再次运行 `pnpm setup:admin`、编辑已应用过的迁移文件，或直接修改生产 D1/R2。仓库发布的 schema 变化都以增量迁移提供。

## 常见问题

### 缺少 `wrangler.jsonc`

运行 `pnpm setup:local`，它会从 `wrangler.example.jsonc` 创建该文件。这个文件刻意不入库，所以新克隆的仓库在这一步之前不会有它。

### 配置检查提示占位符

按错误指出的具体字段处理。重新运行对应的 D1/R2 `--update-config` 命令，或只替换那一个生产值。

### Cloudflare 登录失败

```bash
pnpm exec wrangler logout
pnpm exec wrangler login
```

### 首位管理员命令提示已有用户

这是安全停止。请使用已有管理员。如果没有可用管理员，不要删除或修改生产数据；求助前删除凭据和私人公会数据。

### 端口 8787 或 5173 被占用

`pnpm dev` 依赖这两个固定端口：Worker 在 `http://localhost:8787`，Vite 必须占住 `http://localhost:5173`——开发环境的 CORS 白名单钉死了这个门户源站。Vite 配置了 `strictPort`，端口被占时立即失败，而不是悄悄挪去 5174（那会让所有带凭据的请求全部失效）。端口被占通常是上一个没退出的 `pnpm dev`；停掉它再重跑。Worker 起不来时，本地种子步骤也会在 60 秒后超时。

### E2E 报 "Executable doesn't exist"

运行一次 `pnpm exec playwright install chromium`。另外在 `pnpm test:e2e` 前先停掉 `pnpm dev`：E2E 槽位会启动自己的 Worker，与运行中的开发服务器抢端口。

### 无法上传

确认 `MEDIA` 指向唯一且正确的 R2 桶。持久化图片必须是 WebP 或 GIF；资料音频必须是包含 Opus 的 Ogg。Worker 会核对声明 MIME 类型与魔数，并拒绝 SVG。普通 API 请求体上限为 1 MiB，上传请求为 32 MiB；更小的单文件限制位于站点配置。

### 安全地请求安装帮助

使用仓库的 **Setup help / 安装求助** Issue 表单，附上失败命令与完整错误。删除密码、Cookie、邀请码、`SIGNING_SECRET`、Cloudflare API Token 和私人公会数据。你的 `wrangler.jsonc` 里的资源标识符是配置，不是认证秘密——而且该文件本就不入库，不会被自动公开——但公开 Issue 中仍可自行遮盖不想展示的标识符。
