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
  /** 浏览器在服务端眼里的客户端地址：限流按它分桶，见 config.ts 的说明。 */
  clientAddress: string;
  /** 回读通道的客户端地址：和浏览器分开计配额，理由见下面 fixture 的说明。 */
  apiClientAddress: string;
  /** 页面级失败守卫：未捕获异常和 5xx 一律判定为缺陷，不允许被吞掉。 */
  failOnPageDefects: void;
  /** 把客户端地址（以及需要时的系统测试运行头）装到浏览器上下文上。 */
  requestIdentity: void;
  /** 取证开关：量这条用例烧掉多少读配额。默认关，见下面 fixture 的说明。 */
  quotaTrace: void;
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

/*
 * 配额取证的收集点，只有 E2E_QUOTA_TRACE 打开时才不是 null（见 quotaTrace fixture）。
 * 浏览器和 api 回读通道现在各占一个客户端号，但两边都要量：
 * 只量浏览器那一半，就看不出回读通道自己有没有把它那一份配额烧穿。
 */
let quotaWorst: Map<string, number> | null = null;

/* 分「浏览器」和「回读通道」两路记，是为了看清一条用例的配额到底花在哪一边。 */
function recordQuota(headers: Record<string, string>, source: "page" | "api"): void {
  if (!quotaWorst) return;
  const limit = headers["x-ratelimit-limit"];
  const remaining = Number(headers["x-ratelimit-remaining"]);
  if (!limit || !Number.isFinite(remaining)) return;
  const key = `${source}:${limit}`;
  quotaWorst.set(key, Math.min(quotaWorst.get(key) ?? Number.POSITIVE_INFINITY, remaining));
}

function withQuotaTrace(context: APIRequestContext): APIRequestContext {
  if (!process.env.E2E_QUOTA_TRACE) return context;
  return new Proxy(context, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      if (typeof property !== "string" || !RETRYABLE_METHODS.has(property)) {
        return value.bind(target);
      }
      return async (...args: unknown[]) => {
        const response = await (value as (...a: unknown[]) => Promise<APIResponse>).call(target, ...args);
        recordQuota(response.headers(), "api");
        return response;
      };
    },
  });
}

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
const CLIENT_IDS_PER_WORKER = 300;
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

function matches(response: Response, expected: ApiExpectation): boolean {
  return response.request().method() === expected.method
    && expected.path.test(pathOf(response.url()));
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

  clientAddress: async ({}, use, testInfo) => {
    await use(allocateClientAddress(testInfo.workerIndex));
  },

  /*
   * 回读通道自己占一个客户端号，不和浏览器共用。
   *
   * 共用时两边的请求算进同一个 120 次/分钟的读桶，而回读通道并不是被模拟的那个
   * 用户——它是用例的量具，用来绕开界面直接问服务端「到底落库了没有」。
   * 把量具的流量记到被测用户头上，得到的既不是真实用户的用量，也不是一个能用的预算。
   * 更直接的代价是取证本身失真：共用一个桶时，两边读到的
   * X-RateLimit-Remaining 讲的是同一个数，api 那一行看着像「回读通道烧了 55 次」，
   * 其实里头 54 次是浏览器烧的。拆开之后每一行才只讲自己那一份。
   *
   * 这不是放宽限流：拆开之后两个通道各自仍受 120 次/分钟约束，
   * 浏览器那一半真的超了照样会 429、照样看得见。
   * 限流本身仍由专门的用例覆盖（见 config.ts 的说明）。
   *
   * 注意这不是 CI 上那批读配额 429 的解法。那一批的成因是服务端压根没按地址分桶
   * （见 config.ts 的 clientIdentityHeaders），拆几个号都没用。本地单条用例的读峰值
   * 只有 50–55/120，离 120 一直很远。
   */
  apiClientAddress: async ({}, use, testInfo) => {
    await use(allocateClientAddress(testInfo.workerIndex));
  },

  api: async ({ trackArtifacts, apiClientAddress, storageState }, use) => {
    const context = await request.newContext({
      baseURL: PORTAL_ORIGIN,
      storageState: storageState as string | undefined,
      extraHTTPHeaders: { ...MUTATION_HEADERS, ...identityHeaders(apiClientAddress, trackArtifacts) },
    });
    await use(withQuotaTrace(withNetworkRetries(context)));
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

  /*
   * E2E_QUOTA_TRACE=1 时打印每条用例烧掉的读配额，默认完全不接线。
   *
   * 服务端把每条用例当成一个独立客户端（见 config.ts 的说明），配额是
   * 120 次读/分钟。用例驱动界面的速度远超真人，「一条用例会不会把自己的
   * 配额点爆」不能靠推测，只能量。X-RateLimit-Remaining 是服务端自己报的
   * 剩余额度。
   *
   * 输出按「来源 已用/上限」分开报，因为浏览器和回读通道是两个客户端号、两个桶
   * （见 apiClientAddress fixture）。两路都要记：只量浏览器那一半，
   * 就看不出回读通道有没有把它自己那一份烧穿。
   */
  quotaTrace: [async ({ page }, use, testInfo) => {
    if (!process.env.E2E_QUOTA_TRACE) {
      await use();
      return;
    }
    /* 按桶分开：limit=120 是读、80 是写、20 是上传、15 是查重名、5 是登录/改凭据。
       混在一起看只会看到最后一个响应属于哪个桶，得不出任何结论。 */
    quotaWorst = new Map<string, number>();
    const record = (response: Response): void => {
      if (!pathOf(response.url()).startsWith("/api/")) return;
      recordQuota(response.headers(), "page");
    };
    page.on("response", record);
    await use();
    page.off("response", record);
    /* 键是 `${来源}:${上限}`，打成「page 40/120」这种形状：分子是烧掉的量，
       分母是这个桶的上限，前缀说明这一半花在浏览器还是回读通道上。 */
    const report = [...quotaWorst.entries()]
      .map(([key, left]) => {
        const [source, limit] = key.split(":");
        return `${source} ${Number(limit) - left}/${limit}`;
      })
      .sort()
      .join("  ");
    quotaWorst = null;
    console.log(`[quota] ${report || "none"} :: ${testInfo.titlePath.at(-1)}`);
  }, { auto: true }],
});

/** 回读服务端的返回值，顺带把非 2xx 变成带响应体的明确失败。 */
export async function readJson(response: APIResponse, label: string): Promise<unknown> {
  expect(response.ok(), `${label} 返回 ${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}
