import { mkdir, rm, writeFile } from "node:fs/promises";
import { assertPortalBundleFresh } from "./support/build-freshness";
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  E2E_SLOTS,
  MEMBER_PASSWORD,
  MEMBER_USERNAME,
  originForSlot,
  RUN_STATE_FILE,
  stateFileFor,
  STATE_DIR,
  type E2eRunState,
  type E2eRunStateFile,
} from "./support/config";
import {
  assertRateLimitIsolation,
  createSystemTestRun,
  login,
  newApiContext,
  readFingerprint,
  reseed,
  waitForPortal,
} from "./support/api";

/**
 * 每次 e2e 运行的起点，对**每个并行槽位**各做一遍：
 * 1. 确认 dist 是新的，再等该槽位的 worker 真的起来（起不来就明确报错，不静默重试到超时）；
 * 2. 清库重种，把站点压回已知基线；
 * 3. 分别登录管理员和普通成员，各自存一份会话；
 * 4. 用管理员开一次服务端登记的系统测试运行，变更产物靠它按主键清理；
 * 5. 记下基线指纹，teardown 时逐项比对。
 *
 * 槽位之间是彻底独立的 worker + D1 + R2，所以这几步可以并发做。
 */
async function prepareSlot(slot: number): Promise<E2eRunState> {
  const origin = originForSlot(slot);
  await waitForPortal(origin);
  /* 配额分桶是整套用例的前置条件，不成立就别往下跑（理由见这个函数的说明）。 */
  await assertRateLimitIsolation(origin, slot);

  const bootstrap = await newApiContext(undefined, origin);
  await reseed(bootstrap);
  await bootstrap.dispose();

  const adminApi = await newApiContext(undefined, origin);
  await login(adminApi, ADMIN_USERNAME, ADMIN_PASSWORD);
  await adminApi.storageState({ path: stateFileFor("admin", slot) });

  const memberApi = await newApiContext(undefined, origin);
  await login(memberApi, MEMBER_USERNAME, MEMBER_PASSWORD);
  await memberApi.storageState({ path: stateFileFor("member", slot) });
  await memberApi.dispose();

  const runId = await createSystemTestRun(adminApi);
  /* 基线在登录和建 run 之后才取：会话行和运行簿记不属于被测数据，
     先建后取才不会把它们算成残留。 */
  const baseline = await readFingerprint(adminApi);
  await adminApi.dispose();

  return { runId, baseline };
}

async function globalSetup(): Promise<void> {
  /* 产物过期就当场停：跑下去只会拿上一版代码测出一片绿。 */
  await assertPortalBundleFresh();
  await mkdir(STATE_DIR, { recursive: true });
  /*
   * 先把上一轮的 run.json 删掉。setup 万一中途失败，teardown 照样会跑；
   * 留着旧文件，teardown 就会拿着一个早已被 reseed 冲掉的 run id 去清理，
   * 报出来的是「run not found」——把真正的失败原因盖住。
   */
  await rm(RUN_STATE_FILE, { force: true });

  const slots = await Promise.all(
    Array.from({ length: E2E_SLOTS }, (_, slot) => prepareSlot(slot)),
  );

  const state: E2eRunStateFile = { slots };
  await writeFile(RUN_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export default globalSetup;
