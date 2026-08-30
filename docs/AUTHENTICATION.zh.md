# 认证、账号连接与消息能力路线图

> 状态：Phase 0–3 已纳入 `v0.1.0` 源码发布；部署仍是需要运维人员明确执行的独立操作。[README.zh.md](./README.zh.md)、[SETUP.zh.md](./SETUP.zh.md) 与 [SECURITY.md](./SECURITY.md) 仍是运行参考。
>
> [文档首页](../README.md) · [English version](./AUTHENTICATION.md)

## 最终产品决定

Infini Guild Management 保留零外部依赖的本地登录，同时把私密凭据与公开身份彻底拆开。

| 范围 | 决定 |
| --- | --- |
| 成员账号创建 | 继续仅限邀请。 |
| 注册 | 一个 10 位大写字母数字邀请码（也可通过注册链接分享）、私密登录名、公开显示名、密码、确认密码；不出现 OAuth、邮箱或手机步骤。 |
| 默认登录 | 私密登录名加密码；不需要任何外部账号或服务。 |
| 公开身份 | 显示名出现在成员名册及门户其他位置；认证流程永远不查询显示名字段。 |
| OAuth | Google、Discord、KOOK 是站主逐项配置的可选增强。一个内部账号可以连接多个供应商，任何已连接供应商都会登录这个相同账号。微信保留独立 Site Config 开关，但在官方规则得到验证前刻意不可用。 |
| 邮箱 | 成员登录后在个人资料中添加的可选已验证联系方式；注册和本地登录均不要求。 |
| 手机消息 | 可选且依赖供应商；不用于注册、主要登录或唯一恢复因素。当前尚未选择供应商。 |
| 恢复 | 由有权限管理员执行且完整审计的凭据重置；明确不保存恢复代码。 |
| 服务归属 | 每个部署的站主自行提供并支付供应商账号、域名、凭据、配额与合规成本；项目不运营共享网关。 |

本阶段**不应移除私密登录名加密码**。强制邮箱不适合部分中国公会成员；仅 OAuth 又会让自托管安装依赖站主必须注册和维护的外部应用。本地凭据保证开箱即可运行，已连接 OAuth 则为愿意使用它的成员提供更方便、减少输入密码次数的登录方式。

把公开显示名与私密登录名分开是有价值的，但登录名不是秘密，也不是第二因素。只有成员选择了不再公开显示的登录值后，它才能降低针对成员名册进行的机会型密码猜测和撞库；迁移账号最初仍保留已经公开过的旧值。真正的安全控制仍然是强密码、按调用方限流、统一失败响应、会话安全和可靠恢复。邀请注册限制的是未经授权的新账号创建，并不能阻止对已有账号的攻击。

## 身份术语与不变量

- **内部用户 ID** 是角色、个人资料、内容、审计记录、会话与外部身份唯一持久的归属键。
- **登录名** 是仅供本地认证与凭据管理使用的私密账号数据。成员名册、个人资料、搜索、分析、审计标签、URL、浏览器遥测和普通管理员成员列表都不得出现它。
- **显示名** 是公开的公会身份。第一版继续保持大小写不敏感唯一，以维持当前名册行为，但不再具有任何认证含义。
- **密码** 始终保存为自描述的单向哈希。明文密码和临时凭据不得持久化或写入日志。
- **外部身份** 由供应商及其稳定 subject 标识组成。供应商昵称与邮箱只是展示/联系声明，不是身份键。
- **邮箱和手机** 是可选已验证联系方式，不是自动连接账号的键。
- 每个受保护的身份变更，都要在同一数据库事务中写入对应审计事件。

注册界面应明确解释登录名是私密信息，并建议使用与显示名不同的值。两者允许相同，服务端不会因此拒绝，但成员会失去这次拆分带来的隐私收益。

## 用户流程

### 1. 邀请注册

