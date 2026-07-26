# 门户重设计 · 设计文档

- 日期：2026-07-26
- 状态：待 review
- 范围：`apps/portal` 全量前端 + `apps/worker` 相关数据模型与端点
- 位置约定：本仓库已有 `docs/plans/`，故 spec 放在同级 `docs/specs/`，不引入 `docs/superpowers/` 这一层

---

## 1. 背景

门户当前存在三类问题，性质完全不同，必须分开处理：

1. **视觉与一致性**：主色被当成万能色、页头无层次、Tab 有 5 套实现、表格与筛选器从未配齐。
2. **动线**：用户无法知道「自己有事要做」，只能逐页巡检。投票与抽奖被埋在 modal 第四层。
3. **数据模型**：公会战的子表挂着两个可空父键，同一对象在生命周期中途更换主键，导致服务端必须伪造占位数据。

第 3 类是根因，不修则第 1、2 类的改造会建立在错误结构上。

## 2. 已确认决策

| 决策 | 结论 |
|---|---|
| 门户定位 | 双主场并重：成员自助与干部批量作业都是核心，信息架构显式分层 |
| 成员侧高频排序 | 活动 > 信息消费 > 公会战 > 仓库 |
| 管理侧高频排序 | 活动 > 公会战 > 成员管理 > 仓库 |
| 视觉方向 | 换掉金色（润色重定） |
| 主色 | 三色可选：青瓷 `#2FB49C` / 靛蓝 `#6E93F7` / 紫罗兰 `#9C8CF5` |
| 主色归属 | 用户级，各自选，进 preferences store |
| 浅色模式 | 一等公民，纸张为暖白 `#FAF9F5`，与现有暖墨同色温 |
| 主题系统 | 集中化，单一 token 真相；禁用 `!important` 与写死值 |
| 动线方案 | A + C 分组：待办聚合入口 + 领域分组导航 |
| 待办位置 | 就是仪表盘 `/`，不新增导航项 |
| 投票 / 抽奖 | 收进活动，作为活动类型，拥有真实详情页 |
| 公会战 | 保留独立入口用于编排 / 战绩 / 结算 / 历史 / 分析，并在该页嵌入就地报名控件 |
| 公会战数据模型 | 作为 `events` 的扩展表，不新建独立聚合根（见 §5） |
| 仓库 | 定位为状态追踪器；**不做**申领审批功能 |
| Tab | 全部重做为单一共享组件，URL 同步为强制要求 |

## 3. 现状实测数据

所有数字均为本文档撰写时实测，非估计。

### 3.1 主题与样式

| 项 | 数量 | 位置 |
|---|---|---|
| `#D4A843` 金色字面量 | 349 处 / 39 文件 | 源码，已排除 `dist/` |
| `var(--token, #hex)` 兜底写法 | 2138 处 | 全前端 |
| `#1A1815` 暖墨字面量 | 399 处 | 全前端 |
| `#ffffff` 字面量 | 156 处 | 全前端 |
| `!important` | 33 处 / 6 文件 | `styles.css` 16 处最多 |
| 内联 `style={{}}` | 420 处 / 110 文件 | 其中 77 处含颜色 / 背景 / 边框 |
| 源 CSS 文件 | 32 个 | 另有 `dist/` 产物 32 个 |

**四套互相竞争的样式真相**：

1. Tailwind `@theme`（`styles.css:7-16`）— 6 个色 + 字体
2. CSS 自定义属性（`styles.css:19` `:root` / `:114` `.dark`）— 圆角、阴影、字号、层级
3. Mantine `createTheme`（`providers/ThemeProvider.tsx:23-165`）— **又一套**圆角、阴影、间距、字号 + 三条色阶
4. 32 个组件 CSS + 420 处内联 + 33 处 `!important`

第 2 与第 3 套是手工对齐的重复定义（`radius.md = 12px`、`h1 = 20px` 各写两遍）。

**`!important` 的真实来源**：`ThemeProvider.tsx:157-162` 用 Mantine `styles` 给 Menu 设了 `padding: 6px`、`item padding: 10px 14px`、`borderRadius: 8px`、`fontSize: 0.875rem`；`styles.css:294-327` 用 `.infini-context-menu-*` 把**相同数值**又写一遍并加 `!important` 取胜。删掉任一侧即可去掉这些 `!important`。

