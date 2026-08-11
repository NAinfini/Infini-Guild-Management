import { resolve } from "node:path";

/*
 * 浏览器和回读通道共用一个源：Cloudflare runtime 自己就是站点。
 *
 * scripts/e2e/wrangler.e2e.jsonc 复用 apps/cloudflare 的入口和 ASSETS 绑定，
 * runtime 先接请求，静态资源交给 ASSETS，index.html 里的站点信息从 D1 现场替换。
 * 所以 e2e 不需要 vite dev server，直接打本地 runtime 就能拿到完整站点：
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

/* 每个槽位使用独立的 worker、D1 和 R2；槽位内串行，E2E_SLOTS=1 表示单槽位串行运行。 */
export const E2E_SLOTS = Math.max(1, Number(process.env.E2E_SLOTS ?? 2));

export function originForSlot(slot: number): string {
  return `https://127.0.0.1:${E2E_PORT_BASE + slot}`;
}

/**
 * 本进程属于哪个槽位。
 * Playwright 给每个并行 worker 进程设 TEST_PARALLEL_INDEX；
 * globalSetup / globalTeardown 跑在主进程里没有这个变量，它们不该用这个值，
 * 而要显式遍历 E2E_SLOTS。
 */
export const SLOT_INDEX = Number(process.env.TEST_PARALLEL_INDEX ?? 0);

export const PORTAL_ORIGIN = originForSlot(SLOT_INDEX);

/*
 * scripts/e2e/fixture-seed.sql 中固定的本地 E2E site_owner 与共享成员。
 */
export const ADMIN_USERNAME = "admin";
export const ADMIN_PASSWORD = "admin123";
export const MEMBER_USERNAME = "member_01";

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

/** Miniflare 默认会填 loopback 地址；显式写入 Cloudflare 的身份头才能隔离测试配额。 */
export function clientIdentityHeaders(address: string): Record<string, string> {
  return { "CF-Connecting-IP": address };
}

const supportDir = import.meta.dirname;

/** globalSetup 写、各 project 读的一次性状态目录（已在 .gitignore 中）。 */
export const STATE_DIR = resolve(supportDir, "..", ".state");
export const ARTIFACTS_DIR = resolve(supportDir, "..", ".artifacts");

export function slotStateDirFor(slot: number): string {
  return resolve(STATE_DIR, "slots", `slot-${slot}`);
}

/** Wrangler 的 D1、R2、DO 和限流状态按槽位完全隔离。 */
export function persistDirForSlot(slot: number): string {
  return resolve(slotStateDirFor(slot), "wrangler");
}
/*
 * 会话按槽位分开存。
 * 每个槽位是各自独立的一份数据，会话行也各归各的库，不能共用 storage state。
 */
export type E2eRole = "guest" | "admin";

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
 * D1 每张表的行数/内容哈希与 R2 活跃对象元数据快照。
 * teardown 要求逐字段回到基线，既能发现残留，也能发现等量替换或原位修改。
 */
export type SiteFingerprint = Record<string, number | string>;