1. 公会管理员按现有邀请策略创建一个 10 位大写字母数字邀请码。数据库直接保存该邀请码，有权限的管理员之后仍可查看。
2. 管理员可以分享邀请码供手动输入，也可以分享包含同一个邀请码的注册链接；注册页随后要求输入登录名、显示名、密码与确认密码。
3. 服务端先把邀请码规范为大写并校验，再执行名称冲突检查或密码哈希。
4. 一个事务同时消费邀请链接、创建内部用户、创建本地凭据、创建个人资料并写入注册审计。名称冲突或邀请失效时不消费任何内容。
5. 注册成功后创建普通会话；流程中不显示 OAuth、邮箱和手机。

OAuth 绝不能把尚未连接的访客直接变成成员。本路线图中，兑换邀请仍是唯一注册路径。

### 2. 本地登录

登录表单只把提交值视为登录名并查询凭据记录，永远不查询显示名字段。所有无效组合都返回相同的公开响应。如果成员主动把两者设成相同文本，该文本能够认证是因为它同时也是登录名，并不代表系统支持显示名登录。

如果管理员签发了临时凭据，验证成功后只创建受限的改密会话。成员必须按要求设置永久登录名/密码，门户才能签发普通会话。

### 3. OAuth 登录

登录页只在已实现供应商由 Site Config 启用且运行时凭据完整时显示按钮。供应商回调通过校验后：

- 已连接的 `(provider, subject)` 每次都登录同一个内部账号；
- 未连接的 subject 不创建账号、不合并账号，只给出通用提示，要求先使用本地凭据登录并在个人资料中连接；
- 内部账号已停用、删除或因其他账号政策被阻止时，仍由本地策略拒绝；
- 应用读取身份后丢弃 access token 与 refresh token，除非未来另行批准的功能确实需要它们。

成员可以连接站主启用的所有已实现供应商。每个已连接供应商都是认证同一内部用户 ID 的独立入口，因此进入完全相同的角色、个人资料、内容与会话政策。微信不是已实现供应商，本版本绝不显示按钮或接受其回调。

### 4. 个人资料与账号安全

已登录成员可以：

- 修改私密登录名；
- 修改公开显示名；
- 修改密码；
- 在供应商启用时，分别连接或解除一个 Google、Discord、KOOK 身份；
- 在邮件启用时添加、替换、验证或删除邮箱；
- 仅在实现并配置了具体消息供应商后管理手机联系方式。

修改登录名、显示名、密码，连接或解除 OAuth，以及添加、重发或移除已验证联系方式时，都必须在该次请求中提交成员当前本地密码。这是即时重新认证，不是基于时间的“近期已认证”标记。密码校验同时按内部用户 ID 与可信客户端来源限流。认证因子变化会递增账号认证版本并使旧会话失效；仅修改显示名不会旋转认证版本。

### 5. 管理员恢复

普通成员恢复继续由管理员协助，不依赖邮箱或 OAuth：

1. 拥有凭据重置权限的管理员必须在重置请求中提交自己的当前密码。
2. 重置事务原子写入随机临时登录名和密码，将密码标记为短期、单次且必须修改，递增目标认证版本，撤销目标用户的全部会话及已连接 OAuth 身份，使未完成的 OAuth 连接 challenge 失效，并写入审计。
3. 临时登录名和明文密码只返回一次，明文从不保存。首次使用后成员只获得受限会话，必须设置永久登录名和密码。
4. 管理员永远不会获得原私密登录名。

最后一位 owner 不能依赖普通网页管理员恢复。两种运行时都需要有文档的本地维护命令，由主机/Cloudflare 部署控制权持有人轮换最后 owner 的凭据。该路径不依赖邮箱或 OAuth，保护最后活跃 owner 不变量，并在数据库可用时记录审计。不保存恢复代码。

## 目标数据模型

以下是概念契约；实施后 Drizzle schema 模块仍是关系模型事实来源。