**金色被当成万能色**：导航激活态、主按钮、徽章、进度条、图表、以及 `.app-content` 的滚动条（`components/layout/AppShell.css:521` `scrollbar-color: var(--color-primary)`，宽 10px）。截图里邀请码表格右侧那条金色竖条即此滚动条，被圆角容器裁切所致 —— 不是表格自身的装饰。

**换主色的连带项**：`ThemeProvider.tsx:26-30` 的 `autoContrast: true` + `luminanceThreshold: 0.3` 是按金色相对亮度 0.31 手调的魔数，换色后失效。

**两套并行的模式信号**：深浅模式同时由 `.dark` 类名和 `data-mantine-color-scheme` 属性表达，选择器必须同时匹配两者才能取胜 —— `styles.css:650` 写成 `:root[data-mantine-color-scheme="light"]:not(.dark)`，`:717` 写成 `[data-mantine-color-scheme="dark"].dark`，另有 12 处 `.dark ...` 单独选择器。两个信号一旦不同步就出现半深半浅。S1 必须统一为**一个**模式信号。

**偏好存储不一致**：`locale` 在 preferences store，而 `theme-mode` 由 `ThemeProvider.tsx:186/193` 直接读写 `localStorage`，绕开 store。

### 3.2 页面与组件

**`PageLayout` 丢弃三个 prop**：`components/layout/PageLayout.tsx:47` 的 `PageLayoutRoot` 类型上声明了 `title` / `subtitle` / `icon`，函数只解构 `actions, children, className`。有 **11 个页面**在传这三个值（AdminPage、AnnouncementsPage、DashboardPage、EventsPage、GalleryPage、GuildWarPage、MyProfilePage、RosterPage、SettingsPage、ToolsPage、WikiPage），全部静默丢弃。

因此页面正文里**不存在页头**。屏幕上的标题来自全局顶栏 `components/layout/AppHeader.tsx:70` 的 `activePageTitle` —— 一个孤立 `<h1>`，无副标题、无图标、无面包屑，Tab 行紧接其下且上无所依。

**Tab 有 5 套实现**：

| 页面 | 实现 | 面板间距 | 状态存储 |
|---|---|---|---|
| Admin | 直接用 Mantine `Tabs` | 无 | URL `?tab=` |
| GuildWar | 私有 `PageTabs`（`GuildWarPage.tsx:48`，未共享） | `pt="sm"` | URL `?tab=` |
| Storage | 直接用，Tab = 仓库实体 | `pt="md"` | 组件 state |
| MyProfile | 直接用 | `pt="md"` | 组件 state |
| Wiki / Gallery | 另一种 | — | — |

后两者不进 URL：刷新即丢 Tab，无法分享。

**表格与筛选器从未配齐**：

- `InfiniTable` 4 处：AdminInviteSection、AdminUsersSection、WarHistoryDetail、WarHistoryTable
- `FilterToolbar` 4 处：AnnouncementFiltersCard、EventsFiltersCard、GalleryFiltersCard、WikiPage
- 裸 Mantine `Table` 3 处：AdminGameDataSection、ConcludeWarModal、GuildWarAnalyticsTab

三组几乎不重叠。批量操作无统一范式。

**页面体量**：ToolsPage 522 行、AdminPage 417、EventsPage 414、StoragePage 402、GuildWarPage 366，页面组件合计 4725 行。

### 3.3 路由

| 问题 | 位置 |
|---|---|
| `/events/$id` 不渲染任何内容，仅 fetch 标题后 `redirect` 回 `/events?eventId=` | `router.tsx:370-393` |
| 活动无法被稳定分享或收藏 | 同上 |
| 战役只能通过 `/guild-war?tab=history&warName=` 定位 | `router.tsx:40` |
| 一级导航 10 项平铺无分组 | `components/layout/AppSidebar.tsx:47-66` |

### 3.4 数据模型

**公会战子表挂两个可空父键**：

```
war_teams.war_history_id       → war_history.id   (nullable)
war_teams.event_id            → events.id         (nullable)
war_pool_members.war_history_id → war_history.id  (nullable)
war_pool_members.event_id       → events.id       (nullable)
```

