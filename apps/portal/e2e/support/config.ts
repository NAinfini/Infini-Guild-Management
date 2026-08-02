import { resolve } from "node:path";

/*
 * 浏览器和回读通道共用一个源：worker 自己就是站点。
 *
 * wrangler.jsonc 里配了 ASSETS 绑定（directory: ../portal/dist，
 * not_found_handling: single-page-application，run_worker_first: true），
 * 也就是线上那套——worker 先接请求，静态资源交给 ASSETS，index.html 里的
 * {{SITE_NAME}} 由 apps/worker/index.ts:343 现场替换。所以 e2e 不需要 vite
 * dev server，直接打 worker 就能拿到完整站点：
 *   1. 每次页面加载从几百个未打包的 ESM 模块请求变成十来个哈希产物；
 *   2. 每一发 /api 都少一次反向代理转发（连带没了代理掐 keep-alive 那档事）；
 *   3. 测的就是要部署的那份产物，比测 dev server 更贴近线上。
 * 代价是 dist 必须是新的——global-setup 会显式比对时间戳，过期就当场报错，
 * 绝不允许拿旧产物跑出一片绿。
 */
/*
 * 槽位 0 的端口，其余槽位依次 +1。导出而不是留成模块私有：playwright.config.ts
 * 起 wrangler 时要用同一个基准算 `--port`，各写各的就会出现「健康检查打 8887、
 * 服务却起在 8787」这种只表现为 webServer 超时、看不出原因的错配。
 */
export const E2E_PORT_BASE = Number(process.env.E2E_PORT_BASE ?? 8787);

/* inspector 端口单独一条：它和站点端口没有换算关系，挤在一起改会互相牵连。 */
export const E2E_INSPECTOR_PORT_BASE = Number(process.env.E2E_INSPECTOR_PORT_BASE ?? 9329);

/*
 * 并行槽位：每个 Playwright worker 进程对着**自己那一份** worker + D1 + R2。
 *
 * 串行跑的理由一直是「本地只有一个 D1，它是所有用例共享的可变状态」。
 * 那就把这个前提去掉：起 N 个 wrangler 实例，各自 --persist-to 到独立目录、
 * 监听独立端口，用例之间在数据层面根本碰不到面，于是可以放心并行。
 * 每个槽位内部仍然是串行的（fullyParallel: false，按文件分发），
 * 所以文件级的模块状态和「同一文件内用例有先后」的写法都不受影响。
 *
 * 出问题时把 E2E_SLOTS 设成 1 就完全退回到原来的单实例串行行为。
 */
export const E2E_SLOTS = Math.max(1, Number(process.env.E2E_SLOTS ?? 4));

export function originForSlot(slot: number): string {
  return `http://127.0.0.1:${E2E_PORT_BASE + slot}`;
}

/**
 * 本进程属于哪个槽位。
 * Playwright 给每个并行 worker 进程设 TEST_PARALLEL_INDEX；
 * globalSetup / globalTeardown 跑在主进程里没有这个变量，它们不该用这个值，
 * 而要显式遍历 E2E_SLOTS。
 */
export const SLOT_INDEX = Number(process.env.TEST_PARALLEL_INDEX ?? 0);

export const PORTAL_ORIGIN = process.env.E2E_PORTAL_ORIGIN ?? originForSlot(SLOT_INDEX);

/*
 * 本地种子账号。默认值和 apps/worker/db/seed.ts 的开发种子一致，
 * 用环境变量覆盖就不必把任何口令提交进仓库。
 */
export const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? "admin";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin123";
export const MEMBER_USERNAME = process.env.E2E_MEMBER_USERNAME ?? "member_01";
export const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD ?? "member1234";

/*
 * 限流是按客户端地址计的（读 120 次/分钟、写 80 次/分钟，见 apps/shared/config/limits.ts:79）。
 * 整套 e2e 从同一台机器打过去，服务端眼里就是「一个用户在一分钟里点了几百下」，
 * 跑到中段必然被 429 打断——那不是被测功能坏了，是测试自己把配额撑爆，
 * 而且失败会散落在各条用例上，看起来像一堆随机 flake。
 *
 * 所以每条用例带一个独立的客户端地址，让服务端把它们当成互不相干的客户端。
 * 两点必须讲清楚：
 *   1. 这只在本地开发环境成立。线上这个头由 Cloudflare 在边缘覆写，伪造不了。
 *   2. 这等于让常规用例绕开限流，所以限流本身必须由专门的用例去测，
 *      不能指望它在别处「顺带被覆盖到」。
 */
export function e2eClientAddress(index: number): string {
  const safe = Math.max(0, index) % 60_000;
  return `10.42.${Math.floor(safe / 250)}.${(safe % 250) + 1}`;
}

/** globalSetup / globalTeardown 自用的固定地址，和用例的配额分开。 */
export const SETUP_CLIENT_ADDRESS = "10.41.0.1";