| 表 | 必要目标字段与约束 |
| --- | --- |
| `users` | 现有用户 ID 和成员字段，加 `display_name`；第一版保留显示名大小写不敏感唯一索引。删除旧 `username` 列。公开用户读模型中不包含登录名、邮箱、手机或供应商 subject。 |
| `user_credentials` | `user_id` 主键/外键、`login_name`、`password_hash`、`auth_revision`、`temporary_password_expires_at`、`temporary_password_used_at` 与时间戳；登录名大小写不敏感唯一索引。临时凭据由到期/使用字段表达，不重复保存强制改密标志。 |
| `external_identities` | ID、用户 ID、供应商枚举、供应商 subject、创建/最近使用时间；`UNIQUE(provider, provider_subject)`，第一版再加 `UNIQUE(user_id, provider)`。 |
| `sessions` | token 摘要、用户 ID、创建/到期时间、会话范围（`normal` 或 `password_change`），以及签发时捕获的认证版本；版本不一致时会话立即无效。 |
| `invite_links` | 直接存储、大小写不敏感唯一的 10 位大写字母数字邀请码、创建者与分配角色 ID、有界使用次数、到期、创建时间和可选撤销时间；有权限的邀请列表响应会返回邀请码。 |
| `oauth_challenges` | 随机 state 摘要、供应商、用途（`login` 或 `link`）、可选目标用户 ID、nonce/PKCE 材料、到期和消费时间；短期且单次使用。 |
| `user_emails` | 第一版每人一个邮箱；标准化邮箱有唯一约束，另有验证和更新时间；永远不隐式成为登录身份。 |
| `email_verification_challenges` | 用户 ID、待验证标准化邮箱、随机 token 摘要、到期、消费时间以及有界的发送/重发信息；不存在未使用的 challenge 用途字段。 |
| `site_config` | Google、Discord、KOOK、微信各有一个非秘密 OAuth 启用开关，全部默认关闭；任何凭据都不保存在这里。微信开关仅作预留，在官方 adapter 得到验证前不能有效启用。 |

不要增加供应商 token 表、通用中央身份 broker、尚未使用的短信抽象或两套按运行时分叉的身份模型。只有真正出现第二种投递供应商时，才增加准确的消息端口。全部归属继续指向内部用户 ID。

## OAuth 账号连接契约

每个已实现供应商的协议细节虽不同，但统一遵守一套账号连接政策：

1. 连接只能从已登录的个人资料/账号安全页发起，并在发起请求中提交当前本地密码。
2. 授权请求使用高熵 `state`、适用时的 OIDC `nonce`、供应商支持时的 PKCE、短期有效期、单次 challenge 存储和精确配置的回调 URI。
3. 回调先原子校验 state 与短期 HttpOnly 浏览器事务 Cookie，再在修改连接前校验适用的 issuer/audience、nonce、PKCE、供应商错误和稳定 subject。复制到另一浏览器的 callback 不能置换该浏览器的会话。
4. 新增连接及其审计事件必须原子完成。如果 `(provider, subject)` 已属于另一用户，则拒绝连接且不暴露对方是谁。
5. 同一连接重复 OAuth 登录时为同一内部用户创建会话，绝不创建重复账号。
6. 邮箱相同、显示名相同或供应商昵称相同，都不能自动合并账号。
7. 解除连接需要当前本地密码并记录审计，同时递增认证版本、使旧会话失效。本阶段本地凭据始终存在，因此解除连接不会移除最后一种登录方式。

稳定身份键必须取自供应商：Google `sub`、Discord 用户 ID、KOOK 用户 ID。更换 OAuth 应用/client 可能改变 subject 命名空间，因此必须进行显式迁移，不能静默替换凭据。

### 微信停止条件

仓库保留 `wechat` provider enum 和默认关闭的 Site Config 列，以便未来经过验证的迁移不必再改变供应商模型。本次工作无法从可访问的微信官方文档验证回调与 token 规则。因此没有 token/callback adapter，运行时可用性恒为 false，应用会拒绝启用它。在实现依据官方规则完成核对前，绝不能把微信作为可工作的登录或连接选项展示。

每个供应商只请求身份所需 scope，不请求公会、消息、联系人等无关权限。

## 密码、登录与会话安全

### 密码政策与哈希

当前代码以默认且最低 `10,000` 次迭代写入自描述 PBKDF2-HMAC-SHA256 哈希。项目为适配 Cloudflare Workers 的 CPU 限制而保持该默认值；站主在目标运行时实测后，可显式配置到不超过 `10,000,000`。未知、不可用、格式错误、低成本与当前成本凭据的登录验证都会消耗同一个配置预算。高于运行时配置预算的已存哈希不会被认证，因此一旦部署写入了更高成本哈希，就必须先迁移这些凭据，才能降低配置。