进行中用 `event_id` 当身份，结算后换成 `war_history_id` —— 同一对象中途换主键，子行需改父键。后果：

1. `services/guild-war/GuildWarActiveService.ts:92` 必须凭空造 `virtual:${userId}` 假池成员，因为真实池行此时可能不存在。
2. 一个对象被拆成两个服务（`GuildWarActiveService` / `GuildWarHistoryService`）、两个 UI Tab、两套查询。
3. SQLite 此种声明无法表达「两个父键恰有一个非空」，非法行拦不住。

**本地真实 D1 实测**（`guild-portal-db --local`）：

| 指标 | 值 |
|---|---|
| `war_history` 行数 | 5 |
| 其中 `event_id IS NULL` | **0** |
| `war_teams` 行数 | 10，全部 `event_id IS NULL`（即以 history 为键） |
| `war_teams` 以 event 为键 | 0（当前无进行中战役） |
| `war_pool_members` 以 history 为键 | 15 |
| `war_team_members` | 33 |
| `type='guild_war'` 的活动 | 5 |
| `winner_count IS NOT NULL` 的活动 | 2 |
| `events` / `event_participants` / `event_polls` / `event_raffle_winners` | 21 / 118 / 3 / 4 |

关键结论：**现实中每场战役都有对应活动**（0 例外），因此把战役建成活动的扩展表不需要合成任何假活动。

**已存在的正确模式**：`event_polls`(PK=`event_id`) / `event_poll_options` / `event_poll_votes` / `event_raffle_winners` 一律以 `event_id` 为键，是标准的「核心表 + 类型扩展表」。公会战是唯一例外。

**一处不一致**：raffle 的 `winner_count` 写在核心表 `events` 上（`db/schema/events.ts:32`），而 poll 的设置在扩展表 `event_polls` 里。

**一处重复**：`war_history.war_name` 与 `events.title` 重复。`GuildWarHistoryService.ts:109` 在结算时把 `events.title` 复制进 `war_name`，说明生产写入路径视二者为同一事物；但 `createWarHistorySchema.event_id` 为 optional，手工 `POST /history` 可以给出不同名字。本地 5 行 `war_name` 与事件标题全部不同，但那是 seed 数据（`War Session A` vs `Guild War #1`）直接写入的，不能据此断定生产漂移。

### 3.5 仓库现状（重要修正）

「申领审批」不存在：`storage_transactions.type` 只有 `intake` / `distribute` / `adjust`（`db/schema/storage.ts:73`），无 pending 状态、无申请人 / 审批人字段。

但**成员自助已经完整存在**：`storage_items` 有 `allow_member_deposit` / `allow_member_withdraw` 逐物品开关；非管理者调 `POST /items/:id/transactions` 时 `recipient_user_id` 被强制改写为本人，两种操作分别由这两个开关放行（`services/StorageService.ts:212-217`）。前端已接上（`components/feature/storage/StorageItemCard.tsx:73-78`）。

因此「成员把东西放进仓库、查看有什么、需要时线下联系管理员」这条流程**服务端与前端均已具备**，仓库本轮**零新功能**。

---

## 4. 第一节 · 主题集中化

### 4.1 token 三层结构

hex 只允许出现在最底层。

- **L1 原始色板**（唯一含 hex）：3 主色各 7 档、中性 12 档、4 语义色各 5 档。
- **L2 语义 token**（只引用 L1，不含 hex）：`--surface-0..3`、`--text-primary/secondary/muted`、`--border` / `--border-strong`、`--accent-fill` / `--accent-tint` / `--accent-text` / `--accent-border` / `--accent-on-fill`。
- **L3 尺寸 token**：圆角、阴影、间距、字号、层级，各唯一定义一次。

**两个正交维度**：模式切换 = `[data-theme]` 重映射 L2；主色切换 = `[data-accent="teal|indigo|violet"]` 重映射 `--accent-*`。L1 与 L3 不参与切换。6 种组合不需要 6 套定义。

`[data-theme]` 取代现有的 `.dark` 类 + `data-mantine-color-scheme` 属性双信号（§3.1）。Mantine 需要的 `data-mantine-color-scheme` 由同一处代码派生写入，不作为独立真相，因此不再需要 `:not(.dark)` 这类互相防守的选择器。

