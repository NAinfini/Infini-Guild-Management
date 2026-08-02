# 生产审查汇总（2026-08-02）

审查范围：portal 前端 + worker 服务层的现存缺陷。本轮只汇总**尚未修复**的问题，
每条都在源码里复核过，附行号与复现路径。文中不含任何推测性结论；无法在本地证实的
一律标注为「未验证」。

结论摘要：

| 编号 | 问题 | 严重度 | 是否会丢数据 | 修复成本 |
| --- | --- | --- | --- | --- |
| nn | 站点标志上传是一扇单向门 | 中 | 是（旧标志文件） | 小 |
| rr | 公会战草稿在别人保存后被静默丢弃 | 高 | 是（未保存的编辑） | 中 |
| ss | e2e 一次性成员留到整轮结束才清 | 低（设计如此） | 否 | —（不建议改） |
| tt | 切换角色会清空全部角色的未保存草稿 | 高 | 是（未保存的编辑） | 小 |

---

## nn — 站点标志上传是一扇单向门

**位置**：`apps/worker/services/SiteConfigService.ts:240-262`、
`apps/shared/schemas/site-config.ts:76-88`

**事实**：

1. `uploadSiteLogo` 成功后会删掉旧标志的 R2 对象
   （`SiteConfigService.ts:258-260`，`previousKey !== stored.data` 时调用
   `deleteMediaObject`）。
2. `updateSiteConfigSchema` 里没有 `site_logo_url` 这一项——它在
   `site-config.ts:88` 的 `.pick()` 白名单之外。也就是说没有任何接口能把
   `site_logo_url` 改回去。
3. 于是「上传新标志」这个动作同时做了两件不可逆的事：删掉旧文件、且不留还原入口。
   连初始的种子标志（`/guild-logo.webp`）在第一次上传后也回不去了——它虽然是静态
   资源不会被删，但数据库里的 `siteLogoUrl` 再也改不回这个值。

**影响**：管理员误传一张图，就没有「撤销」。要恢复只能重新找到原图再传一次，
或者直接改数据库。

**旁证**：e2e 明确绕开了这一条并写下了理由——
`apps/portal/e2e/specs/admin/admin-site-config.spec.ts:13-18`。整个站点配置页签
只有标志上传没有覆盖，因为在共享的本地库上跑一次就会把种子标志弄丢。

**建议**：加一个「恢复默认标志」的动作（把 `siteLogoUrl` 写回
`deps.envSiteLogoUrl` 即可，`updateSiteLogoUrl` 已经是私有方法，直接复用）。
补上之后 e2e 那条空白也能跟着补齐。

---

## rr — 公会战草稿在别人保存后被静默丢弃

**位置**：`apps/portal/hooks/guild-war/useGuildWarDragData.ts:100-128`、
`apps/worker/services/guild-war/GuildWarActiveService.ts:57-81`

**事实**：

1. 前端的三份草稿状态 `teamDraftNames` / `teamDraftNotes` / `teamDraftLocks`
   全部以 **队伍 id** 为键（`useGuildWarDragData.ts:111-127`，
   `next[team.id] = current[team.id] ?? team.<字段>`）。
2. 服务端的 `replaceEventTeams` 是「整体重建」：先
   `DELETE FROM war_teams WHERE event_id = ?`（第 65 行），再对快照里的每支队伍
   `const teamId = nanoid()` 重新插入（第 68-70 行）。**每次保存，所有队伍都会拿到
   全新的 id。**
3. 保存成功后 `publishEntityChanged`（`GuildWarActiveService.ts:134`）会推送实时
   事件，其他客户端据此重新拉取 active 数据，拿到的是一整套新 id。
4. 此时第 1 条里的 `current[team.id]` 全部落空，草稿被服务端值覆盖——**没有任何
   提示**。

**复现**：管理员 A 打开公会战，改了几支队伍的名字/备注/锁定但没保存；管理员 B
（或 A 自己的另一个标签页）点了保存 → A 的编辑全部消失，界面上没有任何冲突提示。

**为什么 ETag 拦不住**：`saveTeams` 的 `conditionalEtag` 只在**提交时**比对
（`GuildWarActiveService.ts:124-129`）。而这里的丢失发生在**重新拉取时**，A 还没
提交，那道防线根本没被触发。

**建议（按性价比排序）**：