实施要求：

- 在最低支持的 Cloudflare 与 VPS 环境上基准测试，并选择安全范围内最高的配置成本；
- 保留算法/成本元数据，仅在成功登录且配置成本提高时重哈希；
- 永远不降低已保存哈希的成本；
- 新密码为 8 至 128 个字符，至少包含一个大写字母、一个小写字母和一个标点或符号字符；允许空格和 Unicode，但空格不算特殊字符，并拒绝有界常见弱密码列表；
- 结构有效的低成本哈希在成功验证后立即重哈希，不增加第二条认证路径。

拥有更多且经过实测 Workers 或 VPS CPU 预算的站主，可以显式提高 PBKDF2 配置。未来更换密码哈希算法必须保持运行时中立，并沿用自描述迁移路径；Cloudflare 和 VPS 不得静默使用不同的认证强度。

### 暴力尝试与枚举防护

- 在昂贵工作之前同时应用 IP 总限流，以及客户端/IP 加登录名组合限流。
- 每次凭据尝试都消耗同一个 PBKDF2 迭代预算，避免账号状态或已存哈希成本形成时序预言机。
- 不存在、停用、删除、临时密码到期和密码错误账号必须返回相同凭据错误。
- 不创建账号级冷却或管理员清锁入口；两者会暴露共享账号状态并允许定向拒绝服务。
- 对邀请校验、注册、OAuth 发起/回调、邮箱发送/重发和每次当前密码校验分别限流。邮箱验证 token 是高熵、单次、绑定用户的值，不是可猜测短码。
- 不提供公开的私密登录名可用性接口。注册只有在有效邀请校验后才可返回字段冲突；显示名是公开信息，因此仍可公开检查。

### 会话与敏感操作

保留 HTTP-only、same-site Cookie、滚动和绝对过期、会话数量上限、CSRF/Origin 防护，并用认证版本在凭据或账号状态改变后使旧会话失效。HTTPS 固定使用 `__Host-ig_session` 与 `__Host-ig_session_oauth_transaction`，两者均带 `Secure`、`Path=/` 且无 `Domain`；纯 HTTP 本地开发使用无前缀 Cookie。OAuth 回调仍验证 state 与浏览器 Cookie。会话 token、邀请码、OAuth token、验证 token 和临时凭据都不得写入日志。

## 可选服务配置

OAuth 使用两层开关：

1. 站主在 Site Config 中分别打开或关闭每个供应商；四个开关全部默认关闭。
2. 运行时通过部署配置提供该供应商的 client ID/secret 与回调前置条件。

只有已实现供应商的 Site Config 开关开启且运行时配置完整时，供应商才真正启用。公开认证能力响应只暴露这个最终有效状态，因此登录页不会显示无法工作的按钮。预留的微信开关始终处于有效关闭状态。

- Site Config 关闭且无凭据：关闭，本地登录完整可用。
- Site Config 关闭且凭据完整：已经配置，但要等站主打开开关才启用。
- Site Config 开启且凭据完整：启用。
- 凭据只配置一部分：`config:check` 和启动失败，并给出不含秘密的明确错误。
- Site Config 开启但凭据缺失：拒绝启用；如果之后移除了完整凭据对，该供应商 fail closed，并从公开能力中消失；本地登录和管理界面继续可用。

非秘密启用开关属于 Site Config，其修改受权限控制并记录审计。供应商凭据只保存在 Wrangler secret 或受文件权限保护的 VPS 环境文件中；不得进入 Site Config、D1/SQLite 设置、客户端 bundle、API 响应或带真实值的仓库示例。运行时校验会拒绝不完整凭据对；`config:check` 输出站主必须登记的精确回调 URL，但不打印凭据。