### 4.2 主色色阶（已核算对比度）

深色底取 `#17161B`，浅色底取 `#FAF9F5` 上的纯白卡片。

| 主色 | 深色模式文字 | 比值 | 浅色模式文字 | 比值 | 填充上的文字 | 比值 |
|---|---|---|---|---|---|---|
| 青瓷 | `#2FB49C` | 6.9:1 | `#0F6E56` | 6.2:1 | `#04342C` on `#2FB49C` | 5.3:1 |
| 靛蓝 | `#6E93F7` | 6.1:1 | `#185FA5` | 6.5:1 | `#042C53` on `#6E93F7` | — |
| 紫罗兰 | `#9C8CF5` | 6.3:1 | `#534AB7` | 6.9:1 | `#26215C` on `#9C8CF5` | — |

**同一个 hex 不能同时服务两种模式**：青瓷 `#2FB49C` 直接作为浅色模式文字色对白底仅 **2.6:1，不合格**。故每主色需一对色阶。

### 4.3 Mantine 降级为消费者

`createTheme` 的 `colors` / `radius` / `shadows` / `spacing` / `headings` 全部改为读 `var(--…)`，不再自持数值。

**关闭 `autoContrast`**，改用显式 `--accent-on-fill`（每色每模式各算一次）。理由：按亮度阈值猜文字色正是 `luminanceThreshold: 0.3` 这类魔数的来源；显式声明后换主色无需重调阈值。

### 4.4 四条硬规则（全部可自动验证）

| 规则 | 检查方式 | 当前值 | 目标 |
|---|---|---|---|
| 不得出现 `var(--x, #hex)` 兜底值 | 断言 `var\(--[^,)]*, *#` 匹配数 | 2138 | 0 |
| 除 L1 色板文件外不得出现裸 hex | 断言其余 CSS 的 hex 匹配数 | 仅三色即 904（349+399+156），全量未逐一统计 | 0 |
| `!important` 归零 | 断言匹配数 | 33 | 0 |
| 模式信号唯一 | 断言 CSS 中不再出现 `.dark` 与 `data-mantine-color-scheme` 选择器 | 16 处 | 0 |

兜底值的危害不只是「改不掉颜色」：**token 名打错不会报错，会静默渲染成金色** —— 属于 `CLAUDE.md` 明令禁止的静默降级。清除后 token 缺失即为显式失败。

例外必须带注释说明理由并单独登记（对应「安全措施必须可见、有据、易关闭」）。

### 4.5 内联样式

420 处内联 `style={{}}` 中，**含颜色 / 背景 / 边框的 77 处必须迁出**（它们不随主题切换，是浅色模式失效的直接原因之一）。纯布局的（`gap` / `flex` / `width`）保留，不做无意义搬运。

### 4.6 偏好统一

主色与深浅模式一并进 preferences store，`ThemeProvider` 不再直连 `localStorage`，与 `locale` 同一条链路。

### 4.7 验收标准

- 四条硬规则断言全绿
- 3 主色 × 2 模式 = 6 组合，对 accent 文字、accent 填充上的文字、正文、次要文字四类各断言 WCAG 比值
- 界面行为零变化（本节不含功能改动）
- `pnpm typecheck` / `lint` / `test` 全绿

---

## 5. 第二节 · 信息架构与动线

### 5.1 导航分组

从 10 项平铺改为 4 组 9 项，首页独立在组之上。

```
待我处理                    /
参与
  活动（含投票 · 抽奖）      /events
  公会战                    /wars
公会
  公告                      /announcements
  成员                      /roster
  画廊                      /gallery
  仓库                      /storage
知识
  Wiki                      /wiki
  工具                      /tools
系统
  管理                      /admin
```

### 5.2 仪表盘重定义为「待我处理」

现状是统计看板：4 张卡中 `ActiveMembersCard`（活跃人数 / 胜率 / 活动数）与 `LastWarCard`（最近战况 / MVP）看完无需任何动作，`UpcomingEventsCard` 不区分已报未报，只有 `MySignupsCard` 有行动性 —— 且它只显示**已报名**的，从不显示**还没报的**。首屏三分之二面积用于「看完什么都不用做」。

