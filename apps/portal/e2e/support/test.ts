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
  type Response,
} from "@playwright/test";
import { MUTATION_HEADERS, systemTestHeaders } from "./api";
import {
  e2eClientAddress,
  PORTAL_ORIGIN,
  RUN_STATE_FILE,
  SLOT_INDEX,
  stateFileFor,
  type E2eOptions,
  type E2eRunStateFile,
} from "./config";

export { expect };

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** 一次控件操作应该在网络上留下的痕迹。 */
export type ApiExpectation = {
  method: HttpMethod;
  /** 匹配 pathname（不含查询串），用正则是因为大部分路径里带 id。 */
  path: RegExp;
  /** 默认要求 2xx；只有在专门验证失败分支时才显式写非 2xx。 */
  status?: number;
};

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
  /** 本条用例在服务端眼里的客户端地址：限流按它分桶，见 config.ts 的说明。 */
  clientAddress: string;
  /** 页面级失败守卫：未捕获异常和 5xx 一律判定为缺陷，不允许被吞掉。 */
  failOnPageDefects: void;
  /** 把客户端地址（以及需要时的系统测试运行头）装到浏览器上下文上。 */
  requestIdentity: void;
};

/*
 * 回读通道对 ECONNRESET 重试两次。
 *
 * 浏览器和 api 都走 portal 的 vite 开发代理，代理会主动掐掉闲置的 keep-alive 连接。
 * 一条用例的节奏通常是：beforeEach 连着发几个请求造数据 → 界面上操作好几秒（这期间
 * 那条连接一直闲着）→ afterEach 复用它去清理。正好撞上代理关连接的时刻，
 * 就是 read ECONNRESET——清理没跑完，产物留在库里，报出来的却像用例失败。
 *
 * Playwright 的 maxRetries 只重试网络层的 ECONNRESET，明确不按 HTTP 状态码重试，
 * 所以服务端的任何失败（含 5xx）照样原样抛出来，不会被这层重试盖掉。
 */
const NETWORK_RETRIES = 2;
const RETRYABLE_METHODS = new Set(["fetch", "get", "post", "put", "patch", "delete", "head"]);

function withNetworkRetries(context: APIRequestContext): APIRequestContext {
  return new Proxy(context, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      if (typeof property !== "string" || !RETRYABLE_METHODS.has(property)) {
        return value.bind(target);
      }
      return (url: unknown, options?: Record<string, unknown>) =>
        (value as (...args: unknown[]) => unknown).call(target, url, {
          maxRetries: NETWORK_RETRIES,
          ...options,
        });
    },
  });
}

let cachedRunState: E2eRunStateFile | null = null;
/*
 * 每条用例一个号。同一个槽位里是串行的，自增就够；跨槽位不必协调——
 * 限流计数存在各自那个 worker 实例的 Cache API 里，本来就不共享。
 */
let clientCounter = 0;

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

function matches(response: Response, expected: ApiExpectation): boolean {
  return response.request().method() === expected.method
    && expected.path.test(pathOf(response.url()));
}

/** 身份头：客户端地址 + 需要时的系统测试运行头。自己新开上下文的用例也得装齐。 */
export function identityHeaders(clientAddress: string, trackArtifacts: boolean): Record<string, string> {
  return {
    "X-Forwarded-For": clientAddress,
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
  /*
   * 页面自己发起的请求要先落完，clickWithoutApi 才有资格开始计时。
   *
   * 那条断言的语义是「这次点击没引发请求」，但实现上只能观察点击后一段窗口里出现的
   * 所有 /api/ 响应。页面加载后的查询往往是链式的（比如公会战分析：analytics →
   * details → 由 details 算出的请假窗口 → absences），上一环的数据落地才会触发下一环。
   * 单跑时这条链在点击之前就走完了，整套跑起来慢一截，尾巴上那一发正好落进点击后的
   * 窗口，于是别人的请求被算到了被点的控件头上——之前 guild-war-analytics 那条
   * 「整套跑挂、单跑就过」就是这么来的。
   *
   * 这里补的是断言缺的前提，不是放宽断言：点击窗口内仍然一个请求都不许有。
   * 等不静下来也不吞——直接往下走，让下面的断言把那串请求原样报出来（页面在轮询
   * 本身就是缺陷，藏起来只会更难查）。
   */
  let apiInFlight = 0;
  let lastApiSettledAt = 0;
  const isApiUrl = (url: string): boolean => pathOf(url).startsWith("/api/");
  page.on("request", (request) => {
    if (isApiUrl(request.url())) apiInFlight += 1;
  });
  const releaseRequest = (request: Request): void => {
    if (!isApiUrl(request.url())) return;
    apiInFlight = Math.max(0, apiInFlight - 1);
    lastApiSettledAt = Date.now();
  };
  page.on("requestfinished", releaseRequest);
  page.on("requestfailed", releaseRequest);

  async function waitForApiQuiet(quietMs: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const quietFor = Date.now() - lastApiSettledAt;
      if (apiInFlight === 0 && quietFor >= quietMs) return;
      if (Date.now() >= deadline) return;
      await page.waitForTimeout(apiInFlight > 0 ? 50 : quietMs - quietFor);
    }
  }

  async function awaitApi(action: () => Promise<void>, expected: ApiExpectation): Promise<unknown> {
    const waiter = page.waitForResponse((response) => matches(response, expected));
    await action();
    const response = await waiter;
    const label = `${expected.method} ${pathOf(response.url())}`;

    if (expected.status === undefined) {
      expect(response.ok(), `${label} 返回 ${response.status()}: ${await response.text()}`).toBe(true);
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
      /*
       * 记的是「发出去」而不是「回来了」。
       * 按响应记的话，点击之前就已经在飞的请求只要在窗口里落地就会被算进来——
       * 那不是这次点击干的。按请求记，窗口里出现的每一条都确实是点击之后才发出去的。
       */
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

  clientAddress: async ({}, use) => {
    clientCounter += 1;
    await use(e2eClientAddress(clientCounter));
  },

  api: async ({ trackArtifacts, clientAddress, storageState }, use) => {
    const context = await request.newContext({
      baseURL: PORTAL_ORIGIN,
      storageState: storageState as string | undefined,
      extraHTTPHeaders: { ...MUTATION_HEADERS, ...identityHeaders(clientAddress, trackArtifacts) },
    });
    await use(withNetworkRetries(context));
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
