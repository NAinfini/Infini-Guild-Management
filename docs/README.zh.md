<div align="center">

# Infini 公会管理

**面向公会社区的双语、自托管一体化运营门户。**

将成员、活动、公会战、公告、知识、媒体、仓储与后台管理集中到一个响应式网站中。

[![CI](https://github.com/NAinfini/Infini-Guild-Management/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/NAinfini/Infini-Guild-Management/actions/workflows/ci.yml)
[![Release 1.0.0](https://img.shields.io/badge/release-v1.0.0-2ea44f)](https://github.com/NAinfini/Infini-Guild-Management/releases/tag/v1.0.0)
[![GitHub Stars](https://img.shields.io/github/stars/NAinfini/Infini-Guild-Management?style=flat&logo=github&cacheSeconds=300)](https://github.com/NAinfini/Infini-Guild-Management/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](../LICENSE)

[English](../README.md) · [中文](./README.zh.md)

[开始使用](./SETUP.zh.md) · [产品说明](./PRODUCT.zh.md) · [安全政策](./SECURITY.zh.md) · [参与贡献](./CONTRIBUTING.zh.md) · [1.0.0 更新](./CHANGELOG.zh.md#100---2026-09-05)

</div>

## 公会日常工作的统一入口

Infini Guild Management 将散落在表格、聊天置顶、媒体目录和临时工具中的信息收拢为一个事实来源。访客可以浏览公开内容，成员可以管理自己的资料与参与状态，管理人员则通过服务端权限和可审计操作协调公会事务。

- **成员与身份** — 花名册搜索、个人资料、职业、徽章、可用时间、缺席、邀请注册、账号安全和可选第三方登录。
- **活动协作** — 公告、周期活动、报名与配额、投票、抽奖、当前公会战规划、结算、战史与分析。
- **知识与资产** — 带修订记录的百科、图库图片与视频、成员媒体、共享仓储、数量与出入库流水。
- **后台管理** — 动态角色与权限、邀请、目录、站点配置、审计归档、错误、服务状态和系统测试。
- **完整体验** — 中英文、桌面与移动端任务一致、明暗/跟随系统主题、减少动效、自定义公会标识和页面场景图。

完整支持范围见[产品边界](./PRODUCT.zh.md)。

## 一套应用，两种部署目标

门户、HTTP 传输层、应用组合、领域规则与平台端口共同组成一套产品。运行时适配器只提供基础设施，业务行为不会因部署方式而分叉。

![共享应用架构：门户请求进入 HTTP 传输层，调用依赖内核端口的领域服务；应用组合层负责组装传输层与服务。](./diagrams/application-zh.svg)

每套安装只能选择一个运行时。Cloudflare 与 VPS 是二选一的方案，不能同时操作同一份应用数据。

![两种部署方案：Cloudflare Workers 配合 D1、R2、Durable Objects 和 Cron，或单个 Node.js 进程配合 SQLite、文件系统 Blob、WebSocket 和调度器。](./diagrams/deployment-zh.svg)

你可以使用 Cloudflare Workers、D1、R2 与 Durable Objects，也可以运行一个使用本地 SQLite 和文件系统 Blob 的 Node.js 进程。两种方案都从同一来源提供 SPA 与 API，并应用完全相同的迁移文件。

## 安全基线

- 权限由服务端强制执行；门户中的权限门控只负责调整界面。
- 会话使用 HTTP-only Cookie，服务端只保存令牌摘要。写操作要求允许的来源和 `X-Requested-With: XMLHttpRequest`。
- 新密码为 8–128 个字符，并包含大写字母、小写字母和特殊字符；数字可选，项目不维护常见密码集合。
- PBKDF2-SHA256 的默认值与最低值均为 **10,000 次迭代**，以适配 Cloudflare Workers 的 CPU 预算。自托管站主可在完成运行时基准测试后提高 `IG_PBKDF2_ITERATIONS`。
- 按来源和按来源/登录名组合的限流会在账号查询与密码计算前执行。富文本和上传媒体经过校验，受保护变更与其审计记录在同一个 SQL 事务中写入。

完整账号模型见[认证与账号安全](./AUTHENTICATION.zh.md)，漏洞请按[安全政策](./SECURITY.zh.md)私下报告。

## 本地启动

使用与 CI 一致的 Node.js **26.5.1** 和 pnpm **11.17.0**。全部依赖的精确版本由 `pnpm-lock.yaml` 确定。

```bash
pnpm install --frozen-lockfile

# Cloudflare 兼容的本地运行时
pnpm dev

# 或单进程 VPS 运行时
pnpm dev:vps
```

[安装与运维指南](./SETUP.zh.md)包含两种部署的绑定、密钥、首位管理员引导、备份、恢复、更新和生产部署流程。

## 1.0.0 Schema

1.0.0 版本只发布一个冻结的应用迁移，以及只含该迁移的 manifest：

```text
packages/persistence-sqlite/src/migrations/generated/0000_core.sql
packages/persistence-sqlite/src/migrations/generated/manifest.json
```

Cloudflare D1 与 VPS SQLite 应用完全相同的文件。不得编辑或重新生成已发布的 core。既有数据库必须遵循经过验证的 [D1 升级手册](./PRODUCTION_D1_UPGRADE.zh.md)，不能向业务表重新执行 core。后续 schema 变更必须新增下一个连续序号迁移及其精确 manifest 条目。

## 发布检查

```bash
pnpm release:check
pnpm exec playwright install chromium
pnpm test:e2e
```

发布门禁检查密钥泄露、依赖边界、运行时配置、三份类型检查配置、零警告 lint、测试及两种生产构建；浏览器端到端测试在 CI 中独立运行。Linux 上使用 `pnpm exec playwright install --with-deps chromium` 一并安装系统库。完整工具链、聚焦命令和本地端口设置见[贡献指南](./CONTRIBUTING.zh.md#复现-ci)。

## 文档

- **部署运维：** [安装指南](./SETUP.zh.md) · [生产 D1 升级](./PRODUCTION_D1_UPGRADE.zh.md)
- **了解项目：** [产品说明](./PRODUCT.zh.md) · [设计规范](./DESIGN.zh.md) · [视觉主题](./VISUAL_PRESETS.zh.md) · [素材归属](./THIRD_PARTY_ASSETS.zh.md)
- **安全保护：** [认证与账号安全](./AUTHENTICATION.zh.md) · [安全政策](./SECURITY.zh.md)
- **参与项目：** [贡献指南](./CONTRIBUTING.zh.md) · [更新日志](./CHANGELOG.zh.md)

欢迎通过[贡献指南](./CONTRIBUTING.zh.md)参与项目。如果它对你的公会有帮助，欢迎点亮 Star，让更多人找到它。

## 开源协议

[MIT](../LICENSE)
