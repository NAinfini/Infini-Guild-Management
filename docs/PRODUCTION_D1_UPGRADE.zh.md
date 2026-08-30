# 生产 D1 升级与发布手册

状态：**已在明确的一次性 CI 豁免下部署——最新已测应用已上线，维护已关闭。本地发布验证通过；CI Browser E2E 失败仍作为独立问题开放诊断。**

本手册用于把现有 Cloudflare D1 按当前 `0000_core`–`0017_notice_delivery` 迁移链安全升级。本文本身不授权远程迁移、部署、恢复或生产配置写入。

## 目标与不可妥协的结果

- 保留每一条生产业务数据和每一个被引用的 R2 对象。
- 每次维护窗口结束后站点必须正常工作。
- PBKDF2-HMAC-SHA256 默认和最低保持 `10000` 次，以适配 Cloudflare Workers 的 CPU 限制。站主在目标运行时实测后，可通过 `IG_PBKDF2_ITERATIONS` 显式提高到不超过 `10000000`。
- 使用现有有序迁移链升级生产库，并保留这段已发布历史。
- 已发布的 `0000_core.sql` 永久冻结。后续 schema 变化添加下一个连续 ordinal migration，不改写基线，也不增加运行时兼容分支。
- 绝不手动编辑 Wrangler 的 `d1_migrations` 表。

## 当前检查点

- 最新已测应用已部署且维护已关闭。`/api/health`、公开站点配置、浏览器导航 `/` 和 `/login`，以及 SPA index 均返回 `200`。
- 已认证的生产浏览器冒烟覆盖花名册与含两个模板的循环活动；活动场景图片已加载，媒体头像可读取。这是有范围的证据，不表示所有功能均已通过；未记录单独的普通成员登录通过。
- 用户报告的循环活动路由 `500` 和活动背景缺失目前未在浏览器及资源检查中复现。悬停音频返回 `200 audio/ogg`；可听播放尚未确认，诊断仍开放。
- 两张生产迁移账本均包含完整且精确的 `0000`–`0017` 链，没有待执行迁移；仓库同样包含这 18 个连续迁移。
- 本地 SQLite 与 workerd D1 升级/结构对等测试通过。2026-08-30 已将真实生产导出恢复至隔离 workerd D1，并使用 Wrangler `4.127.1` 升级：17 个待执行迁移全部通过，68 张应用表的完整数据均与预期结果一致，表/索引/触发器及两张账本一致。
- 完整的部署后导出确认 85 个登录名/密码哈希、56 个媒体资产、104 个媒体变体、所有媒体链接和两张精确的 18 行账本均未变化。`integrity_check` 通过，外键检查为零；没有业务行被删除。
- R2 于 2026-08-30 21:43:23Z 再次核验：108 个对象、68,480,122 字节、全部 104 个 D1 引用和全部 108 个对象 SHA 均未变化。这些是检查点数据，不是永久预期计数。
- 上线后的正常活动使 sessions 从 44 变为 43（删除 3 条、新增 2 条），更新了 `users.last_login_at`，并完成一次站点描述和一次资料战力更新。这两项正常更新新增两条审计记录（694 至 696），没有改变其他业务行。
- 本地发布检查通过 2,315 个测试（跳过 6 个）及 251 个 E2E 测试。失败的 CI Browser E2E 仅由发布所有者明确的一次性豁免覆盖；该问题仍开放，不构成通用 CI 绕过。
- 已部署应用仍是此前本地验证的同一制品；本状态更新不含应用源码修改。

## 强制停止条件

出现任一情况都不得部署或写生产：

- Cloudflare 账号、数据库名、数据库 ID 或部署目标没有双重确认。
- `app_migrations` 与 `d1_migrations` 不是仓库迁移链的同一个精确前缀。
- migration ID、ordinal、文件名或 checksum 存在未知、缺失、重复或乱序。
- 任一生产密码 hash 成本高于准备启用的 `10000`，且尚未完成明确的凭据迁移。10k Worker 会按设计拒绝高于配置预算的 hash。
- 缺少 D1 导出、Time Travel bookmark、R2 备份或恢复演练。
- 真实数据 scratch D1 演练失败、接近 D1 执行限制、产生异常计数或外键错误。
- 生产 Wrangler 配置、release gate、构建或 E2E 未通过。唯一已记录的例外是本次发布在独立本地验证后明确批准的 CI Browser E2E 一次性豁免；它不豁免其他停止条件，也不构成通用 CI 绕过。
- 不兼容的 schema 或账本切换前，维护模式没有得到验证。
- 回滚目标跨越 Durable Object 类生命周期迁移，或不能在保留当前类身份的前提下恢复旧代码和静态资源。

