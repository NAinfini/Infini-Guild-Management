# 生产 D1 升级与 core 合并手册

[文档首页](../README.md) · [English version](./PRODUCTION_D1_UPGRADE.md)

1.0.0 仅发布包含最终状态的 `0000_core.sql`。本手册专门说明如何从原 `0000`–`0017` 开发迁移链升级既有数据库；这些历史文件不属于 1.0.0 发布内容。这是明确授权的一次性切换，不授权自动修补账本；应用仍仅接受唯一精确 manifest。

**参考部署检查点（2026-09-05）：** 项目部署已完成经过演练的 18 行到 1 行账本切换，并发布 `v1.0.0`。这只证明该部署的操作结果；其他仍保留旧账本的数据库必须各自完成备份、恢复演练及下述维护期切换，才能运行合并后的源码。

## 选择正确路径

- **全新数据库：** 从合并 core 初始化：68 张应用表、152 个命名索引、90 个触发器及权威种子，不再执行历史重建。
- **完整原 18 行账本数据库：** 不执行新 core，核对结构等价后按下述步骤在维护期切换应用账本。
- **更旧或部分迁移数据库：** 停止；先使用 [`archive/pre-core-20260830` 快照](https://github.com/NAinfini/Infini-Guild-Management/tree/archive/pre-core-20260830) 完成旧链，并单独备份、演练。
- **已完成合并切换的数据库：** 与当前 manifest 精确一致则无需再次切换。

本次切换后冻结合并 core。后续 schema 变化追加连续序号和新文件名，绝不复用历史文件名执行不同 SQL。删除的迁移历史由 Git 保留。

## 账本职责

`app_migrations` 是应用严格校验的序号/checksum 契约。切换只将这张账本从 18 行改为一行。

`d1_migrations` 是 Wrangler 拥有的文件名历史。**保留所有现有行和时间戳。** Wrangler 按当前目录文件名判断是否执行，因此旧文件删除后历史行可以保留。原有 `0000_core.sql` 记录会防止重放，但不会替应用更新账本。不得绕过 schema 校验或增加第二套兼容 manifest。

## 操作生产前必须具备的证据

1. 核实账号、Worker、D1、R2 bindings。PBKDF2 默认及最低保持 `10000`，适配 Worker CPU 预算；站主只能在实测后显式提高。合并不得修改既有密码哈希。
2. 记录 commit、release tag、Worker version、D1 Time Travel bookmark、受保护 D1 导出和已验证 R2 备份。核验每个媒体引用和对象摘要。
3. 将真实导出恢复到隔离 SQLite、workerd D1：先创建全部表，延迟外键插入数据，再安装原样索引/触发器。分割 SQL 时保留完整触发器主体。
4. 与全新 core 比对全部对象、列、外键、CHECK、索引及触发器。格式或等价的列内/表级 CHECK 写法必须逐项审核；无法解释的差异必须停止。
5. 生成私有、数据库专属的正向和逆向 SQL，包含精确账本与结构断言。仅临时移除两个 `app_migrations_immutable_*` 触发器、替换已核实的应用账本行、原样恢复触发器；不修改业务表或 Wrangler 历史。
6. 分别在单个事务中演练正向、逆向操作，要求每张非账本表摘要不变、结构不变、完整性通过且外键错误为零。写入后注入失败，证明账本及触发器全部回滚。
7. 验证新 core 初始化、新 manifest 校验、两种运行时构建和本地发布检查。确认切换后的 D1 副本没有 Wrangler 待执行迁移。私有工件和摘要不进入源码。

不提供公开自动切换工具。经审核的一次性 SQL 随精确私有备份保留。VPS 切换必须在停机数据库副本上独立演练并通过权威结构检查；普通私有 bootstrap 命令不是账本切换命令。

## 生产维护窗口

明确授权且演练通过后：

1. 通过配置的 Worker secret 开启 `IG_MAINTENANCE_MODE=on`，验证页面/API 503 和 `/api/health` 的维护标记。
2. 等待请求与定时任务租约排空。维护模式阻止新入口，但不是数据库锁。
3. 再取冻结导出/bookmark、核验 R2，从该精确导出重新生成并演练断言。
4. 使用官方文件导入路径原子执行带断言的切换：

   ```bash
   node node_modules/wrangler/bin/wrangler.js d1 execute <verified-database-name> --remote --config <protected-config> --file <protected-adoption.sql>
   ```

   不换成多次独立 query；失败保持维护。
5. 再次导出，要求新应用账本正确、Wrangler 完整历史不变、结构及全部业务行/摘要不变、完整性通过且外键错误为零。
6. 保持维护部署已测试提交，保留 bindings、Durable Object 类身份、cron 和限制。
7. 关闭维护后访问 `/api/site-config` 等非 health API，触发 schema 校验；再检查登录/认证读取、活动模板、花名册、通知、Wiki、仓储和媒体。记录实际覆盖；health 不等于登录或全部功能通过。
8. 核对远端分支/标签与生产资源对应发布版本，将有范围的结果保存到受保护交接记录。

后续普通纯代码部署不需要维护；本次不兼容的应用账本切换需要维护。

## 失败与回滚

先保持或恢复维护。只有此次确实仅修改已核验账本、且没有后续迁移时，才可执行演练过的逆向事务，恢复原账本/触发器并配套恢复已记录 Worker 与静态资源。开放前核对结构、全部业务摘要及 Wrangler 历史。

否则停止，另行审核从配对 D1/R2 备份或 Time Travel 恢复。绝不能用旧 bookmark 盲目覆盖后续用户写入。只回滚 Worker 不能修复账本不匹配；保留 Durable Object 类/namespace，不跨其生命周期回滚。

## 官方参考

- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 导入与导出](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Workers 回滚](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