| 能力 | 站主设置 | 应用行为 |
| --- | --- | --- |
| Google | Site Config 开关，加站主创建的 OAuth/OIDC client、client ID/secret 和精确回调 | 使用 OIDC `sub` 的可选已连接登录 |
| Discord | Site Config 开关，加站主创建的应用、client ID/secret 和精确回调 | 使用 Discord 用户 ID 的可选已连接登录 |
| KOOK | Site Config 开关，加站主创建的应用、client ID/secret 和精确回调 | 使用 KOOK 用户 ID 的可选已连接登录 |
| 微信 | 仅保留 Site Config 开关 | 不可用：在官方规则验证前，没有 adapter、回调路由或登录/连接按钮 |
| 邮件 | 站主自己的 Cloudflare 账号、已接入域名、发件人和运行时对应 binding/token | 可选个人邮箱验证与事务通知 |
| 手机消息 | 未来由站主选择的供应商及其凭据/费用 | 在供应商和准确威胁模型获批前关闭 |

明确不存在 Infini Gateway、共享 OAuth 应用、共享 Cloudflare token、共享发件域、共享短信账号或由项目支付的配额。若要让站主完全不注册供应商，就必须由项目运营中央身份/消息服务，承担跨实例可用性与泄露风险、处理其他部署的身份流量并支付其费用；本方案拒绝这种模式。

## Cloudflare 与 VPS 的邮箱确认

注册时不发送邮件。启用邮件后，已登录成员从个人资料添加或替换地址：

1. 服务端创建高熵、短期、单次验证 token，只保存其摘要和待验证地址。
2. 运行时发送双语事务邮件。供应商/API 失败必须明确报告，应用不得假装发送成功。
3. 链接把 token 放在 URL fragment 中，使其不会随首次请求或 referrer 发出，再打开同源确认页面；真正消费 token 使用显式受保护 `POST`，不能让邮件扫描器通过会改变状态的 `GET` 自动确认。
4. 消费成功后，在同一事务中写入已验证地址和审计事件。新地址确认成功前，已有已验证地址保持不变。
5. 对用户、地址和客户端分别实施重发与尝试限制；响应不得暴露某地址是否属于其他账号。

邮箱第一阶段只是已验证联系与通知渠道，不是登录名、自动合并键、注册门槛或唯一密码恢复路径。

| 运行时 | 推荐集成 | 站主责任 |
| --- | --- | --- |
| Cloudflare | 原生 Cloudflare Email Service `send_email` binding | 启用 Email Sending、接入域名/发件人；面向任意收件人时使用 Workers Paid；绑定发件人。应用代码不需要 API token。 |
| VPS | 通过 HTTPS 调用 Cloudflare Email Sending REST API | 提供 Cloudflare account ID、最小权限 `Email Sending: Edit` API token 与已接入发件域。VPS 通过 TLS 调用 Cloudflare，不运行邮件服务器。 |
| VPS 上的 SMTP | 本版本未实现 | Cloudflare 虽提供 SMTP submission，但当前 VPS adapter 只使用 REST API；不要配置 SMTP 后假定应用会使用它。 |
| 未配置邮件 | 无 | 邮件 UI 和发送保持关闭；邀请注册、本地登录和管理员恢复照常工作。 |

技术上可以在 VPS 运行 Postfix 等 MTA，但项目不捆绑也不推荐：站主必须处理反向 DNS、端口封锁、SPF/DKIM/DMARC、退信、滥用、信誉与投递率。未来可为已经运营 relay 的站主接受通用 SMTP relay adapter，但它不能成为默认方案，也不能把邮件服务器塞进 Node 进程。

Cloudflare Email Service 要求发件域接入站主自己的 Cloudflare 账号，并配置所需的 Cloudflare 托管 DNS 记录。截至 2026-08-22 的官方信息：Cloudflare 向任意收件人发送邮件需要 Workers Paid；Workers Paid 每账号最低 5 美元/月，Email Sending 每账号每月包含 3,000 封，之后每 1,000 封 0.35 美元。即使 VPS 使用 REST API，这些也是账号级配额，因此每个独立站点都必须使用自己的账号和 token。Email Sending 当前仍是 Beta，不能成为唯一恢复路径。Email Routing 是入站转发，不能代替 Email Sending。

## 手机消息边界