## 阶段 A——把现有生产 D1 升级到 `0017`

本阶段不得压缩或删除迁移。

### 1. 核对目标和只读证据

远程 D1 命令必须使用已确认的稳定数据库名，不要使用 `DB` binding 猜目标。

```powershell
$config = "apps/cloudflare/wrangler.jsonc"
$database = "<已确认的 production database_name>"

pnpm exec wrangler whoami
pnpm exec wrangler deployments list --config $config
pnpm exec wrangler versions list --config $config
pnpm exec wrangler d1 info $database --config $config
pnpm exec wrangler d1 migrations list $database --remote --config $config
pnpm exec wrangler d1 execute $database --remote --config $config --command "SELECT id, ordinal, checksum FROM app_migrations ORDER BY ordinal"
pnpm exec wrangler d1 execute $database --remote --config $config --command "SELECT * FROM d1_migrations ORDER BY id"
```

将原始输出随发布记录保存，并与上述已核实检查点比较；发生任何漂移都要重新审查。

### 2. 切换 10k 运行时前检查凭据成本

```sql
WITH credential_costs AS (
  SELECT
    user_id,
    CAST(substr(password_hash, 15, instr(substr(password_hash, 15), '$') - 1) AS INTEGER) AS iterations
  FROM user_credentials
  WHERE password_hash GLOB 'pbkdf2-sha256$*$*$*'
)
SELECT iterations, count(*) AS credentials
FROM credential_costs
GROUP BY iterations
ORDER BY iterations;
```

部署配置为 `10000` 的 Worker 前，所有生产凭据都必须报告 `10000`。没有用户密码就不能把高成本 hash 反向转换成 10k；如发现高成本凭据，立即停止，使用明确的密码重置或凭据迁移流程，不得添加静默降级或旧认证路径。

### 3. 备份与真实数据演练

1. 记录当前 Worker version 和 D1 Time Travel bookmark。
2. 将生产 D1 导出到受保护的临时存储。
3. 备份 R2 并记录对象清单，因为媒体数据库行授权的是精确 blob key。
4. 把生产导出导入隔离的 scratch D1。
5. 使用仓库锁定的 Wrangler 和同一迁移目录，在 scratch 应用所有待执行迁移。
6. 记录每个迁移耗时并核对：

   - `app_migrations` 与 18 行 manifest 完全一致；
   - Wrangler 不再报告待执行迁移；
   - `PRAGMA foreign_key_check` 没有结果；
   - 支持时，`PRAGMA integrity_check` 返回 `ok`；
   - 每张业务表计数符合预期转换；
   - 媒体 metadata 仍能解析到相同 R2 对象；
   - 管理员和成员登录、活动、通知、邀请、Wiki、图库、仓储、公会战、审计及媒体读取正常。

只有从一份全新导出重复演练仍能成功，才可进入生产窗口。

导入这份导出时必须保留完整触发器：Wrangler `4.127.1` 的通用 SQL 分割器会合并多个包含 CASE 的导出触发器。已验证的本地恢复先用 SQLite 解析导出，创建所有表，在延迟外键检查下插入数据，再安装原样索引与触发器；逐行确认恢复结果后才应用未改动的迁移文件。D1 不允许执行 `PRAGMA integrity_check`，须在本地 workerd 关闭后检查落盘 SQLite 文件，同时保留 D1 的实时外键检查。

### 含 CASE 触发器的远程传输

已发布的 `CREATE TRIGGER` 主体若含有 `CASE`/`BEGIN`/`END`，本地迁移通过并不足以证明远程 `migrations apply` 可用。本地路径会在执行前分割复合语句，远程路径则把 SQL 交给服务端 query endpoint。只读探针已验证远程 query endpoint 会以 `incomplete input` 拒绝一个有效 CASE 触发器，而相同 SQL 经远程 `--file` 成功；被拒绝的探针没有应用迁移。

在得到生产写入授权前，使用经审核的只读 `EXPLAIN` 对照：分别经远程 `--command` 与远程 `--file` 执行不冲突的等价触发器。该对照只验证传输/parser 行为，不执行 DDL，也不修改数据。

初始化或升级遇到此语法时：

1. 保持已发布迁移字节和 manifest 不变，并确认两张账本是精确的前序前缀。
2. 使用仓库外经审核的生成器创建受保护的复合文件：迁移原始 UTF-8 字节保持原样作为前缀，再追加锁定 Wrangler 的 `buildMigrationQuery` 为该文件名和配置账本表生成的精确标准 `d1_migrations` 后缀。
3. 得到明确授权后，每次通过官方 file-import 路径导入一个复合文件：

   ```bash
   pnpm exec wrangler d1 execute <verified-database-name> --remote --config <protected-config> --file <protected-composite-file>
   ```

   这样迁移和标准 Wrangler 账本记录会处于同一个原子 D1 导入中。不得先导入裸迁移、再补写账本记录。
