# 后台成员详情弹窗重构设计

日期：2026-08-07
范围：`apps/portal/components/feature/admin/AdminMemberDetailModal.tsx` 及其样式、页签结构、与 `ProfileOverviewCard` 的共享

## 1. 现状与问题

弹窗真正可编辑的字段只有七个（`apps/portal/types/admin.ts` 的 `MemberDetailFormState`）：`power`、`classes`、`titleHtml`、`bio`、`notes`、`role`、`isActive`。这七个被摊在四个页签上，另外两块内容——请假记录（`AbsenceManagerCard`）与媒体（`AdminMemberMediaTab`）——各自直接写库，不归底部保存按钮管。

由此产生四个问题：

1. **七个字段分四个页签。** 「概览」面板在 960px 宽下只有五个控件，`.tabPanel` 的 `min-height: 200px` 撑出大片空白。
2. **一个全局保存按钮配页签作用域的内容，且没有页签级脏标记。** `isDirty` 是单个布尔值；在「状态与备注」改完备注切回「概览」，界面上没有任何未保存痕迹。资料页已用 `form.dirtySections` 的黄点解决过同一问题，后台没跟上。
3. **同一个弹窗里混着两种保存语义。** 保存按钮声称自己是保存，但请假与媒体是即时写库的。
4. **权限被拒时是无解释的死界面。** `canManageUserByRoleLevel` 判否时（例如 admin 打开 admin），全部控件禁用、「状态与备注」与「媒体」两个页签直接不可点，界面不说明任何原因。

此外有一笔非必要开销：Mantine `Tabs` 默认 `keepMounted: true`（`@mantine/core/esm/components/Tabs/Tabs.mjs:23`），本弹窗未覆盖。打开成员详情即挂载全部四个面板——包括媒体上传器与 `AbsenceManagerCard` 触发的 `useMemberAbsences` 查询。只想看一眼名字也会付这笔代价。

## 2. 决定

- **读优先，改次之。** 打开即一屏可读的事实；编辑是次级动作。
- **去掉全部页签**，改为一屏分区。
- **默认只读，点「编辑」进入编辑态。**
- **「这个人现在什么样」收敛到一个实现**：复用资料页的 `ProfileOverviewCard`，提升到共享位置。

## 3. 只读屏

### 3.1 顶部概览条

复用 `ProfileOverviewCard`（只读模式）。呈现：头像、用户名、身份（`role_name` + `role_color`）、在线/潜水/请假状态、称号（渲染后的样式，不是 HTML 源码）、职业标签、徽章、加入于与资料更新于，右侧五个计数——战力、职业数、相册、视频、每周可用。

这一条答完了原「身份信息」「战斗信息」两张卡的全部问题，因此**只读态不再有这两张卡**。

### 3.2 分区

| 分区 | 内容 | 说明 |
|---|---|---|
| 简介 | `bio` 纯文本；空则显示「未填写」 | |
| 管理员备注 | `notes`，标注「仅管理员可见」；空则显示「无备注」 | 成员自己的资料页没有这一项 |
| 请假 | 一行摘要 | 即时写库，改它走「编辑」，见 §5 |
| 媒体 | 一行摘要 | 即时写库，改它走「编辑」，见 §5 |

四块两列排。每块只有一两行内容，竖着叠成四条会把弹窗撑满，还会让四件轻重不同的事看起来一样重。窄于 768px 时退回单列。

只读屏上只有「编辑」一颗按钮。分区上不再挂各自的「管理」入口：对使用的人来说这四块都是「改这个成员」，给它们各开一个入口，就得先想清楚要改的东西归哪个入口管。

### 3.3 刻意的取舍

- 概览条已给出战力与职业，分区里不再重复。重复字段会被读成两个不同的东西。
- 可用时间只给「每周 N 小时」一个数，不搬资料页的热力图。后台看人要的是量级，不是时段分布。

### 3.4 数据来源

全部来自弹窗已有的 `AdminUserRow`（`user` + `profile` + `badges`）。不新增任何接口。

## 4. 编辑态与权限

### 4.1 入口与布局

底部动作条上的「编辑」按钮进入，它是这个弹窗唯一的编辑入口，一按放开全部可改内容。两种态共用同一条动作条：只读时是「编辑」，编辑时换成「取消 / 保存」，主动作的位置不随模式跳动。编辑态**保留概览条**——它是「你在改谁」的锚点。概览条以下换成表单，一屏四组。

编辑态中概览条跟着草稿走：改了战力、职业、称号，概览条立刻反映；加入时间与资料更新时间没有草稿一说，取服务端值。这与资料页的行为一致。

| 组 | 字段 | 权限 |
|---|---|---|
| 身份 | 身份（Select）、启用（Switch） | `canAssignRole` / `canActivate` |
| 战斗 | 战力、职业 | `canEditProfile` |
| 资料 | 称号（`TitleField`）、简介 | `canEditProfile` |
| 管理 | 管理员备注 | `canEditProfile` |

三个权限仍需与 `canManageUserByRoleLevel(member.user, currentUser)` 相与，此逻辑不变。

### 4.2 权限不足的呈现