手机消息保持为未来可选阶段，现在不发布空 adapter。实施前必须选择能覆盖目标国家/地区、发件人注册规则、定价和数据处理要求的供应商；之后由站主提供该部署自己的账号与凭据。

如果渠道是 SMS/PSTN，应把已验证号码标准化为 E.164，独立保存验证状态，使用短期、有尝试次数上限的验证码，并限制发送/验证滥用。不得把短信作为推荐或唯一管理员因素：NIST 将 PSTN 带外认证归类为受限认证器。Passkey 或身份验证器应用 TOTP 更适合作为未来开箱即用的第二因素，因为项目无需运营消息服务。

## 从当前 schema 迁移

已发布的 `0000_core.sql` 基线保持冻结。使用下一个连续迁移及准确 manifest 条目实施，两种运行时由 D1 与 VPS SQLite 应用完全相同的 SQL 字节。

1. 创建 `users.display_name` 与 `user_credentials.login_name`，先作为迁移暂存字段。
2. 把每条当前 `users.username` 原样复制到这两个字段。现有密码哈希不变。
3. 将新字段设为必填、重建大小写不敏感唯一索引，并重建受影响的 SQLite 表以删除旧 `users.username` 列。最终 schema 只有一个显示名事实来源和一个登录名事实来源，不并行保留三个字段。
4. 旧成员继续用当前用户名登录，因为该值现在就是其真实 `login_name`。不强制轮换、不创建受限迁移会话，也没有兼容 fallback。站主会通知成员；成员以后可在个人资料中分别修改登录名与显示名。登录名一旦修改，旧值立即失效，因为认证只有一个查询字段。
5. 所有公开读模型、搜索、名册、个人资料链接、选择器和审计标签都改用 `display_name`；只有已认证成员自己的安全接口可以返回 `login_name`。
6. 替换或删除 `/api/auth/check-username`；不得把它改造成未认证的登录名枚举接口。
7. 停用持久登录锁及管理员清锁端点；迁移 `0013_remove_login_failures` 会彻底删除废弃 trigger 与表。
8. OAuth 阶段增加默认关闭的供应商开关，并创建空的外部身份/challenge 表；不为旧成员伪造任何连接。邮件阶段创建空的邮箱/challenge 表；不为旧成员伪造邮箱或验证状态。任何成员连接 OAuth 或添加邮箱前，本地密码登录都保持完整。
9. 每个阶段同步扩展审计 action 契约与 SQL 不变量；受保护变更与审计始终原子完成。
10. 任何受保护远程迁移前，都要在 Node SQLite 和本地 workerd D1 中证明 migration、回填、旧列删除、索引、约束、trigger 与 schema 一致。

未经明确授权、已验证备份和经过演练的恢复路径，任何部署都不得应用远程迁移。

## 实施计划

### 阶段 0 — 修复当前安全缺口

- 在账号查询和 PBKDF2 前执行 IP 总限流和 IP/登录名组合限流。
- 删除持久账号冷却，改用固定预算验证与统一失败响应。
- 注册/修改/重置统一使用 8 至 128 个字符密码政策、有界弱密码列表、可见表单说明、统一失败响应与测试。
- 管理员重置时撤销会话与 OAuth 连接；要求管理员当前密码、临时到期、单次/强制修改状态、认证版本旋转和原子审计。

**退出条件：** 聚焦的 service/route 测试通过；被限流请求既不查账号也不运行 PBKDF2；两个运行时执行完全相同行为。

### 阶段 1 — 拆分登录名与显示名

- 增加连续迁移、共享 schema、store/service 契约、transport route 和双语 UI。
- 注册页改为本决定中的五个字段，不含 OAuth/邮箱/手机控件。
- 更新登录、个人账号安全、名册/公开 API、管理员重置和审计展示。
- 更新首位 owner bootstrap、管理员创建用户、开发 seed、端到端 fixture 与私有 owner 恢复路径，使其遵循新的身份契约。
- 删除私密名称枚举，并测试所有公开 payload 都不含登录名。

**退出条件：** 新邀请能原子创建彼此独立但允许取值相同的登录名与显示名字段；所有旧账号都从原 username 回填两个值并可立即登录；旧 `username` 列已不存在；认证流程永远不查询 `display_name`；Cloudflare 与 VPS schema/行为一致性通过。