**进 inbox 的条目**（有明确动作、有截止或状态）：

1. 未响应的活动 —— 报名截止前
2. 未投的投票 —— 未关闭
3. 未参与的抽奖 —— 未开奖
4. 需签到的公会战 —— 进行中
5. 我的不在场申报被批 / 被拒 —— 结果确认
6. *（管理，按权限）* 待审的新成员
7. *（管理，按权限）* 待录战绩 / 待结算的公会战
8. *（管理，按权限）* 待处理的不在场申报

**不进 inbox**：新公告、新 Wiki、新画廊 —— 走「未读标记」，显示为导航项旁的圆点，不占待办位。

**判定规则：没有「我做完了」这个状态的东西，不算待办。**

统计降级到首页下方或折叠区，不删除。

**服务端**：扩展已有 `/api/dashboard/summary`（`routes/dashboard.ts:35`，已返回 `my_signup_event_ids`，见 `:202`），而非新建端点。按权限过滤管理类条目。

### 5.3 路由变更

| 现在 | 目标 | 原因 |
|---|---|---|
| `/events/$id` → redirect 回 `/events?eventId=` | `/events/$id` 真详情页 | 活动无法分享 / 收藏是硬缺陷 |
| 投票 / 抽奖 仅存在于 modal | `/events/$id` 内一等公民 + 活动页类型筛选 | 现状需 4 步且第一步无提示 |
| `/guild-war?tab=history&warName=` | `/wars` + `/wars/$eventId` | 战役需可分享 URL |
| 仓库实体当 Tab | 实体选择器 + `/storage/$storageId` | Tab 表示「同一对象的不同侧面」，不同仓库是不同对象 |

**破坏性说明**：战役的公开标识符从 `war_history.id` / `warName` 改为 `event_id`，旧链接与书签失效。重设计范围内可接受，但需在发布说明中写明。

### 5.4 公会战与活动的关系

报名**已经**就是活动报名，这不是设计选择而是既成结构：`getActive()` 的战队候选池直接由 `getEventParticipantUserIds(eventId)` 生成（`GuildWarActiveService.ts:89`），`/api/guild-war/*` 下没有任何报名端点。

另建一套报名只有两种结果：复制参与者表（两份名单必然打架），或编排池读不到新名单。**不做。**

但现状确有多余步骤：站在公会战页面上，要报名却得回活动页找卡。解法是**把该活动的报名控件嵌入公会战页面** —— 同一 API、同一份数据、同一张 `event_participants` 表。

| 页面 | 职责 |
|---|---|
| 活动 `/events` | 一切「要不要参加」的唯一入口，含投票、抽奖、公会战排期 |
| 公会战 `/wars` | 编排、签到、战绩、结算、历史、分析 + 就地报名控件 |

### 5.5 Tab 与表格范式

- **共享 `PageHeader`**：承接被丢弃的 `title` / `subtitle` / `icon`，加面包屑与主动作位。顶栏 `<h1>` 退回为应用名与全局工具。
- **共享 `PageTabs`**：**URL 同步为强制要求**，不是可选项。Tab 仅用于「同一对象的不同侧面」。
- **`DataTable` + `FilterToolbar` 强制配对**：筛选、排序、分页、批量选择、批量操作栏是一整套。不允许「用了表格没筛选器」或反之。
- **批量操作范式**：选中 → 底部固定操作栏 → 破坏性操作二次确认 → **结果汇总（成功 N / 失败 N + 每条失败原因）**。禁止静默半成功（对应「不许伪造成功路径」）。
- **滚动条**：`.app-content` 的滚动条不再使用主色，改用中性色并确保不与圆角容器裁切冲突。

### 5.6 验收标准

- inbox 8 类条目逐条测试；「不进 inbox」的 3 类有反向测试
- 所有 Tab 状态可通过 URL 复现（刷新与分享均不丢）
- 每个使用 `DataTable` 的页面都配有 `FilterToolbar`
- 批量操作在部分失败时给出逐条原因，不显示「成功」

---

## 6. 第三节 · 数据模型

### 6.1 设计取向：核心表 + 类型扩展表，无例外

`event_polls` 已经是正确范本。公会战对齐同一模式，**不新建独立聚合根**。