- **某一组无权改**：该组在编辑态保持只读呈现，不渲染禁用控件。灰掉的下拉框不传达任何信息；一行纯文本值是诚实的。组标题照常显示——藏掉整组会让人以为这个成员没有这些字段。
- **一组都改不了**：「编辑」按钮禁用，原因（无法管理与自己同级或更高身份的成员）直接写在动作条上按钮的左侧。不用 tooltip——禁用的按钮收不到指针事件，挂上去等于把解释藏进一个够不着的地方。需新增文案。

### 4.3 保存语义

- 保存条只在编辑态存在，只管那七个字段，一次 PATCH。
- 有未保存改动时点「取消」或关闭弹窗，走 `useConfirmDialog` 确认丢弃。
- 保存成功后回到只读屏，直接看到结果。
- `isDirty` 保持单个布尔值。页签取消后，「改动藏在别的页签里」不再可能，不需要分区级脏标记。

## 5. 请假与媒体

这两块与那七个字段的差别只在写库时机，不在「要不要改」。因此它们不另设入口：只读屏给摘要，编辑态给编辑器。

**只读屏**

- 请假：由 `profile.vacation_start` / `vacation_end` 得出的一行摘要——「无请假」或「请假中 · 起 – 止」。
- 媒体：`相册 N · 视频 N · 音乐 有/无`，三个数均来自已有的 `profile`。

**编辑态**

- `AbsenceManagerCard` 与 `mediaTab` 排在四组表单之下，此时才进入渲染树——收回 §1 末尾那笔默认挂载开销：只想看一眼名字的人不必付 `useMemberAbsences` 与上传器的代价。
- 这两个组件自带标题与边框，本身就是一块分区，不再套 `DetailSection`——套了只会得到框中框和两个标题。
- 两块之上共用一行说明：即时生效，不随「保存资料」提交。保存语义的差别必须写出来，否则改完媒体的人会去点一个与之无关的按钮。
- 无 `canEditProfile` 时这两块退回只读屏那两行摘要，与 §4.2 其余各组同一处理。

## 6. `ProfileOverviewCard` 的共享化

组件当前带三个必填的头像操作回调（`avatarUploading` / `onUploadAvatar` / `onRemoveAvatar`），即它已从「显示这个人是谁」掺进了「改这个人的头像」。

**改动**：三个回调变为可选。传入时渲染头像操作层，不传则不渲染。后台以只读方式复用。

**搬迁**：组件由 `components/feature/profile/` 移到 `components/shared/`；`MyProfilePage.css` 中 `.profile-overview*` 一段（约 45–271 行，另有 585–595 的响应式块）移入随组件的独立样式文件。

**i18n 命名空间保持 `profile` 不变**。这些文案描述的是成员资料本身，归属没有随使用位置改变；后台复用时同样读 `profile` 命名空间。改成显式传参只会在两处各写一份同样的键名。

## 7. 测试与验收

### 7.1 需要跟着改的现有测试

- `AdminMemberDetailModal.test.tsx`（当前 1 个用例）— 重写。
- `ProfileOverviewCard.test.tsx` — 随组件搬迁。
- `ProfileMediaTab.test.tsx` 中断言概览头像 CSS 位于 `MyProfilePage.css` 的那条 — 重新指向新的共享样式文件。
- `theme-tokens.test.ts` 的 CSS 覆盖清单 — 登记新的共享样式文件，否则「the token contract covers every CSS file on disk」会失败。

### 7.2 新增测试

单元：

- 只读屏不出现任何输入控件。
- 无可管理项时「编辑」禁用且带原因说明。
- 进入编辑态只渲染有权限的那几组，其余保持只读呈现。
- 只读屏只给请假与媒体的摘要，不挂载各自的子组件。
- 编辑态挂载这两个子组件，并写出「即时生效」的说明。

e2e：扩写 `admin-member-actions.spec.ts` 里已有的成员详情用例，不另开一条——它走的就是同一条链路。

打开详情 → 只读屏（无输入控件、无保存按钮）→ 编辑 → 改战力 → 保存 → 回到只读屏 → 回读服务端确认落库。

### 7.3 新增文案

zh 与 en 两份：`detail.action.edit`、`detail.hint.cannotManage`、`detail.hint.instant`、`detail.section.media`、`detail.notesVisibility`、`detail.empty.bio`、`detail.empty.classes`、`detail.absence.*`、`detail.media.*`；`detail.tab.*` 随页签一起删除。取消按钮复用 `common:action.cancel`，丢弃确认复用 `common:unsavedChanges.*`。

## 8. 实施顺序与前置条件

分两段落地，每段各自可验证：

1. **`ProfileOverviewCard` 共享化**（§6）：头像回调改为可选、组件与样式搬到 shared、更新受影响的测试与 CSS 覆盖清单。资料页行为不变，这一段本身不改变任何界面。
2. **弹窗重构**（§3–§5）：去页签、只读屏、编辑态、两块即时写库分区，连同新增测试与文案。

**前置条件**：`ProfileOverviewCard`、`TitleField`、`MemberCard` 目前有未提交的在途改动。第 1 段须在这批改动落定后开始，否则两边会冲突。
