<div align="center">

# Infini 公会管理门户

**面向成员、活动、公会战、知识库、媒体、仓储与后台运营的自托管公会门户。**

React 门户与 Hono API 共用 TypeScript 契约，并一起部署到 Cloudflare Workers。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2-61dafb?logo=react)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare)](https://workers.cloudflare.com/)

[English](./README.md) | [中文](./README.zh.md)

[安装指南](./SETUP.zh.md) · [产品边界](./PRODUCT.md) · [贡献指南](./CONTRIBUTING.md) · [安全政策](./SECURITY.md)

</div>

---

## 项目概览

Infini Guild Management 把公会日常工作集中在一个双语、响应式门户中，不再让信息散落在表格、聊天置顶、媒体目录和临时工具里。Worker 同时提供 SPA 与 API，因此常规部署只使用一个来源和一个公开网址。

## 面向用户的能力

| 模块 | 当前能力 |
| --- | --- |
| 仪表盘与花名册 | 公开仪表盘摘要；可搜索的成员卡片；职业、徽章、属性、可用时间、资料、图片、视频链接、头像和可选资料音频 |
| 账号与个人资料 | 邀请注册、Cookie 会话、用户名/密码修改、资料编辑、缺席记录、媒体管理和资料称号样式 |
| 活动 | 六种固定活动类型、周期模板、附件、人数与职业配额、报名、参与者管理、投票、抽奖和自动归档 |
| 公告 | 富文本草稿、暂存图片、定时发布、置顶、归档和永久删除流程 |
| 公会战 | 进行中的分队与候选池、成员移动和角色标签、结算、战史、批量编辑、导出和分析 |
| 百科与图库 | 带修订和恢复能力的分类富文本文章；图库图片、外部视频、说明文字和管理操作 |
| 仓储 | 登录后使用的仓库结构、分类、物品、图片、数量与出入库记录 |
| 工具与设置 | 公开设置页和带骰子工具的工具页 |
| 管理后台 | 成员、邀请、角色与权限、审计归档/日志、错误与服务状态、站点配置、职业、职业标签、徽章和维护操作 |
| 搜索与更新 | 命令搜索，以及通过 Durable Object 提供的登录态 WebSocket 更新提示 |

### 页面访问边界

访客可读页面为 `/`、`/events`、`/roster`、`/announcements`、`/guild-war`、`/gallery`、`/wiki`、`/settings` 和 `/tools`。登录与邀请注册使用 `/login` 和 `/register`。`/profile`、`/storage`、`/storage/manage` 与 `/admin` 需要会话，所有高权限操作还会由 API 再次校验。

## 配置边界

“管理后台 → 站点配置”及其 API 契约负责站点名称与 Logo、功能开关、媒体策略、仓储策略和缺席策略。当前模块开关严格只有：

```text
announcements, events, guildWar, gallery, wiki, tools, storage
```

公会战分析设置使用单独的管理端点。

会影响已持久化活动与公会战数据的规则由源码拥有：

- 活动类型严格为 `weekly_mission`、`guild_war`、`social`、`poll`、`raffle`、`other`。
- 公会战战果严格为 `win`、`loss`、`draw`。
- KDA 公式为 `(kills + assists) / max(deaths, 1)`，消费者格式化前不会预先舍入。
- 团队与成员战绩定义只有一个源码拥有的 `name`，没有本地化 `labels` 或 `precision` 设置。

管理后台与站点配置都不能编辑这些规则。D1 不包含运行时游戏规则列或表。修改已持久化契约需要协调代码与数据迁移。

## 架构与技术栈

```text
apps/
├── shared/   Zod schema、共享类型、限制与源码拥有的领域契约
├── worker/   Cloudflare Workers 上的 Hono API，使用 D1、R2、Durable Objects
└── portal/   React SPA，使用 TanStack Router、TanStack Query、Mantine、Zustand
```

| 层 | 当前技术 |
| --- | --- |
| 前端 | React 19.2、Vite 8.2、Mantine 9.5、TanStack Router/Query、Zustand 5、原生 CSS + 自定义属性；不使用 Tailwind |
| 语言与校验 | 门户和 Worker 共用 TypeScript 6 与 Zod 4 |
| 内容与图表 | TipTap 3、ECharts 6 |
| 后端与数据 | Hono、Drizzle ORM、Cloudflare Workers、D1 |
| 对象与实时通信 | 一个 R2 `MEDIA` 存储桶和一个 WebSocket Durable Object |

唯一的 `MEDIA` 存储桶同时保存持久化内容媒体与审计归档。每个月的审计归档都由同一桶中的权威 `audit-archive/.../manifest.json` 提交；不存在第二个归档桶。

持久化上传内容为 WebP 图片（GIF 为保留动画而原样保存）以及 Ogg/Opus 资料音频。Worker 会把声明的 MIME 类型与检测到的魔数核对，还会校验 Ogg 内部的 Opus 编码，并拒绝 SVG。

## API 范围

所有 HTTP API 都位于 `/api/` 下；登录态使用 HTTP-only session cookie。

| 前缀 | 能力 |
| --- | --- |
| `/api/health`、`/api/site-config` | 健康检查与公开站点元数据/Logo |
| `/api/auth` | 登录、退出、邀请校验/注册、会话和用户名检查 |
| `/api/dashboard`、`/api/search` | 仪表盘摘要与门户搜索 |
| `/api/users` | 花名册、资料、属性、缺席、凭据和资料媒体 |
| `/api/events` | 活动、周期模板、附件、报名、投票、抽奖和参与者 |
| `/api/announcements` | 公告内容、图片、发布、归档和删除 |
| `/api/guild-war` | 当前战况、分队、战史、成员数据、导出和分析 |
| `/api/wiki`、`/api/gallery` | 百科分类/文章/修订/媒体，以及图库图片/视频 |
| `/api/storage` | 仓库结构、物品、图片、数量和出入库记录 |
| `/api/classes`、`/api/class-tags`、`/api/badges` | 运行时目录和徽章授予 |
| `/api/admin`、`/api/admin/maintenance` | 用户、邀请、角色、站点配置、分析设置、审计/错误/状态数据、系统测试和维护 |
| `/ws` | Durable Object 支持的登录态 WebSocket 入口 |

写操作必须通过来源与 `X-Requested-With` 检查。Worker 还会分别限制认证、读取、写入、上传和凭据修改的请求速率。

## 定时维护

| 周期 | 当前任务 |
| --- | --- |
| 每天 00:00 UTC | 审计归档、媒体孤儿扫描/清理、错误日志清理 |
| 每 15 分钟 | 活动实例生成、抽奖开奖、会话清理、定时公告发布，随后执行活动自动归档 |

生产以 `MEDIA_ORPHAN_DELETE_MODE=report` 起步，破坏性媒体清理在运维审阅完整扫描前保持选择性开启。管理台的 API 测试控制台始终可用，由管理员权限把关：测试运行创建的每一个夹具都登记在服务端运行注册表里，运行结束时按精确 ID 删除。

## 安装与部署

[SETUP.zh.md](./SETUP.zh.md) 是环境要求、本地开发、首次生产初始化、Cloudflare 资源、迁移、部署、更新与故障排查的唯一事实源。对应英文指南为 [SETUP.md](./SETUP.md)。

核心迁移是已冻结的 schema 基线；每次 schema 变更都以新增量迁移发布。完整政策见安装指南，包括如何在 Workers 免费版上运行、升级后应调高哪些配置。

## 安全

服务端权限校验是权威来源。会话使用 HTTP-only Cookie；富文本经过清洗；安全响应头包含 CSP、HSTS、禁止嵌入与 `nosniff`。`SIGNING_SECRET` 同时保护审计归档下载 token 和 Worker 到 Durable Object 的内部推送发布。

发现漏洞时，请按 [SECURITY.md](./SECURITY.md) 私下报告。

## 开源协议

[MIT](./LICENSE)