- 服务端保留队伍 id：`replaceEventTeams` 改成按 id 做 upsert + 删除多余行，而不是
  全删全建。这条一改，前端不用动——同时也修掉了「保存一次就让所有引用队伍 id 的
  东西失效」这个更大的隐患。
- 若不动服务端：前端草稿改用稳定键（队伍名 + 序号不够稳，需要服务端给一个不随保存
  变化的标识），并在检测到远端变更且本地有脏草稿时给出显式冲突提示，而不是静默覆盖。

---

## ss — e2e 一次性成员留到整轮结束才清

**位置**：`apps/portal/e2e/support/members.ts:5-42`

**事实**：`createThrowawayMember` 建出来的账号登记在本次运行的清理注册表里，
到 `globalTeardown` 才统一删除，中途一直存在于库里。

**判定：这是设计选择，不是缺陷。** 文件里 5-14 行已经写明了理由：不拿种子成员开刀，
是因为改角色/停用/批量删除都不会被运行收尾还原，而收尾指纹只数行数，「行数没变、
内容变了」查不出来。用一次性账号是两害相权的结果。

**唯一的实际代价**：账号在整轮运行期间可见，所以按大前缀（如 `e2e_`）搜索会连上
别的用例留下的账号——`members.ts:22-23` 已经用「每条用例一个 `uniqueTag`」处理掉了。

**建议**：不动。列在这里是为了闭环，避免下次审查再当成新问题提一遍。

---

## tt — 切换角色会清空全部角色的未保存草稿

**位置**：`apps/portal/components/feature/admin/AdminRolesSection.tsx:282-291`

**事实**：

```tsx
useEffect(() => {
  const next: Record<string, RoleDraft> = {};
  for (const role of roles) {
    next[role.id] = roleToDraft(role);      // 无条件用服务端值重建
  }
  setDrafts(next);                          // 覆盖掉所有角色的草稿
  if (selectedRoleId === null && roles.length > 0 && roles[0]) {
    setSelectedRoleId(roles[0].id);
  }
}, [roles, selectedRoleId]);                // ← selectedRoleId 在依赖里
```

依赖数组里有 `selectedRoleId`，所以**每次点另一个角色**都会重跑这个 effect，
把 `drafts` 整个换成服务端值。

**复现**：勾改角色 A 的若干权限（不保存）→ 点角色 B → 再点回角色 A → 改动全没了，
无提示。顺带，B 上如果也有未保存改动，同样一并丢失。

**根因**：`selectedRoleId` 只被下面那个「首次自动选中第一个角色」的分支用到，
不该让它触发整份草稿的重建。

**建议**：把自动选中拆成独立的 effect（依赖 `roles`，内部用函数式更新读当前选中值），
草稿重建的 effect 只依赖 `roles`；并且重建时保留已有草稿，
`next[role.id] = current[role.id] ?? roleToDraft(role)`，与公会战那边的写法一致。
两处改动都很小，且能同时修掉「远端刷新时静默吞掉本地编辑」这个共性问题。

---

## 已撤回 / 已修复的条目

- **uu — 已撤回。** 此前判定通知浮层的焦点行为是生产回归，结论错误。真浏览器实测
  焦点正常进入浮层（Mantine 的 `useFocusTrap` 在浮层内没有可聚焦子元素时会退回聚焦
  浮层自身，靠 `Popover.Dropdown` 上的 `tabIndex=-1`）。错的是 e2e 断言
  （`dropdown.locator(":focus")` 只匹配后代），不是产品。断言已修正，用例现在是绿的。
- **vv — 已修复。**

---

## 三条共性

1. **静默覆盖本地编辑**：rr 和 tt 是同一个模式——「远端数据一变，就用服务端值整体
   重建本地草稿」。两处都没有冲突提示。建议统一成
   `current[key] ?? 服务端值`，并在有脏草稿时显式告知。
2. **不可逆动作缺少还原入口**：nn。凡是会删除既有对象的写操作，都应当配一个恢复
   路径，否则误操作没有出路。
3. **测试覆盖的空白是有理由的，但理由要留在代码里**：ss 和 nn 的空白都在源码注释里
   写清楚了原因（`members.ts:5-14`、`admin-site-config.spec.ts:13-18`）。这是好习惯，
   继续保持——但 nn 那条的前提（缺少恢复接口）本身就是待修项，补上之后覆盖也要跟上。