初稿曾提出独立的 `wars` 聚合根 + `status` 列，已否决，原因有三：

1. `status` 与 `events` 已有的 `start_at` / `end_at` / `archived_at` 重复表达生命周期 —— 两个「何时 / 是否」的来源。
2. `war_name` 与 `events.title` 重复，独立聚合根会保留这处重复。
3. 独立聚合根本身就是它要消除的那种「模式例外」。

实测支持这个取向：本地 5 场战役**全部**有对应活动，0 例外，无需合成假活动。

### 6.2 目标结构

```
events                          核心：类型 · 标题 · 排期 · 容量 · 报名开关 · 可见性 · 归档
  type                          判别列，决定该有哪张扩展表
  ✗ winner_count                移出 → event_raffles

event_participants(event_id)    报名的唯一来源，任何功能不得另建名单

event_polls(event_id PK)              type='poll'
event_poll_options(event_id)
event_poll_votes(event_id)

event_raffles(event_id PK)            type='raffle' · winner_count · drawn_at
event_raffle_winners(event_id)

event_wars(event_id PK)               type='guild_war'
  enemy_name · result · own_stats · enemy_stats · duration_minutes · notes
  concluded_at            null = 未结算
  pool_materialized_at    null = 尚未开始编排
war_teams(event_id NOT NULL)          单一 FK
war_team_members(war_team_id NOT NULL)
war_pool_members(event_id NOT NULL)
```

**消失的东西**：`war_history` 表整体（→ `event_wars`）；`war_history.war_name`（→ 用 `events.title`，同时移除 `GuildWarHistoryService.ts:109` 的复制）；`war_teams.war_history_id` 与 `war_pool_members.war_history_id`；`wars.status`（不需要）。

### 6.3 关键决定

**1. 池不再伪造。** 语义写死：**池 = `event_participants` 的投影**，`war_pool_members` 只在干部开始编排时显式落地并写入 `pool_materialized_at`。未落地时接口返回报名者原样 + `pool_materialized: false`，UI 明确显示「尚未开始编排」。删除 `virtual:${userId}` 逻辑。这条直接对应 Debug First 原则：不制造看起来像真数据的假数据。

**2. 状态由事实表达，不做时间推断。** 战役状态 = `events.start_at` / `end_at` / `archived_at` + `event_wars.concluded_at` + `pool_materialized_at` 的组合，均为已发生事实。不会出现「过了开始时间就自动算进行中」这类隐式状态。

**3. 手工补录的历史战役** = 补录一次已归档的活动（`type='guild_war'`、`archived_at` 已设、标题即战役名）+ 它的 `event_wars` 行。战役名从此只有一个来源。实测无此类存量数据，故本决定不产生迁移负担。**此决定可逆**：若需要独立于活动标题的战役名，可在 `event_wars` 上加一个可空 `label` 覆盖列 —— 但那会重新引入两个名字，需明确取舍。

**4. 必须坦白的限制**：SQLite 无法用 CHECK 约束表达「`type='poll'` 必须且仅当存在 `event_polls` 行」。该一致性只能落在应用层 + 一条迁移后的一致性断言查询。不假装数据库替我们守住了它。

### 6.4 迁移步骤（每步可独立回滚）

1. 建 `event_wars`、`event_raffles`
2. `war_history` → `event_wars`（`event_id` 为键，`concluded_at` = 原 `updated_at`）
3. `war_teams` / `war_pool_members`：由 `war_history_id` 回填 `event_id`，然后**重建表**去掉双 FK 并将 `event_id` 置为 NOT NULL（SQLite 删除带 FK 的列必须重建表）
4. `events.winner_count` → `event_raffles.winner_count`，重建 `events` 去掉该列
5. 删除 `war_history`

### 6.5 迁移验证

- 行数守恒：`war_history` 5 → `event_wars` 5；`war_teams` 10；`war_pool_members` 15；`war_team_members` 33
- 每场战役的 teams / pool / member_stats 计数守恒
- 外键完整性检查无孤儿行
- 类型与扩展表一致性断言（§6.3 第 4 点）
- 在本地真实 D1（`guild-portal-db --local`）实跑，方式与此前验证清理 cron 相同

### 6.6 服务端影响

