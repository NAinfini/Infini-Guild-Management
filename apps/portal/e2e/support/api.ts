import { request, type APIRequestContext } from "@playwright/test";
import {
  SYSTEM_TEST_HEADER,
  SYSTEM_TEST_HEADER_VALUE,
  SYSTEM_TEST_RUN_ID_HEADER,
} from "@guild/shared/config/system-test";
import {
  clientIdentityHeaders,
  FINGERPRINT_IGNORED_KEYS,
  PORTAL_ORIGIN,
  SETUP_CLIENT_ADDRESS,
  type SiteFingerprint,
} from "./config";

/*
 * 每个 /api/* 变更都卡在 Origin + X-Requested-With 双重校验后面，
 * 裸 POST 会在进路由之前就被 403 挡掉。
 */
export function mutationHeaders(origin: string): Record<string, string> {
  return {
    Origin: origin,
    "X-Requested-With": "XMLHttpRequest",
  };
}

/** 本进程所属槽位的那一份。跨槽位操作（globalSetup/teardown）必须显式传 origin。 */
export const MUTATION_HEADERS = mutationHeaders(PORTAL_ORIGIN);

/** 让一次请求进入服务端的系统测试运行：产物会被按主键登记，等着被清掉。 */
export function systemTestHeaders(runId: string): Record<string, string> {
  return {
    [SYSTEM_TEST_HEADER]: SYSTEM_TEST_HEADER_VALUE,
    [SYSTEM_TEST_RUN_ID_HEADER]: runId,
  };
}

export async function newApiContext(
  storageStatePath?: string,
  origin: string = PORTAL_ORIGIN,
): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: origin,
    storageState: storageStatePath,
    // 固定地址：让 setup/teardown 的配额和用例的配额互不牵连。
    extraHTTPHeaders: { ...mutationHeaders(origin), ...clientIdentityHeaders(SETUP_CLIENT_ADDRESS) },
  });
}

/**
 * E2E 配额隔离要求按客户端地址分桶：同地址读数递减，不同地址使用独立桶。
 * 预检不满足时携带诊断立即停止。
 */
export async function assertRateLimitIsolation(origin: string, slot: number): Promise<void> {
  const remainingFor = async (address: string): Promise<number> => {
    const api = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: clientIdentityHeaders(address),
    });
    try {
      const response = await api.get("/api/auth/me");
      const headers = response.headers();
      const remaining = Number(headers["x-ratelimit-remaining"]);
      if (headers["x-ratelimit-scope"] !== "read" || !Number.isFinite(remaining)) {
        throw new Error(
          `${origin} 没有按预期回限流头：scope=${headers["x-ratelimit-scope"]} remaining=${headers["x-ratelimit-remaining"]}`,
        );
      }
      return remaining;
    } finally {
      await api.dispose();
    }
  };

  /* 地址按槽位错开，免得并发准备的几个槽位互相干扰。 */
  const first = `10.40.${slot}.1`;
  const second = `10.40.${slot}.2`;
  const firstA = await remainingFor(first);
  const firstB = await remainingFor(first);
  const other = await remainingFor(second);

  if (firstB >= firstA) {
    throw new Error(
      `${origin} 的限流没有在计数：同一个地址连发两次，剩余额度是 ${firstA} → ${firstB}`,
    );
  }
  if (other <= firstB) {
    throw new Error(
      [
        `${origin} 没有按客户端地址分限流桶：`,
        `地址 ${first} 用掉两次后剩 ${firstB}，换成 ${second} 的第一次却只剩 ${other}——两者共用一个桶。`,
        "所有用例都会挤进同一份配额，跑到中段一律 429，报出来却是各自的功能失败。",
        "先查 apps/portal/e2e/support/config.ts 的 clientIdentityHeaders 说明。",
      ].join("\n"),
    );
  }
}

async function expectOk(
  api: APIRequestContext,
  method: "get" | "post",
  path: string,
  data?: unknown,
): Promise<unknown> {
  const response = await api[method](path, data === undefined ? undefined : { data });
  if (!response.ok()) {
    // 静默降级会把「环境没起来」伪装成「用例失败」，这里必须把原始响应抬出来。
    throw new Error(`${method.toUpperCase()} ${path} -> ${response.status()}: ${await response.text()}`);
  }
  return response.json();
}

export async function waitForPortal(
  origin: string = PORTAL_ORIGIN,
  timeoutMs = 120_000,
): Promise<void> {
  const api = await request.newContext({ baseURL: origin });
  const deadline = Date.now() + timeoutMs;
  let lastError = "never attempted";
  try {
    while (Date.now() < deadline) {
      try {
        const health = await api.get("/api/health");
        const root = await api.get("/");
        if (health.ok() && root.ok()) return;
        lastError = `health ${health.status()}, root ${root.status()}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    await api.dispose();
  }
  throw new Error(`${origin} did not become ready within ${timeoutMs}ms: ${lastError}`);
}

/** 清库重种。e2e 的每次运行都从同一个已知基线出发，否则残留断言没有意义。 */
export async function reseed(api: APIRequestContext): Promise<void> {
  await expectOk(api, "post", "/api/dev/reseed");
}

export async function login(
  api: APIRequestContext,
  username: string,
  password: string,
): Promise<void> {
  await expectOk(api, "post", "/api/auth/login", { username, password, stay_logged_in: true });
}

export async function createSystemTestRun(adminApi: APIRequestContext): Promise<string> {
  const body = await expectOk(adminApi, "post", "/api/admin/status/system-test-runs") as { run_id?: string };
  if (!body.run_id) throw new Error("system-test run creation returned no run_id");
  return body.run_id;
}

export async function cleanupSystemTestRun(adminApi: APIRequestContext, runId: string): Promise<void> {
  const response = await adminApi.post(`/api/admin/status/system-test-runs/${runId}/cleanup`);
  const body = await response.text();
  if (!response.ok()) throw new Error(`cleanup of run ${runId} failed (${response.status()}): ${body}`);
  await expectOk(adminApi, "post", `/api/admin/status/system-test-runs/${runId}/finalize`);
}

export async function readFingerprint(api: APIRequestContext): Promise<SiteFingerprint> {
  const body = await expectOk(api, "get", "/api/dev/table-counts") as { counts?: SiteFingerprint };
  if (!body.counts) throw new Error("/api/dev/table-counts returned no counts");
  return body.counts;
}

export type FingerprintDrift = { key: string; before: number; after: number };

/**
 * 逐项比对两个指纹。返回空数组才算清干净——
 * 只报「多出来的」会漏掉被测试删掉的既有数据，两个方向都要看。
 */
export function diffFingerprints(before: SiteFingerprint, after: SiteFingerprint): FingerprintDrift[] {
  const drift: FingerprintDrift[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (FINGERPRINT_IGNORED_KEYS.has(key)) continue;
    const from = before[key] ?? 0;
    const to = after[key] ?? 0;
    if (from !== to) drift.push({ key, before: from, after: to });
  }
  return drift.sort((a, b) => a.key.localeCompare(b.key));
}

export function formatDrift(drift: readonly FingerprintDrift[]): string {
  return drift.map(({ key, before, after }) => `  ${key}: ${before} -> ${after}`).join("\n");
}
