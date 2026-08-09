import { describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import { serveR2Object } from "../routes/_shared";

/*
 * serveR2Object 的单元边界:把 R2 的返回形态(完整对象 / 无 body 的条件命中 /
 * 带 range 的部分对象 / null)映射成正确的 HTTP 响应。R2 本身的条件求值和
 * range 解析是平台行为,不在这里重演,桶替身按用例直接给出结果。
 */

function fakeObject(overrides: Record<string, unknown> = {}) {
  return {
    size: 10,
    httpEtag: '"etag-1"',
    writeHttpMetadata: (headers: Headers) => headers.set("Content-Type", "image/webp"),
    ...overrides,
  };
}

/*
 * R2 返回的 range 把 offset/length/suffix 三个字段都摆上,没用到的置为
 * undefined。替身必须照这个形状给:只给用到的字段,靠 `in` 判分支的写法在测试里
 * 会一直走对分支,线上却每次都落进 suffix 分支算出 NaN。
 */
function runtimeRange(served: { offset?: number; length?: number; suffix?: number }) {
  return { offset: undefined, length: undefined, suffix: undefined, ...served };
}

function createContext(bucket: { get: unknown }, requestHeaders: HeadersInit = {}) {
  return {
    env: { MEDIA: bucket },
    req: { raw: new Request("https://worker.test/api/media/example", { headers: requestHeaders }) },
    get: () => "req-test",
    json: (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  } as unknown as Context;
}

describe("serveR2Object", () => {
  it("serves the full object with caching and range-advertising headers", async () => {
    const get = vi.fn().mockResolvedValue(fakeObject({ body: "0123456789" }));

    const response = await serveR2Object(createContext({ get }), "media/a", "missing");

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"etag-1"');
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Cache-Control")).toContain("max-age");
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(await response.text()).toBe("0123456789");
    /* 条件头必须转发给 R2,否则 304 永远不会发生;没有 Range 头就不传 range。 */
    expect(get).toHaveBeenCalledWith("media/a", { onlyIf: expect.any(Headers), range: undefined });
  });

  it("returns 304 without a body when R2 reports the precondition matched", async () => {
    const get = vi.fn().mockResolvedValue(fakeObject());

    const response = await serveR2Object(
      createContext({ get }, { "If-None-Match": '"etag-1"' }),
      "media/a",
      "missing",
    );

    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    expect(response.headers.get("ETag")).toBe('"etag-1"');
  });

  it("answers a satisfied range with 206, Content-Range, and Content-Length", async () => {
    const get = vi.fn().mockResolvedValue(fakeObject({ body: "234", range: runtimeRange({ offset: 2, length: 3 }) }));

    const response = await serveR2Object(
      createContext({ get }, { Range: "bytes=2-4" }),
      "media/a",
      "missing",
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-4/10");
    expect(response.headers.get("Content-Length")).toBe("3");
    expect(await response.text()).toBe("234");
    expect(get).toHaveBeenCalledWith("media/a", { onlyIf: expect.any(Headers), range: expect.any(Headers) });
  });

  /* 媒体元素取音频时发的就是这条开放区间。Content-Range 一旦算成 NaN,Chrome 会
     判定 206 非法并抛 NotSupportedError,名册悬停播放因此整段静音。 */
  it("answers the open-ended range a media element sends", async () => {
    const get = vi.fn().mockResolvedValue(
      fakeObject({ body: "0123456789", range: runtimeRange({ offset: 0, length: 10 }) }),
    );

    const response = await serveR2Object(
      createContext({ get }, { Range: "bytes=0-" }),
      "media/a",
      "missing",
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-9/10");
    expect(response.headers.get("Content-Length")).toBe("10");
  });

  it("maps a suffix range onto absolute Content-Range positions", async () => {
    const get = vi.fn().mockResolvedValue(fakeObject({ body: "6789", range: runtimeRange({ suffix: 4 }) }));

    const response = await serveR2Object(
      createContext({ get }, { Range: "bytes=-4" }),
      "media/a",
      "missing",
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 6-9/10");
    expect(response.headers.get("Content-Length")).toBe("4");
  });

  it("ignores a store-reported range when the request never asked for one", async () => {
    /* 本地 R2(workerd)在完整读取时也会把 object.range 填上;只有请求真带了
       Range 头才允许回 206,否则普通 GET 会拿到部分响应语义。 */
    const get = vi.fn().mockResolvedValue(
      fakeObject({ body: "0123456789", range: runtimeRange({ offset: 0, length: 10 }) }),
    );

    const response = await serveR2Object(createContext({ get }), "media/a", "missing");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Range")).toBeNull();
    expect(await response.text()).toBe("0123456789");
  });

  it("falls back to the full object when R2 rejects the requested range", async () => {
    const get = vi.fn()
      .mockRejectedValueOnce(new Error("range not satisfiable"))
      /* 重试后的完整读取同样可能带着 store 自己填的 range,不能因此变成 206。 */
      .mockResolvedValueOnce(fakeObject({ body: "0123456789", range: runtimeRange({ offset: 0, length: 10 }) }));

    const response = await serveR2Object(
      createContext({ get }, { Range: "bytes=98-99" }),
      "media/a",
      "missing",
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("0123456789");
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1]?.[1]).toEqual({ onlyIf: expect.any(Headers) });
  });

  it("returns the standard NOT_FOUND envelope for a missing key", async () => {
    const get = vi.fn().mockResolvedValue(null);

    const response = await serveR2Object(createContext({ get }), "media/missing", "Media not found");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error_code: "NOT_FOUND", message: "Media not found" });
  });
});