- `GuildWarActiveService` 与 `GuildWarHistoryService` 合并或共用查询；「进行中 / 历史」成为同一查询的不同筛选
- 删除 `virtual:` 池合成逻辑
- `concludeWar` 不再复制标题
- 路由 `/api/guild-war/history/:id` 的标识符改为 `event_id`

---

## 7. 子项目拆分

每个子项目各自 spec → plan → 实现。

| # | 子项目 | 依赖 | 验收 |
|---|---|---|---|
| **S1** | 主题集中化：3 主色 × 2 模式、清 2138 处兜底值、`!important` 归零、模式信号统一为 `[data-theme]`、Mantine 读 token、偏好进 store | 无 | §4.7 |
| **S2** | 共享外壳与基础组件：`PageHeader` / `PageTabs`（URL 同步强制）/ `DataTable`+`FilterToolbar` 强制配对 / 批量操作范式 / `EmptyState` / 表单栈 | S1 | 组件测试 + 逐页替换无回归 |
| **S3** | 数据模型重构：活动扩展表对齐、`event_wars`、迁移、服务端合并、删除假数据 | 无（与 S1/S2 不同层，可并行） | §6.5 |
| **S4** | 导航与首页：分组导航、仪表盘重定义、`/api/dashboard/summary` 扩展为 inbox | S1 S2；公会战条目依赖 S3 | §5.6 |
| **S5** | 逐页重做：活动（含投票抽奖详情页）、公会战单页、公告、成员、画廊、仓库、Wiki、工具、个人资料、管理 8 tab | S1 S2 S3 S4 | 逐页无障碍与交互测试 |
| **S6** | 收尾：删死代码、对比度与无障碍断言、包体与性能复核 | 全部 | 全量测试 + 构建产物对比 |

S1 与 S3 可并行（一个只动样式层，一个只动数据层）。S5 最大，会再按页面拆成若干轮。

**不得先做 S5 任何一页**：没有 S1 的 token 与 S2 的共享组件，每页都会长出自己一套 —— 正是现在 5 套 Tab、3 套表格范式的成因。

---

## 8. 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 关闭 `autoContrast` 影响所有现存 Badge / Button 自动取色 | 本设计中最易产生视觉回归的一步 | 逐组件复核 + 6 组合对比度断言 |
| 一次性清除 2138 处兜底值面积极大 | 漏改处直接失色 | 断言驱动；先建 token 层再清理，可分文件推进 |
| 重建表（SQLite 删列）期间的数据安全 | 迁移失败可能丢数据 | 每步独立回滚 + 行数守恒断言 + 本地真实 D1 预演 |
| 战役标识符变更导致旧链接失效 | 书签 / 历史消息中的链接 404 | 发布说明写明；如需可加旧 id → 新 URL 的一次性重定向 |
| inbox 定义不精准会变噪音 | 首页失去价值 | §5.2 的「有无完成状态」判定规则 + 反向测试 |
| S5 体量大（4725 行页面代码） | 周期不可控 | 按页面拆轮次，每轮独立可发布 |

## 9. 开放问题

1. **`invite_links` 标记列**：此前讨论过给邀请链接加标记列，以便（a）注册端点用可信的库侧信号保留 `systemtest_` 前缀，（b）清理 cron 能回收泄漏的测试邀请链接。现状 `invite_links` 只有随机 `code`，无 name / title / note 列，泄漏的链接只能等 `expires_at` 自然过期。既然本轮已决定重构数据模型，是否顺带处理？**尚未决定。**
2. **战役名是否需要独立于活动标题**：见 §6.3 第 3 点，当前决定是不需要。
3. **`/tools` 与 `/settings` 的分组归属**：`/tools` 现在是公开路由且受 `tools` feature flag 控制，`/settings` 也是公开路由。二者在新分组里的位置已定（知识 / 系统），但是否应对游客可见需确认。

## 10. 明确不做

- 仓库申领审批功能（新表 / 状态机 / 端点）—— 已决定不做
- 视频上传与转码 —— 画廊视频是外链 `url`，R2 中不存在视频对象
- 更换 UI 框架 —— 继续使用 Mantine 8，本设计只是让它成为 token 的消费者
- 邮箱 / 手机号 / TOTP / 恢复码相关任何功能 —— 长期约束，范围外
