import { mkdir, rm, writeFile } from "node:fs/promises";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { assertE2eBuildFresh } from "./support/build-freshness";
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
  systemTestHeaders,
  waitForPortal,
} from "./support/api";
import { readSlotFingerprint } from "./support/fingerprint";

async function requiredJson<T>(response: APIResponse, label: string): Promise<T> {
  const raw = await response.text();
  if (!response.ok()) throw new Error(`${label} -> ${response.status()}: ${raw}`);
  return JSON.parse(raw) as T;
}

async function prepareTrackedMember(
  adminApi: APIRequestContext,
  memberApi: APIRequestContext,
  runId: string,
  slot: number,
): Promise<void> {
  const runHeaders = systemTestHeaders(runId);
  const created = await requiredJson<{
    temporary_login_name: string;
    temporary_password: string;
  }>(await adminApi.post("/api/admin/users", {
    headers: runHeaders,
    data: {
      login_name: `e2e_member_${slot}`,
      display_name: `e2e_member_${slot}`,
      role_id: "member",
    },
  }), "创建受运行追踪的普通成员");

  await requiredJson(await memberApi.post("/api/auth/login", {
    headers: runHeaders,
    data: {
      login_name: created.temporary_login_name,
      password: created.temporary_password,
      stay_logged_in: true,
    },
  }), "登录受运行追踪的临时成员");
  await requiredJson(await memberApi.post("/api/auth/complete-password-reset", {
    headers: runHeaders,
    data: {
      login_name: `e2e_member_ready_${slot}`,
      new_password: `E2e-member-ready-password-${slot}`,
      confirm_new_password: `E2e-member-ready-password-${slot}`,
    },
  }), "完成受运行追踪成员的首次改密");
}

/**
 * 每次 e2e 运行的起点，对**每个并行槽位**各做一遍：
 * 1. 等该槽位的 Cloudflare runtime 起来；core migration/fixture 已在启动前离线完成；
 * 2. 登录种子中的 admin 身份并保存管理员会话；
 * 3. 直接读取本槽位 D1/R2 元数据作为基线；
 * 4. 开一次权限门禁的系统测试运行，并在运行内创建普通成员会话；
 * 5. 所有角色的变更产物都靠同一运行按主键清理。
 *
 * 槽位之间是彻底独立的 worker + D1 + R2，所以这几步可以并发做。
 */
async function prepareSlot(slot: number): Promise<E2eRunState> {
  const origin = originForSlot(slot);
  await waitForPortal(origin);

  const adminApi = await newApiContext(undefined, origin);
  const memberApi = await newApiContext(undefined, origin);
  try {
    await login(adminApi, ADMIN_LOGIN_NAME, ADMIN_PASSWORD);
    await adminApi.storageState({ path: stateFileFor("admin", slot) });
    /* 管理员登录属于稳定夹具；run 及其普通成员在基线之后创建，finalize 会完整删除。 */
    const baseline = await readSlotFingerprint(slot);
    const runId = await createSystemTestRun(adminApi);
    await prepareTrackedMember(adminApi, memberApi, runId, slot);
    await memberApi.storageState({ path: stateFileFor("member", slot) });
    return { runId, baseline };
  } finally {
    await Promise.all([adminApi.dispose(), memberApi.dispose()]);
  }
}

async function globalSetup(): Promise<void> {
  /* 产物过期就当场停：跑下去只会拿上一版代码测出一片绿。 */
  await assertE2eBuildFresh();
  await mkdir(STATE_DIR, { recursive: true });
  /*
   * 先删本轮槽位对应的旧 run/session 元数据。setup 万一中途失败，teardown 照样会跑；
   * 留着旧文件会让 teardown 拿已被 fresh slot 丢弃的 run id 清理，或让测试误读旧会话。
   * 这里只碰本轮槽位；其他槽位可能属于另一轮诊断，不能顺手清掉。
   */
  await Promise.all([
    rm(RUN_STATE_FILE, { force: true }),
    ...Array.from({ length: E2E_SLOTS }, (_, slot) => [
      rm(stateFileFor("admin", slot), { force: true }),
      rm(stateFileFor("member", slot), { force: true }),
    ]).flat(),
  ]);

  const slots = await Promise.all(
    Array.from({ length: E2E_SLOTS }, (_, slot) => prepareSlot(slot)),
  );

  const state: E2eRunStateFile = { slots };
  await writeFile(RUN_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export default globalSetup;
