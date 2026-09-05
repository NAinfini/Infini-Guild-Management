import { readFileSync } from "node:fs";
import {
  expect,
  request,
  test as base,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { MUTATION_HEADERS, systemTestHeaders } from "./api";
import { matchesApiResponse, type ApiExpectation } from "./api-expectation";
import {
  clientIdentityHeaders,
  e2eClientAddress,
  PORTAL_ORIGIN,
  RUN_STATE_FILE,
  SLOT_INDEX,
  stateFileFor,
  type E2eOptions,
  type E2eRunStateFile,
} from "./config";

export { expect };

export type { ApiExpectation, HttpMethod } from "./api-expectation";

export type Flow = {
  /**
   * 点控件，并要求它真的把预期请求发出去、服务端也按预期状态回应。
   *
   * 只断言「点了没报错」等于什么都没验证：按钮可能压根没绑事件、
   * 请求可能被前端吞掉、服务端可能 200 但没落库。这里先钉住网络这一层，
   * 数值层面的效果由调用方回读服务端自行断言。
   */
  click(control: Locator, expected: ApiExpectation): Promise<unknown>;
  /**
   * 同上，但动作由回调自定义（填表后回车、拖拽、键盘操作等）。
   * 注意：不要用它包整页导航（goto/reload）。导航一发生，CDP 就丢掉旧响应体，
   * 这里读 response.text() 会抛 "No resource with given identifier found"。
   * 导航后请改成断言页面上出现了新数据。
   */
  act(action: () => Promise<void>, expected: ApiExpectation): Promise<unknown>;
  /** 断言这个操作完全不碰网络——纯前端控件（排序、筛选、折叠）该走这条。 */
  clickWithoutApi(control: Locator, quietMs?: number): Promise<void>;
};

type Fixtures = {
  flow: Flow;
  /** 与页面同会话的服务端回读通道：UI 显示对不等于数据对。 */
  api: APIRequestContext;
  /** 浏览器在服务端眼里的客户端地址：限流按它分桶，见 config.ts 的说明。 */
  clientAddress: string;
  /** 回读通道的客户端地址：和浏览器分开计配额，理由见下面 fixture 的说明。 */
  apiClientAddress: string;
  /** 页面级失败守卫：未捕获异常和 5xx 一律判定为缺陷，不允许被吞掉。 */
  failOnPageDefects: void;
  /** 把客户端地址（以及需要时的系统测试运行头）装到浏览器上下文上。 */
  requestIdentity: void;
};

let cachedRunState: E2eRunStateFile | null = null;
/*
 * 客户端号：一条用例最多领两个（浏览器一个、api 回读通道一个），
 * 而且这些号必须在**整轮**里唯一，不能只在一个进程里唯一。
 *
 * 模块级自增计数器的生命周期是进程，不是槽位：Playwright 只要有用例失败、
 * 或者切到下一个 project，就会换一个新的 worker 进程接着跑同一个槽位，
 * 计数器随之归零。于是新进程里的用例重新领到 10.42.0.2、10.42.0.3……
 * 和一分钟内刚跑过的用例挤进同一个限流桶。撞上就 429，429 造成失败，
 * 失败又换进程、又归零——一次失败会滚成一串看不出关联的 429，
 * 而且只在有失败的环境里出现（本地全绿时计数器从不归零，永远看不到）。
 *
 * workerIndex 是「整轮里的第几个 worker 进程」，单调递增且不重复
 * （会复用的是 parallelIndex，那是槽位号），拿它给每个进程切一段互不相交的号段。
 */
// A full one-slot run consumes a little over 300 identities because every test
// owns separate browser and API buckets. Keep enough headroom for the supported
// single-worker diagnostic mode while retaining the explicit overflow failure.
const CLIENT_IDS_PER_WORKER = 512;
let clientCounter = 0;

/** 领一个整轮唯一的客户端地址。号段一旦溢出就当场报错，不允许静默回到互撞。 */
function allocateClientAddress(workerIndex: number): string {
  clientCounter += 1;
  if (clientCounter > CLIENT_IDS_PER_WORKER) {
    throw new Error(
      `单个 worker 进程用掉了超过 ${CLIENT_IDS_PER_WORKER} 个客户端号，号段会和别的进程重叠；请调大 CLIENT_IDS_PER_WORKER`,
    );
  }
  return e2eClientAddress(workerIndex * CLIENT_IDS_PER_WORKER + clientCounter);
}

function runState(): E2eRunStateFile {
  cachedRunState ??= JSON.parse(readFileSync(RUN_STATE_FILE, "utf8")) as E2eRunStateFile;
  return cachedRunState;
}

/** 本进程这个槽位的运行记录。缺了就是 globalSetup 没跑全，直接报出来。 */
function slotRunState() {
  const state = runState().slots[SLOT_INDEX];
  if (!state) {
    throw new Error(`run.json 里没有槽位 ${SLOT_INDEX} 的记录，globalSetup 没有把所有槽位准备好`);
  }
  return state;
}

function pathOf(url: string): string {
  return new URL(url).pathname;
}

/** 身份头：客户端地址 + 需要时的系统测试运行头。自己新开上下文的用例也得装齐。 */
export function identityHeaders(clientAddress: string, trackArtifacts: boolean): Record<string, string> {
  return {
    ...clientIdentityHeaders(clientAddress),
    ...(trackArtifacts ? systemTestHeaders(slotRunState().runId) : {}),
  };
}

/**
 * 给任意页面装上缺陷守卫，返回的函数在用例收尾时调用（断言没出过缺陷）。
 * fixture 只看得见默认的 page，自己新开上下文的用例必须显式装一份，
 * 否则那张页面上的未捕获异常和 5xx 会被无声吞掉。
 */
export function watchPageDefects(page: Page): () => void {
  const defects: string[] = [];
  page.on("pageerror", (error) => defects.push(`未捕获异常: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500 && pathOf(response.url()).startsWith("/api/")) {
      defects.push(`${response.request().method()} ${pathOf(response.url())} -> ${response.status()}`);
    }
  });
  return () => {
    expect(defects, "页面在这条用例里出现了缺陷").toEqual([]);
  };
}

export function createFlow(page: Page): Flow {
  /* clickWithoutApi 先等待 API 静止，并按请求开始时间归因，以排除点击前已在飞的请求。 */
  /* 记的是在飞的请求本身而不是个数：awaitApi 要凭它认出「这一发是上一步的，不是这次操作的」。 */
  const apiInFlight = new Set<Request>();
  let lastApiSettledAt = 0;
  const isApiUrl = (url: string): boolean => pathOf(url).startsWith("/api/");
  page.on("request", (request) => {
    if (isApiUrl(request.url())) apiInFlight.add(request);
  });
  const releaseRequest = (request: Request): void => {
    if (!isApiUrl(request.url())) return;
    apiInFlight.delete(request);
    lastApiSettledAt = Date.now();
  };
  page.on("requestfinished", releaseRequest);
  page.on("requestfailed", releaseRequest);

  async function waitForApiQuiet(quietMs: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const quietFor = Date.now() - lastApiSettledAt;
      if (apiInFlight.size === 0 && quietFor >= quietMs) return;
      if (Date.now() >= deadline) return;
      await page.waitForTimeout(apiInFlight.size > 0 ? 50 : quietMs - quietFor);
    }
  }

  async function awaitApi(action: () => Promise<void>, expected: ApiExpectation): Promise<unknown> {
    /*
     * 排除动作开始前已在飞的请求。动作之后的后台刷新仍可能走同一路径，
     * 因此搜索和筛选调用还须提供 query，不能把后台缓存校验当成搜索完成。
     */
    const stale = new Set(apiInFlight);
    const waiter = page.waitForResponse((response) =>
      !stale.has(response.request()) && matchesApiResponse(response, expected));
    await action();
    const response = await waiter;
    const url = new URL(response.url());
    const label = `${expected.method} ${url.pathname}${url.search}`;

    if (expected.status === undefined) {
      expect(response.ok(), `${label} 返回 ${response.status()}`).toBe(true);
    } else {
      expect(response.status(), label).toBe(expected.status);
    }

    const contentType = response.headers()["content-type"] ?? "";
    return contentType.includes("json") ? response.json() : response.text();
  }

  return {
    click: (control, expected) => awaitApi(() => control.click(), expected),
    act: (action, expected) => awaitApi(action, expected),
    async clickWithoutApi(control, quietMs = 500) {
      await waitForApiQuiet(quietMs, 10_000);
      const calls: string[] = [];
      /* 记录请求开始事件，观察窗口只归因于点击后新发出的 API 请求。 */
      const record = (request: Request): void => {
        if (isApiUrl(request.url())) {
          calls.push(`${request.method()} ${pathOf(request.url())}`);
        }
      };
      page.on("request", record);
      try {
        await control.click();
        await page.waitForTimeout(quietMs);
      } finally {
        page.off("request", record);
      }
      expect(calls, "这个控件本应是纯前端的，却发了请求").toEqual([]);
    },
  };
}

export const test = base.extend<E2eOptions & Fixtures>({
  trackArtifacts: [false, { option: true }],
  role: ["guest", { option: true }],

  /*
   * 源和会话都得按槽位挑，而这两件事 playwright.config.ts 定不了：
   * 配置在主进程里求值，那里没有 TEST_PARALLEL_INDEX。这两个 fixture 跑在
   * worker 进程里，PORTAL_ORIGIN / SLOT_INDEX 已经是本槽位的值。
   */
  baseURL: async ({}, use) => {
    await use(PORTAL_ORIGIN);
  },

  storageState: async ({ role }, use) => {
    await use(role === "guest" ? undefined : stateFileFor(role, SLOT_INDEX));
  },

  flow: async ({ page }, use) => {
    await use(createFlow(page));
  },

  clientAddress: async ({}, use, testInfo) => {
    await use(allocateClientAddress(testInfo.workerIndex));
  },

  /*
   * 回读通道验证持久化结果，使用独立客户端号，避免测试量具占用浏览器用户的配额。
   * 两个通道各自仍受服务端真实限流约束，限流本身另有专门用例覆盖。
   */
  apiClientAddress: async ({}, use, testInfo) => {
    await use(allocateClientAddress(testInfo.workerIndex));
  },

  api: async ({ trackArtifacts, apiClientAddress, storageState }, use) => {
    const context = await request.newContext({
      baseURL: PORTAL_ORIGIN,
      storageState: storageState as string | undefined,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { ...MUTATION_HEADERS, ...identityHeaders(apiClientAddress, trackArtifacts) },
    });
    await use(context);
    await context.dispose();
  },

  requestIdentity: [async ({ context, trackArtifacts, clientAddress }, use) => {
    // setExtraHTTPHeaders 是整体替换，两类头必须一次装齐。
    await context.setExtraHTTPHeaders(identityHeaders(clientAddress, trackArtifacts));
    await use();
  }, { auto: true }],

  failOnPageDefects: [async ({ page }, use) => {
    const assertClean = watchPageDefects(page);
    await use();
    assertClean();
  }, { auto: true }],

});

/** 回读服务端的返回值，顺带把非 2xx 变成带响应体的明确失败。 */
export async function readJson(response: APIResponse, label: string): Promise<unknown> {
  expect(response.ok(), `${label} 返回 ${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}