### 阶段 2 — 可选 OAuth 连接与登录

- 实现一套运行时中立的身份连接服务，以及 Google、Discord、KOOK 的明确 provider adapter。微信保持为不可用的预留供应商，直到官方规则得到验证。
- 增加默认关闭的 Site Config 开关、challenge 与初始为空的外部身份持久化、严格凭据校验、个人资料连接/解除控件和只显示最终已启用项的登录按钮。
- 增加 callback、重放、冲突、停用账号、会话和审计测试；验证邮箱相同绝不合并账号、重复 provider 使用绝不创建重复账号。
- 在两份安装指南中写明各站主控制台设置与精确回调 URL。

**退出条件：** 每种已实现供应商都能在 Site Config 中独立开关；只有开关和凭据都就绪才显示按钮；不完整凭据无法通过校验，已开启但凭据缺失的供应商 fail closed；微信保持有效关闭；未连接 OAuth subject 无法注册；一个 subject 在两个运行时都只映射一个内部账号。

### 阶段 3 — 可选已验证邮箱

- 增加运行时中立的事务邮件端口、Cloudflare binding adapter、VPS REST adapter、初始为空的邮箱/challenge schema、个人资料 UI、模板、限流与配置检查。
- 邮箱不进入注册、登录身份、自动合并和唯一恢复路径。
- 增加投递错误、抗邮件扫描器确认、到期、重放、重发、隐私和跨运行时测试。
- 把 Workers Paid/账号级定价作为带日期的外部信息写入文档，并保持无邮件路径为一等能力。

**退出条件：** 未配置邮件的安装行为不变；配置后的站主可以验证个人邮箱；失败明确可重试；项目绝不共享凭据和成本。

### 阶段 4 — 未来加固，需另行批准

- 在考虑短信认证因素前优先实现 Passkey 和/或身份验证器应用 TOTP。
- 只有选定并完成真实供应商威胁建模后才实现手机验证/消息；继续由站主付费且可选。
- 只有安全注册流程、最后 owner 保护、供应商健康检查和经过测试的本地恢复命令都存在后，才考虑让站主关闭本地密码登录。它不属于当前设计。

## 必要验证

每个阶段发布时，执行覆盖改动的最窄聚焦测试和适用的仓库发布门禁：

- Node SQLite 与本地 workerd D1 的 schema/migration 一致性和不变量测试，包括 username 精确回填、旧列删除、OAuth 默认关闭以及 OAuth/邮箱身份数据为空；
- 事务、唯一约束、按调用方限流、重放、会话撤销和审计原子性的 service 测试；
- 解析、统一错误、Origin/CSRF、Cookie 与只在配置后提供路由的 transport 测试；
- 注册、迁移后旧账号登录、临时密码修改、个人资料管理及键盘/无障碍行为的双语 Portal component/e2e 测试；
- 关闭、完整、部分配置及秘密脱敏的配置测试；
- 发布准备前运行 `git diff --check`、typecheck、聚焦测试、两个运行时的 build/config check 与 `release:check`；
- 版本控制中不得出现生产标识、秘密、token、private migration、本地数据库或真实供应商 fixture。

遇到以下情况必须停止而不是发布：无法从官方文档确认供应商稳定 subject 或回调规则；受保护迁移缺少备份/恢复演练；Cloudflare 与 VPS 行为分叉；或恢复流程可能锁死最后一位 owner。

## 官方参考

- [Cloudflare Email Service 定价](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Cloudflare Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Email Sending REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
- [Cloudflare Email Sending Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Cloudflare Email Sending SMTP](https://developers.cloudflare.com/email-service/api/send-emails/smtp/)
- [Cloudflare Email Service 域名配置](https://developers.cloudflare.com/email-service/configuration/domains/)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/reference)
- [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2)
- [KOOK OAuth2](https://developer.kookapp.cn/doc/oauth2)
- [微信开放平台网站应用登录](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)（保留参考；当前实现未能验证其规则，因此微信保持不可用）
- [NIST SP 800-63B 认证器要求](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
