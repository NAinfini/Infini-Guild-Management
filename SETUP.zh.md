# 自托管安装指南

本指南从全新下载开始，一步步完成本地试用和 Cloudflare 正式部署。无需自己购买或维护服务器：Cloudflare Worker 会同时提供网页和 API。

English version: [SETUP.md](./SETUP.md)

## 需要准备

- 安装 [Node.js 24 LTS（24.18.0 或更高版本）](https://nodejs.org/)
- pnpm 11.17.0；若 `pnpm --version` 报错，运行 `npm install --global pnpm@11.17.0`
- 一个 [Cloudflare 账号](https://dash.cloudflare.com/sign-up)
- Git，或从 GitHub 下载的项目 ZIP

不需要自定义域名，首次部署可直接使用免费的 `*.workers.dev` 地址。

## 1. 先在电脑上试运行

在项目目录中依次运行：

```bash
pnpm install
pnpm setup:local
pnpm dev
```

`setup:local` 会创建两个已被 Git 忽略的私人文件：

- `apps/worker/wrangler.jsonc`：你的 Cloudflare 配置
- `apps/worker/.dev.vars`：自动生成的本地签名密钥

已有文件不会被覆盖，也不要把这两个文件加入 Git。

终端显示前端已启动后，打开 `http://localhost:5173`。本地环境会使用可随时重置的演示数据：

| 用户名 | 密码 | 权限 |
| --- | --- | --- |
| `admin` | `admin123` | 管理员 |
| `mod_1` | `moderator123` | 管理组 |
| `member_01` | `member1234` | 普通成员 |

再次运行 `pnpm dev` 会重置本地数据库。这些演示账号绝不会自动写入生产环境。

## 2. 连接 Cloudflare

在终端登录：

```bash
pnpm exec wrangler login
```

浏览器会打开 Cloudflare 授权页。授权完成并看到终端确认后再继续。

创建生产 D1 数据库，并让 Wrangler 自动更新 `DB` 绑定：

```bash
pnpm exec wrangler d1 create my-guild-db --binding DB --env production --update-config --config apps/worker/wrangler.jsonc
```

创建生产 R2 存储桶，并自动更新 `MEDIA` 绑定：

```bash
pnpm exec wrangler r2 bucket create my-guild-media --binding MEDIA --env production --update-config --config apps/worker/wrangler.jsonc
```

若提示名称已存在，请换一个名称；也可以把已有资源的名称和 ID 手动填入 `env.production`。

## 3. 设置站点名称和密钥

打开 `apps/worker/wrangler.jsonc`，只修改生产环境中的这些值：

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "PORTAL_ORIGIN": "",
  "SITE_NAME": "我的公会",
  "SITE_LOGO_URL": "/guild-logo.webp"
}
```

正常的一体化部署请保持 `PORTAL_ORIGIN` 为空。只有前端放在另一个域名、需要跨域调用 API 时才填写。

把生产签名密钥安全地保存到 Cloudflare：

```bash
pnpm exec wrangler secret put SIGNING_SECRET --env production --config apps/worker/wrangler.jsonc
```

按提示粘贴一个很长的随机值。它只应存在 Cloudflare 中，不要写进 `wrangler.jsonc`、`.env`、GitHub Issue 或 Git 提交。

检查配置：

```bash
pnpm config:check -- --env=production
```

看到下面内容才继续：

```text
[config] production configuration is ready.
```

## 4. 建立生产数据库和首位管理员

应用数据库迁移：

```bash
pnpm exec wrangler d1 migrations apply DB --remote --env production --config apps/worker/wrangler.jsonc
```

创建首位管理员：

```bash
pnpm setup:admin -- --env=production
```

这个命令会：

- 只在交互式终端运行，输入密码时不回显；
- 要求密码长度为 12–128 个字符；
- 只操作明确指定的环境；
- 数据库已有任何用户时拒绝执行；
- 执行结束立即删除临时 SQL 文件。

后续成员一律使用管理员后台创建的邀请链接注册。

## 5. 正式部署

运行：

```bash
pnpm deploy:production
```

它会依次检查配置、构建 React 前端，然后把 Worker 与静态资源一起部署。完成后 Wrangler 会显示公开网址；打开它并用第 4 步创建的管理员账号登录。

如果页面空白或仍是旧版本，请再次运行 `pnpm build` 和 `pnpm deploy:production`。前端有改动后不要只运行裸 `wrangler deploy`，否则可能部署旧的前端产物。

## 6. 在管理后台完成设置

进入 **管理后台 → 站点配置**，逐项检查：

1. **品牌**：站点名称和 Logo。
2. **功能**：公告、活动、公会战、图库、Wiki、工具、装备计算器和仓库。
3. **限制**：单文件上传上限、媒体数量配额、仓库物品图片数。
4. **新成员引导**：规则、是否必须确认，以及入会检查清单。

然后进入 **管理后台 → 邀请链接**，创建第一条成员邀请。不要让其他账号复用首位管理员的密码。

后台设置保存在 D1 中。Wrangler 中的 `SITE_NAME` 和 `SITE_LOGO_URL` 是应用启动期间使用的安全后备值。

## 每种设置应该改哪里

| 想修改的内容 | 正确位置 | 是否要重新部署 |
| --- | --- | --- |
| 站点名、Logo、功能开关、媒体配额、新成员引导 | **管理后台 → 站点配置** | 不需要 |
| 成员角色、权限、邀请链接 | **管理后台** | 不需要 |
| D1、R2、域名、环境、后备品牌信息 | `apps/worker/wrangler.jsonc` | 需要 |
| Cloudflare 签名密钥 | `wrangler secret put` | 需要 |
| 游戏职业与职业标签 | **管理后台 → 职业管理** | 不需要 |
| 公会战分析权重 | `/api/admin/analytics-settings` | 不需要 |
| 已持久化的活动、战果和战绩键 | 共享领域契约并配套数据迁移 | 需要 |
| 请求硬上限、限流、分页默认值 | `apps/shared/config/limits.ts` | 构建并部署 |

项目不存在 `FEATURES` 环境变量。运行时模块开关统一放在“管理后台 → 站点配置”，避免出现两套互相冲突的配置来源。

## 可选：绑定自己的域名

生产示例默认使用 `workers_dev: true`，因此无需域名。若域名已托管在 Cloudflare：

1. 把 `env.production` 下的 `workers_dev` 改成 `false`。
2. 取消示例 `routes` 的注释。
3. 把域名改成自己的地址，例如 `guild.example.com`。
4. 运行 `pnpm config:check -- --env=production`。
5. 运行 `pnpm deploy:production`。

网页与 API 同域时，`PORTAL_ORIGIN` 仍可留空。

## 更新已有站点

重大更新前先备份 D1，然后运行：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm exec wrangler d1 migrations apply DB --remote --env production --config apps/worker/wrangler.jsonc
pnpm deploy:production
```

已有站点不要再次运行 `pnpm setup:admin`。

## 常见问题

### 提示找不到 `wrangler.jsonc`

运行 `pnpm setup:local`。若已有私人配置，把它复制到 `apps/worker/wrangler.jsonc`。

### 检查提示仍有占位符

错误会指出具体字段。重新运行 D1 或 R2 的 `--update-config` 命令，或只替换 `env.production` 中对应的值。

### Cloudflare 登录失败

先运行 `pnpm exec wrangler logout`，再运行 `pnpm exec wrangler login`。

### 首位管理员命令提示已有用户

这是安全停止，不是程序故障。请使用已有管理员登录。如果数据库确实没有管理员，不要删除生产数据；提交安装求助 Issue，并先删除所有密钥和资源 ID。

### 无法上传

确认 `MEDIA` 绑定指向正确的 R2 存储桶。普通 API 写请求的整体上限为 1 MiB，上传路由为 32 MiB；更小的单文件限制可在 **管理后台 → 站点配置** 中调整。

### 安全地求助

使用仓库的 **Setup help / 安装求助** Issue 表单。可以粘贴命令和错误信息，但必须删除：

- 密码、Cookie、邀请 ID/邀请码和签名密钥；
- Cloudflare API Token；
- D1 数据库 ID、账号 ID 和私人域名。
