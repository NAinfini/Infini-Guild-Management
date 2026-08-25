import { mkdir, rm, writeFile } from "node:fs/promises";
import { assertPortalBundleFresh } from "./support/build-freshness";
import {
  ADMIN_PASSWORD,
  ADMIN_LOGIN_NAME,
  E2E_SLOTS,
  originForSlot,
  RUN_STATE_FILE,
  stateFileFor,
  STATE_DIR,
  type E2eRunState,
  type E2eRunStateFile,
} from "./support/config";
import {
  createSystemTestRun,
  login,
  newApiContext,
  waitForPortal,
} from "./support/api";
import { readSlotFingerprint } from "./support/fingerprint";

/**
 * 每次 e2e 运行的起点，对**每个并行槽位**各做一遍：
 * 1. 等该槽位的 Cloudflare runtime 起来；core migration/fixture 已在启动前离线完成；
 * 2. 登录种子中的 admin 身份并保存管理员会话；
 * 3. 直接读取本槽位 D1/R2 元数据作为基线；
 * 4. 开一次权限门禁的系统测试运行，变更产物靠它按主键清理。
 *
 * 槽位之间是彻底独立的 worker + D1 + R2，所以这几步可以并发做。
 */
async function prepareSlot(slot: number): Promise<E2eRunState> {
  const origin = originForSlot(slot);
  await waitForPortal(origin);

  const adminApi = await newApiContext(undefined, origin);
  try {
    await login(adminApi, ADMIN_LOGIN_NAME, ADMIN_PASSWORD);
    await adminApi.storageState({ path: stateFileFor("admin", slot) });
    /* 登录产生的会话属于稳定夹具；run 在基线之后创建，finalize 会把它完整删除。 */
    const baseline = await readSlotFingerprint(slot);
    const runId = await createSystemTestRun(adminApi);
    return { runId, baseline };
  } finally {
    await adminApi.dispose();
  }
}

async function globalSetup(): Promise<void> {
  /* 产物过期就当场停：跑下去只会拿上一版代码测出一片绿。 */
  await assertPortalBundleFresh();
  await mkdir(STATE_DIR, { recursive: true });
  /*
   * 先删本轮槽位对应的旧 run/session 元数据。setup 万一中途失败，teardown 照样会跑；
   * 留着旧文件会让 teardown 拿已被 fresh slot 丢弃的 run id 清理，或让测试误读旧会话。
   * 这里只碰本轮槽位；其他槽位可能属于另一轮诊断，不能顺手清掉。
   */
  await Promise.all([
    rm(RUN_STATE_FILE, { force: true }),
    ...Array.from({ length: E2E_SLOTS }, (_, slot) => rm(stateFileFor("admin", slot), { force: true })),
  ]);

  const slots = await Promise.all(
    Array.from({ length: E2E_SLOTS }, (_, slot) => prepareSlot(slot)),
  );

  const state: E2eRunStateFile = { slots };
  await writeFile(RUN_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export default globalSetup;
