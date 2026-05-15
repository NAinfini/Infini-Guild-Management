<div align="center">

# Infini 公会管理门户

**别再用 Excel 管公会了。**

改一个配置文件，就能适配任何游戏的全栈公会管理站。

花名册 · 活动 · 战报分析 · 百科 · 相册 · 后台管理，一站搞定。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare)](https://workers.cloudflare.com/)

[English](./README.md) | [中文](./README.zh.md)

</div>

---

## 这东西能干嘛

你开了个公会，成员越来越多，事情越来越杂。花名册、排班、战报、公告、资料库……一开始用群文档凑合，后来发现记不住谁是谁、数据到处散落、换个游戏全部白搭。

这个项目就是来解决这个问题的。所有跟游戏相关的东西 —— 职业、属性、战报字段、角色定位 —— 都集中在一个配置文件里。换游戏？改配置就行。不用 fork，不用到处翻代码找硬编码。

> **简单说：** 一个配置文件适配任何游戏，部署到 Cloudflare，免费就能跑。

---

## 都有什么功能

| 模块 | 干什么用的 |
|---|---|
| **花名册** | 成员档案：职业、属性、简介、图片/音频/视频、在线时间表 |
| **活动** | 创建周期活动、设人数上限、报名锁定、看谁参加了 |
| **公告** | 富文本编辑，支持草稿、定时发布、归档、置顶 |
| **公会战** | 拖拽分队、录入战报数据、自动算 MVP |
| **战报分析** | 时长归一化、自定义计算指标 (KDA 等)、热力图、雷达图、贡献占比 |
| **百科** | 分类管理 + 富文本文章，给新人看的攻略库 |
| **相册** | 上传图片视频，带说明文字，云端存储 |
| **管理后台** | 权限管理、邀请链接、操作日志 (90 天热存 + 1 年冷备) |
| **全局搜索** | `Cmd+K` / `Ctrl+K` 搜成员、活动、公告、百科、战史 |
| **实时推送** | WebSocket 推送活动和战报的实时变动 |
| **中英双语** | 开箱即用，加语言只需要复制翻译文件夹 |
| **功能开关** | 不要的模块直接关，不用改代码 |

---

## 项目结构

```
apps/
├── shared/     校验、类型、游戏配置 —— 前后端共用
│                 ↕
├── worker/     后端 API (Hono + D1 数据库 + R2 存储 + WebSocket)
│                 ↕
└── portal/     前端页面 (React + Mantine UI)
```

前后端共享同一套 TypeScript 类型和校验逻辑。部署的时候前端打包成静态文件塞进 Worker 里 —— **一次部署一个地址**，不需要单独托管前端。

---

## 用了什么技术

| | |
|---|---|
| **前端** | React 19 · Vite 8 · TanStack Router & Query · Mantine 8 · Tailwind CSS 4 · Zustand 5 |
| **编辑器/图表** | TipTap 3 · ECharts 5 |
| **后端** | Hono + Cloudflare Workers · Drizzle ORM · D1 (SQLite) · R2 (对象存储) |
| **实时通信** | Cloudflare Durable Objects (WebSocket) |
| **数据校验** | Zod 4 —— 前后端共用同一份 schema |
| **表单** | react-hook-form + Zod |
| **国际化** | i18next |

---

## 怎么适配自己的游戏

总共 5 步，核心就是改一个文件。

### 第 1 步 · 写游戏配置

把 `apps/shared/games/definitions/yan-yun.ts` 复制一份，按自己的游戏改：

```typescript
// apps/shared/games/definitions/my-game.ts
import type { GameDefinition } from "../types";

export const myGame: GameDefinition = {
  id: "my-game",
  name: "我的游戏",

  // 职业
  classes: [
    { id: "warrior", label: "战士", colorGroup: "red",   role: "tank" },
    { id: "mage",    label: "法师", colorGroup: "blue",  role: "dps" },
    { id: "priest",  label: "牧师", colorGroup: "green", role: "healer" },
  ],

  // 职业对应的颜色 (花名册、图表里会用到)
  classColorMapping: {
    warrior: "var(--mantine-color-red-6)",
    mage:    "var(--mantine-color-blue-6)",
    priest:  "var(--mantine-color-green-6)",
  },

  // 角色定位 (头像角标上显示)
  roles: [
    { id: "tank",   label: "坦克", color: "blue",  avatarColor: "#4dabf7", icon: "IconShield" },
    { id: "dps",    label: "输出", color: "red",   avatarColor: "#ff6b6b", icon: "IconSword" },
    { id: "healer", label: "治疗", color: "green", avatarColor: "#51cf66", icon: "IconHeart" },
  ],
  defaultRole: "dps",

  // 成员卡片上显示的属性
  profileStats: [
    { key: "power", label: "战力", type: "number", sortable: true },
  ],

  // 公会战相关
  war: {
    enabled: true,
    featureLabel: "guild-war:title",
    resultOptions: ["victory", "defeat", "draw"],
    teamObjectives: [
      { key: "score", label: "guild-war:conclude.score", hasBothSides: true },
    ],
    memberStats: [
      { key: "kills",   label: "guild-war:stats.kills",   aggregations: ["total", "average", "best"] },
      { key: "deaths",  label: "guild-war:stats.deaths",  aggregations: ["total", "average", "best"], lowerIsBetter: true },
      { key: "damage",  label: "guild-war:stats.damage",  aggregations: ["total", "average", "best"] },
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

  // 活动类型
  eventTypes: [
    { id: "guild_war", label: "公会战", icon: "IconSwords", color: "red" },
    { id: "raid",      label: "副本",  icon: "IconTarget", color: "orange" },
    { id: "social",    label: "日常",  icon: "IconUsers",  color: "blue" },
  ],
};
```

### 第 2 步 · 切换激活

```typescript
// apps/shared/games/index.ts
export { myGame as activeGame } from "./definitions/my-game";
```

### 第 3 步 · 补翻译

配置里的 `label` 字段对应 i18n 的 key，在这两个文件里加上：
- `apps/portal/i18n/en/guild-war.json`
- `apps/portal/i18n/zh/guild-war.json`

### 第 4 步 · 换上你的品牌

改 `apps/worker/wrangler.jsonc` 里的变量：

```jsonc
"vars": {
  "SITE_NAME": "你的公会名",
  "SITE_LOGO_URL": "/your-logo.webp",  // 图片放到 apps/portal/public/ 下
  "PORTAL_ORIGIN": "https://your-domain.com"
}
```

把 `apps/portal/public/guild-logo.webp` 替换成自己公会的 Logo。

### 第 5 步 · 关掉不需要的功能 (可选)

改 `apps/shared/config/features.ts`：

```typescript
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  announcements: true,
  events: true,
  guildWar: false,  // 不打公会战？关了
  gallery: true,
  wiki: true,
  tools: true,
};
```

也可以不改代码，直接在 `wrangler.jsonc` 的 vars 里加 `FEATURES` 环境变量覆盖：

```jsonc
"vars": {
  "FEATURES": "{\"guildWar\":false,\"wiki\":false}"
}
```

---

## 本地跑起来

### 需要什么

- Node.js 20+
- pnpm 10+
- Cloudflare 账号 (只有上线才需要，本地跑不用)

### 两条命令就行

```bash
pnpm install
pnpm dev          # 启动后端 + 前端 + 自动灌数据
```

打开 `http://localhost:5173`，用下面的账号登：

| 用户名 | 密码 | 身份 |
|---|---|---|
| `admin` | `admin123` | 管理员 |
| `mod_1` | `moderator123` | 管理组 |
| `member_01` | `member1234` | 普通成员 |

### 所有命令速查

| 命令 | 干什么 |
|---|---|
| `pnpm dev` | 一键启动全部 |
| `pnpm dev:worker` | 只启动后端 (`http://127.0.0.1:8787`) |
| `pnpm dev:portal` | 只启动前端 (自动代理后端) |
| `pnpm build` | 打包前端 |
| `pnpm build:worker` | 后端部署预演 |
| `pnpm typecheck` | 跑类型检查 |
| `pnpm test` | 跑测试 |
| `pnpm lint` | 跑 lint |
| `pnpm db:generate` | 生成数据库迁移文件 |
| `pnpm db:studio` | 打开可视化数据库工具 |
| `pnpm db:mock:rebuild` | 清空本地数据库重建 |
| `pnpm db:mock:reset` | 只清空本地数据库 |
| `pnpm db:mock:init` | 跑迁移但保留数据 |
| `pnpm db:mock:seed` | 灌测试数据 (需要后端在跑) |

---

## 上线部署

```bash
# 1. 去 Cloudflare 控制台建一个 D1 数据库和 R2 存储桶

# 2. 把正式环境的 ID 和密钥填到 wrangler.jsonc 里

# 3. 跑迁移
wrangler d1 migrations apply <数据库名> --config apps/worker/wrangler.jsonc

# 4. 部署
wrangler deploy --config apps/worker/wrangler.jsonc
```

前端会打包成静态文件随 Worker 一起上线 —— 一个命令，一个地址，不用单独搞托管。

---

## 环境变量

### 后端 (`apps/worker/wrangler.jsonc`)

| 变量 | 说明 |
|---|---|
| `ENVIRONMENT` | `development` 或 `production` |
| `PORTAL_ORIGIN` | 允许访问的前端域名 |
| `SIGNING_SECRET` | 审计日志归档下载用的签名密钥 |
| `SITE_NAME` | 页面上显示的公会名 |
| `SITE_LOGO_URL` | 公会 Logo 的路径 |
| `FEATURES` | JSON 格式覆盖功能开关（如 `{"guildWar":false}`） |

### 前端 (`apps/portal/.env.local`)

| 变量 | 默认值 | 说明 |
|---|---|---|
| `VITE_WORKER_API_ORIGIN` | `http://127.0.0.1:8787` | 本地开发时后端地址 |

---

## 接口一览

所有接口在 `/api/` 下面，用 HttpOnly Cookie 做登录态。

| 路由 | 说明 |
|---|---|
| `/api/auth` | 登录、注册 (邀请制)、改密码 |
| `/api/users` | 花名册、个人资料、上传头像和媒体 |
| `/api/events` | 活动增删改查、报名 |
| `/api/announcements` | 公告管理 |
| `/api/guild-war` | 战报、分队、数据统计、分析 |
| `/api/wiki` | 分类和文章 |
| `/api/gallery` | 图片视频上传 |
| `/api/admin` | 成员管理、权限、邀请链接、审计日志 |
| `/ws` | WebSocket 实时推送 |

**权限等级：** `admin` > `moderator` > `member`，也支持自定义角色

**限流：** 登录注册 5 次/分 · 写操作 80 次/分 · 上传 20 次/分

---

## 安全措施

- HttpOnly Cookie —— 前端拿不到 token
- 前后端都做权限校验
- CSRF 防护 (`X-Requested-With` 头)
- 密码长度上限 128 字符，防 PBKDF2 慢哈希攻击
- 所有富文本过 DOMPurify 白名单
- 登录失败不告诉你是用户名错了还是密码错了
- 安全头全套：HSTS、CSP、X-Frame-Options DENY、nosniff

---

## 定时任务

| 周期 | 做什么 |
|---|---|
| 每天凌晨 (UTC) | 生成未来活动、清过期会话、归档审计日志、删孤立文件 |
| 每 15 分钟 | 归档过期活动、发布定时公告 |

---

## 开源协议

[MIT](./LICENSE) —— 随便用，注明出处就行。
