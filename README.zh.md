<div align="center">

# Infini 公会管理门户

**自托管的公会门户，用来管理成员、活动、战报、百科、媒体和后台工具。**

一个 Cloudflare Worker 加一个 React 应用，前后端共用 TypeScript 契约。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare)](https://workers.cloudflare.com/)

[English](./README.md) | [中文](./README.zh.md)

[安装指南](./SETUP.zh.md) · [贡献指南](./CONTRIBUTING.md) · [安全政策](./SECURITY.md)

</div>

---

## 项目概览

Infini Guild Management 是一个面向游戏公会的全栈管理门户。它把成员资料、活动报名、公告、战报、百科、媒体和后台管理放在一个系统里，避免核心信息散落在表格、聊天置顶和临时工具中。

项目围绕“游戏定义”设计。职业、角色定位、成员属性、活动类型、战报指标和界面标签都尽量放在共享 TypeScript 配置里，而不是硬编码到各处。这样换游戏或调整规则时，改动范围更小，也更容易维护。

部署方式也比较直接：React 前端会打包成静态资源，由同一个 Cloudflare Worker 提供 API 和页面。一次部署，一个访问地址。

## 功能

| 模块 | 内容 |
| --- | --- |
| 成员花名册 | 成员资料、职业、属性、简介、媒体和可用时间 |
| 活动 | 周期活动、人数上限、报名锁定和参与者管理 |
| 公告 | 富文本草稿、定时发布、归档状态和置顶 |
| 公会战 | 战史、分队工具、成员数据、模板和分析 |
| 百科 | 分类和富文本文章，用于沉淀公会资料 |
| 相册 | 基于云存储的媒体上传和说明文字 |
| 媒体 | 上传前在浏览器里就完成转码：图片转 WebP，音频转 Opus |
| 管理后台 | 角色、权限、邀请链接、审计日志和系统状态 |
| 工具 | 头衔样式工具、骰子工具，以及开发中的装备毕业率计算器 |
| 搜索 | `Cmd+K` / `Ctrl+K` 搜索门户内容 |
| 实时推送 | 通过 Cloudflare Durable Objects 提供 WebSocket 更新 |
| 本地化 | 内置英文和中文 |
| 功能开关 | 在管理后台的站点配置中控制各模块 |

## 项目结构

```text
apps/
├── shared/   Zod schema、共享类型、常量、游戏配置、API 契约
├── worker/   Cloudflare Workers 上的 Hono API，使用 D1、R2、Durable Objects
└── portal/   React SPA，使用 TanStack Router、TanStack Query、Mantine、Zustand
```

`shared` 是前后端的契约层。后端路由使用共享 Zod schema 校验数据，前端查询使用同一套类型，游戏相关逻辑也集中在这里。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19、Vite 8、TanStack Router、TanStack Query、Mantine 8、Zustand 5、原生 CSS + 自定义属性 |
| 富文本和图表 | TipTap 3、ECharts 6 |
| 后端 | Cloudflare Workers 上的 Hono、Drizzle ORM、Cloudflare D1 |
| 存储 | Cloudflare R2，用于媒体和审计归档 |
| 实时通信 | Cloudflare Durable Objects + WebSocket |
| 校验 | Zod 4，前后端共用 |
| 表单 | react-hook-form + Zod resolvers |
| 本地化 | i18next 和 react-i18next |

## 快速开始

### 环境要求

- Node.js 24 LTS（24.18.0 或更高版本）
- pnpm 11.17.0
- Cloudflare 账号，仅部署环境需要

本地开发不需要 Cloudflare 账号。

### 本地运行

```bash
pnpm install
pnpm setup:local
pnpm dev
```

`pnpm setup:local` 会创建已被 Git 忽略的本地配置和随机开发密钥，且不会覆盖已有文件。`pnpm dev` 随后会重建本地 D1 数据库，启动 Worker 和前端开发服务器，并写入 mock 数据。

打开 `http://localhost:5173`，使用下面任意账号登录：

| 用户名 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `admin123` | 管理员 |
| `mod_1` | `moderator123` | 管理组 |
| `member_01` | `member1234` | 普通成员 |

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm setup:local` | 安全创建本地私人配置和随机密钥 |
| `pnpm setup:admin -- --env=production` | 在空的生产数据库创建首位管理员 |
| `pnpm config:check -- --env=production` | 部署前检查绑定和占位符 |
| `pnpm dev` | 重建本地数据库，启动 Worker 和前端，并灌入数据 |
| `pnpm dev:all` | 只启动 Worker 和前端，不重建或灌数据 |
| `pnpm dev:worker` | 启动 Worker API，地址为 `http://127.0.0.1:8787` |
| `pnpm dev:portal` | 启动 Vite 前端开发服务器 |
| `pnpm build` | 构建前端 SPA |
| `pnpm build:worker` | 预演 Worker 部署 |
| `pnpm deploy:production` | 预检、构建并部署生产站点 |
| `pnpm typecheck` | 运行 TypeScript 检查 |
| `pnpm lint` | 检查 portal 和 worker 代码 |
| `pnpm test` | 运行 Vitest |
| `pnpm db:generate` | 生成 Drizzle 迁移 |
| `pnpm db:studio` | 打开 Drizzle Studio |
| `pnpm db:mock:rebuild` | 删除并重建本地 D1 数据库 |
| `pnpm db:mock:init` | 给本地 D1 应用迁移 |
| `pnpm db:mock:seed` | 通过运行中的 Worker 写入本地测试数据 |

## 适配其他游戏

大部分游戏相关行为都从 active game definition 开始。复制现有游戏定义，改成你的规则，再把它导出为 active game。

### 1. 创建游戏定义

复制 `apps/shared/games/definitions/yan-yun.ts`，例如新建：

```typescript
// apps/shared/games/definitions/my-game.ts
import type { GameDefinition } from "../types";

export const myGame: GameDefinition = {
  id: "my-game",
  name: "我的游戏",

  classes: [
    { id: "warrior", label: "战士", colorGroup: "red", role: "tank" },
    { id: "mage", label: "法师", colorGroup: "blue", role: "dps" },
    { id: "priest", label: "牧师", colorGroup: "green", role: "healer" },
  ],

  classColorMapping: {
    warrior: "var(--mantine-color-red-6)",
    mage: "var(--mantine-color-blue-6)",
    priest: "var(--mantine-color-green-6)",
  },

  roles: [
    { id: "tank", label: "坦克", color: "blue", avatarColor: "#4dabf7", icon: "IconShield" },
    { id: "dps", label: "输出", color: "red", avatarColor: "#ff6b6b", icon: "IconSword" },
    { id: "healer", label: "治疗", color: "green", avatarColor: "#51cf66", icon: "IconHeart" },
  ],
  defaultRole: "dps",

  profileStats: [
    { key: "power", label: "战力", type: "number", sortable: true },
  ],

  war: {
    enabled: true,
    featureLabel: "guild-war:title",
    resultOptions: ["victory", "defeat", "draw"],
    teamObjectives: [
      { key: "score", label: "guild-war:conclude.score", hasBothSides: true },
    ],
    memberStats: [
      { key: "kills", label: "guild-war:stats.kills", aggregations: ["total", "average", "best"] },
      { key: "deaths", label: "guild-war:stats.deaths", aggregations: ["total", "average", "best"], lowerIsBetter: true },
      { key: "damage", label: "guild-war:stats.damage", aggregations: ["total", "average", "best"] },
      { key: "healing", label: "guild-war:stats.healing", aggregations: ["total", "average", "best"] },
    ],
    computedStats: [
      {
        key: "kda",
        label: "guild-war:stats.kda",
        compute: (s) => (s.kills + (s.assists ?? 0)) / Math.max(s.deaths, 1),
      },
    ],
    mvpCategories: ["kills", "damage", "healing"],
    defaultTeamNames: ["甲队", "乙队"],
    modifierWeights: { kills: 1, damage: 1, healing: 1 },
  },

  eventTypes: [
    { id: "guild_war", label: "公会战", icon: "IconSwords", color: "red" },
    { id: "raid", label: "副本", icon: "IconTarget", color: "orange" },
    { id: "social", label: "日常", icon: "IconUsers", color: "blue" },
  ],
};
```

### 2. 切换 active game

```typescript
// apps/shared/games/index.ts
export { myGame as activeGame } from "./definitions/my-game";
```

### 3. 补充翻译

把游戏定义里用到的标签补到相关 i18n 文件，例如：

- `apps/portal/i18n/en/guild-war.json`
- `apps/portal/i18n/zh/guild-war.json`

### 4. 修改品牌信息

在本地 `apps/worker/wrangler.jsonc` 中设置站点名称、Logo 路径和前端来源（先从 `wrangler.example.jsonc` 复制）：

```jsonc
"vars": {
  "SITE_NAME": "你的公会名",
  "SITE_LOGO_URL": "/your-logo.webp",
  "PORTAL_ORIGIN": "https://your-domain.com"
}
```

Logo 可以放在 `apps/portal/public/` 下，也可以替换现有的 `guild-logo.webp`。

### 5. 关闭不需要的模块

站点管理员无需改代码。登录后进入 **管理后台 → 站点配置 → 功能** 即可修改模块开关。

新数据库记录使用的代码默认值位于 `apps/shared/config/features.ts`：

```typescript
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  announcements: true,
  events: true,
  guildWar: true,
  gallery: true,
  wiki: true,
  tools: true,
  equipmentCalc: true,
  storage: true,
};
```

## 部署

请按面向新手的[自托管安装指南](./SETUP.zh.md)操作。指南包含 Cloudflare 登录、D1/R2、密钥、数据库迁移、首位管理员、`workers.dev`、自定义域名、更新和故障排查。

首次设置完成后，生产更新使用：

```bash
pnpm exec wrangler d1 migrations apply DB --remote --env production --config apps/worker/wrangler.jsonc
pnpm deploy:production
```

项目不会创建任何默认生产密码。迁移完成后，仅运行一次 `pnpm setup:admin -- --env=production` 来安全创建首位管理员。

## 环境变量

### Worker (`apps/worker/wrangler.example.jsonc`)

| 变量 | 说明 |
| --- | --- |
| `ENVIRONMENT` | `development` 或 `production` |
| `PORTAL_ORIGIN` | 单独托管前端时允许的来源；同域部署请留空 |
| `SIGNING_SECRET` | 审计归档下载 token 的 HMAC 密钥 |
| `SITE_NAME` | UI 中显示的公会名称 |
| `SITE_LOGO_URL` | 前端提供的 Logo 图片路径 |

### Portal (`apps/portal/.env.local`)

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_WORKER_API_ORIGIN` | `http://127.0.0.1:8787` | Vite 开发代理使用的 Worker API 来源 |

## API 概览

所有 API 都在 `/api/` 下。登录态使用 HTTP-only session cookie。

| 路由 | 说明 |
| --- | --- |
| `/api/auth` | 登录、邀请注册、会话检查、用户名检查 |
| `/api/users` | 成员花名册、个人资料和资料媒体 |
| `/api/events` | 活动、周期规则、报名、投票和参与者 |
| `/api/announcements` | 富文本公告和发布状态 |
| `/api/guild-war` | 战史、分队、数据、分析和模板 |
| `/api/wiki` | 百科分类和文章 |
| `/api/gallery` | 相册条目和媒体上传 |
| `/api/admin` | 用户、角色、邀请、审计日志和状态 |
| `/api/game-data` | 装备计算器游戏数据和管理员版本管理 |
| `/ws` | Durable Object 支持的 WebSocket 入口 |

角色默认顺序为 `admin` > `moderator` > `member`。管理后台也支持自定义角色。

限流按路由组划分：认证、写操作、上传和 API 读取有各自的限制。

## 安全说明

- 会话保存在 HTTP-only cookie 中。
- 前端 RBAC 只负责交互体验，后端 RBAC 才是权威校验。
- 写操作需要 `X-Requested-With` CSRF 请求头。
- 密码输入限制为 128 字符，避免 PBKDF2 被滥用。
- 富文本 HTML 展示前会经过清洗。
- 登录失败返回通用错误，避免用户名枚举。
- 安全响应头包括 HSTS、CSP、`X-Frame-Options: DENY` 和 `nosniff`。
- 上传在服务端按图片白名单（JPEG、PNG、GIF、WebP、AVIF）加魔数双重校验；SVG 一律不收，落库的 content type 取自实际字节而非客户端声明的请求头。

发现安全漏洞时，请按 [SECURITY.md](./SECURITY.md) 私下报告。

## 定时任务

| 周期 | 任务 |
| --- | --- |
| 每天 00:00 UTC | 生成未来活动实例、清理会话、归档审计日志、删除孤立媒体 |
| 每 15 分钟 | 自动归档过期活动、发布定时公告、过期旧公告 |

## 开源协议

[MIT](./LICENSE)