/**
 * 客户端身份头。**两个头都要写，只写 X-Forwarded-For 在 CI 上不管用。**
 *
 * 服务端是先看 CF-Connecting-IP、取不到才看 X-Forwarded-For
 * （apps/worker/middleware/rate-limit.ts:33）。而 miniflare 的入口 worker 会在
 * 请求进到我们的 worker 之前替我们补上前者：
 * node_modules/miniflare/dist/src/workers/core/entry.worker.js 的 getUserRequest 里
 * `clientIp && !request.headers.get("CF-Connecting-IP")`，值取自 TCP 对端地址。
 * 补进去的永远是 127.0.0.1，于是所有用例在服务端眼里成了同一个客户端，
 * 挤进同一个限流桶——我们精心分配的那些地址一个都没被用上。
 *
 * 观测到的事实（CI run 30730516221）：
 *   - 十几条各自独立的游客用例，读配额读数是 3、6、8、14、17、22、29、35、40、43、45、49
 *     一路往上累加，而不是每条各自 3–6；到分钟窗口才归零；
 *   - 同一条用例的浏览器和回读通道明明是两个地址，读数却始终只差 1–4
 *     （本地是 page 50 / api 3）；
 *   - trace 里每个 429 的请求头都带着**各不相同**的 X-Forwarded-For。
 * 三条合起来只有一个解释：服务端根本没按这个头分桶。19 条失败全是这么来的。
 *
 * Windows 上不复现——直接拿同一条 wrangler dev 命令探过，只带 X-Forwarded-For
 * 时两个地址各自计数，互不影响。所以本地怎么跑都是绿的，一上 Linux 就炸。
 * 具体是 clientIp 在两个平台上形态不同还是别的原因，没有继续追：
 * 无论哪种，把头显式写死都能让两边行为一致，这比依赖它才是问题。
 *
 * miniflare 补头的条件是「请求里还没有这个头才补」，所以我们自己写一个进去，
 * 它就不会覆盖。X-Forwarded-For 一并保留：服务端的回退分支读它，
 * 少写一个等于把那条路径也悄悄改掉了。
 *
 * 这不放宽线上的限流：线上这个头由 Cloudflare 在边缘覆写，客户端伪造不了。
 */
export function clientIdentityHeaders(address: string): Record<string, string> {
  return {
    "CF-Connecting-IP": address,
    "X-Forwarded-For": address,
  };
}

const supportDir = import.meta.dirname;

/** globalSetup 写、各 project 读的一次性状态目录（已在 .gitignore 中）。 */
export const STATE_DIR = resolve(supportDir, "..", ".state");
/*
 * 会话按槽位分开存。
 * cookie 是按 host:port 绑的，槽位之间端口不同，一份会话文件套不了两个槽位；
 * 何况每个槽位是各自独立的一份数据，会话行也各归各的库。
 */
export type E2eRole = "guest" | "member" | "admin";

export function stateFileFor(role: Exclude<E2eRole, "guest">, slot: number): string {
  return resolve(STATE_DIR, `${role}-storage-state-${slot}.json`);
}
export const RUN_STATE_FILE = resolve(STATE_DIR, "run.json");

/**
 * project 级开关：该角色的请求是否挂上系统测试运行头。
 * 挂上之后服务端按主键登记每一件新建产物，收尾时才删得干净；
 * 只读角色（游客、普通成员）不挂——运行归管理员所有，别人挂上会被 403。
 */
export type E2eOptions = {
  trackArtifacts: boolean;
  /** 该 project 用哪个角色的会话。会话文件按槽位挑，所以这里只记角色。 */
  role: E2eRole;
};

/** globalSetup 建立、globalTeardown 校验的一次系统测试运行。 */
export type E2eRunState = {
  /** 服务端登记的 run id：所有变更请求靠它把产物登记进清理注册表。 */
  runId: string;
  /** 跑之前的站点指纹，teardown 时逐项比对，差一条就判定有残留。 */
  baseline: SiteFingerprint;
};

/** 每个槽位一份运行状态：槽位之间是各自独立的库，清理和指纹也必须各算各的。 */
export type E2eRunStateFile = {
  slots: E2eRunState[];
};

/**
 * 站点各主要集合的规模快照。
 * 这不是「大概没问题」的抽样——teardown 会要求它逐字段回到基线，
 * 任何一条没被清掉的测试数据都会让某个计数对不上。
 */
export type SiteFingerprint = Record<string, number>;

/*
 * 指纹比对里唯一允许漂移的键，每一条都必须写清楚为什么。
 * 这不是「对不上就加进来」的挡箭牌——除这三张簿记表外，任何计数变化
 * 都是真实残留，必须让 teardown 红掉。
 */
export const FINGERPRINT_IGNORED_KEYS: ReadonlyMap<string, string> = new Map([
  ["table:system_test_runs", "清理机制自身的运行记录，按设计保留以便事后追溯"],
  ["table:system_test_artifacts", "同上：产物登记表在 finalize 时清空，但运行期间必然非零"],
  ["table:sessions", "浏览器会话由登录产生，不属于被测数据"],
]);