4. 每个文件后导出并比对 schema、行、索引、触发器和两张账本。在其精确语法通过只读 parser 检查前，不得对含触发器 SQL 使用远程 `migrations apply` 或 `--command`。

### 4. 生产维护窗口

旧 Worker 要求旧应用账本，新 Worker 要求完整 18 行账本，因此没有渐进发布兼容窗口。

1. 部署或开启已验证的维护响应，确认普通页面、API 写入、WebSocket 和定时任务被阻止，同时 `/api/health` 仍可观察。
   必须核实实际已部署代码，不能根据推测的 release tag 判断。若本次新增 Durable Object 类，先在维护状态建立保留旧应用代码和静态资源、同时包含新类身份的恢复检查点；验证并记录该回滚目标后，才能修改 D1。
2. 等待在途任务排空。
3. 再次记录 bookmark、D1 导出、R2 清单、关键表计数、凭据成本、Worker version 和 release commit。
4. 再次读取两张账本和 pending 列表。
5. 使用已确认的数据库名执行生产 D1 pending migrations。含触发器 SQL 必须使用上述经审计的 file-import 路径。
6. 任一迁移失败都保持维护状态。先导出并比对两张账本，再判断失败导入是否具备原子性；不得部署任一应用版本，也不得手改账本。
7. 成功后核对 18 行应用账本、Wrangler 历史、外键、schema objects、关键计数、凭据、媒体/R2 引用及最后一位角色管理员约束。
8. 使用完整生产 bindings、限流、Durable Objects 与 cron，部署同一个已测试 commit。
9. 关闭维护并执行管理员、普通成员冒烟测试。
10. 至少监控一个完整运行窗口的 Worker exception/CPU、D1 错误/延迟、Durable Object、限流、WebSocket 和定时任务。

### 5. 阶段 A 回滚

先保持或重新开启维护模式。把 D1 恢复到迁移前 bookmark，验证两张账本与关键计数后，再恢复已记录的 Worker 恢复版本及其配套应用代码和静态资源。如备份后发生过 blob 写入，还要恢复匹配的 R2 状态。只回滚 Worker 不会恢复 D1，不是有效回滚。

Cloudflare 不允许普通版本回滚跨越 Durable Object 类生命周期变化。本次新增 `AuthRateLimitDO`，不得直接执行 `wrangler rollback` 指向新增类之前的原版本。须保留新类及其 namespace，使用处于相同生命周期状态、已验证的恢复检查点。不得通过删除类、重命名已有 namespace，或让旧 API 搭配新 Portal 静态资源来绕过恢复限制。恢复包只保存在受保护的发布备份中，不作为应用兼容分支入库。

## 本次发布后的迁移历史

- `0000_core.sql`、`0001`–`0017`、manifest 记录与 checksum 必须永久保持不变。它们是现有安装的数据保全升级历史，不是运行时 legacy 或向后兼容层。
- Fresh D1 与 VPS 数据库执行和升级数据库完全相同的有序 SQL；精确应用账本门禁仍是唯一 schema 契约。
- 不折叠迁移链，不重写 `app_migrations`，也不编辑 `d1_migrations`。未来 schema 变化添加下一个连续 ordinal migration。
- 可丢弃的开发数据库可以从已发布迁移链重建；任何需要保留数据的数据库必须通过经过审查的迁移链升级。

## 最终升级验收

- 仓库迁移源保持精确、不可变的 `0000`–`0017` 链。
- Fresh SQLite、fresh workerd D1 与升级后的生产 schema 结构一致。
- 应用账本与 Wrangler 账本均记录完整已发布迁移链，且没有人工改写。
- 本地发布验证通过 2,315 个测试（跳过 6 个）及 251 个 E2E 测试。CI Browser E2E 失败仍在开放诊断中，仅由本次发布明确的一次性豁免允许；CI 并非可选项。
- 已记录的认证冒烟在 10k 配置下正常，且不存在高于该预算的存储凭据；它不构成单独的普通成员登录通过。
- 关键计数、媒体 metadata、R2 引用和无删除检查仍与操作前证据一致；只有上述两项已审计的正常更新改变了可变的资料/站点配置字段。
- 已依据上述有范围的认证冒烟证据关闭维护；本次发布不声称已完成单独的普通成员登录通过。

## Cloudflare 官方参考

- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 Wrangler 命令](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 导入与导出](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Workers 回滚](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
