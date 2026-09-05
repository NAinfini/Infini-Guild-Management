// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiDownload, apiRequest, resetApiSessionCache } from "./client";
import { deferred } from "../testing/deferred";

describe("apiRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetApiSessionCache();
  });

  it("reuses cached JSON when the server returns 304", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: "\"etag-1\"" },
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 304,
        headers: { ETag: "\"etag-1\"" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest<{ ok: boolean }>("/api/test")).resolves.toEqual({ ok: true });
    await expect(apiRequest<{ ok: boolean }>("/api/test")).resolves.toEqual({ ok: true });

    expect(new Headers(fetchMock.mock.calls[1]![1].headers).get("If-None-Match")).toBe("\"etag-1\"");
  });

  it("drops session-bound ETag responses on an explicit session cache reset", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ owner: "user-a" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: "\"user-a\"" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ owner: "user-b" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: "\"user-b\"" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/users");
    resetApiSessionCache();
    await expect(apiRequest("/api/users")).resolves.toEqual({ owner: "user-b" });

    expect(new Headers(fetchMock.mock.calls[1]![1].headers).has("If-None-Match")).toBe(false);
  });

  it("keeps the current session when a business operation returns 401", async () => {
    const browserWindow = new EventTarget();
    const dispatch = vi.spyOn(browserWindow, "dispatchEvent");
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error_code: "UNAUTHORIZED",
      message: "Current password is incorrect",
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(apiRequest("/api/auth/security/password", {
      method: "PATCH",
      bodyJson: { current_password: "wrong", new_password: "new-password" },
    })).rejects.toEqual(expect.objectContaining({
      status: 401,
      message: "Current password is incorrect",
    }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("marks PUT requests as same-origin mutations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/important-notices/notice-1/acknowledgement", { method: "PUT", bodyJson: {} });

    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get("X-Requested-With")).toBe("XMLHttpRequest");
  });

  it("marks PUT downloads as same-origin mutations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiDownload("/api/export", { method: "PUT" });

    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get("X-Requested-With")).toBe("XMLHttpRequest");
  });

  it.each([200, 304])("does not restore an old identity's ETag cache from a late %s response", async (status) => {
    const pending = deferred<Response>();
    const json = (owner: string) => new Response(JSON.stringify({ owner }), {
      headers: { ETag: `"${owner}"`, "Content-Type": "application/json" },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json("user-a"))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(json("user-b"))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/api/private-session");
    const oldRequest = apiRequest("/api/private-session");
    resetApiSessionCache();
    await apiRequest("/api/private-session");
    pending.resolve(status === 304 ? new Response(null, { status: 304 }) : json("user-a"));
    await oldRequest;
    await expect(apiRequest("/api/private-session")).resolves.toEqual({ owner: "user-b" });
    expect(new Headers(fetchMock.mock.calls[3]![1].headers).get("If-None-Match")).toBe('"user-b"');
  });

  it("does not invalidate a newer session's cache when an old mutation completes", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ owner: "user-b" }), { headers: { ETag: '"user-b"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);
    const oldRequest = apiRequest("/api/users/user-a", { method: "PATCH", bodyJson: {} });
    resetApiSessionCache();
    await apiRequest("/api/users/user-a");
    pending.resolve(new Response("{}"));
    await oldRequest;
    await expect(apiRequest("/api/users/user-a")).resolves.toEqual({ owner: "user-b" });
    expect(new Headers(fetchMock.mock.calls[2]![1].headers).get("If-None-Match")).toBe('"user-b"');
  });

  it.each([apiRequest, apiDownload])("preserves caller cancellation without reporting a network failure (%#)", async (request) => {
    const browserWindow = new EventTarget();
    const dispatch = vi.spyOn(browserWindow, "dispatchEvent");
    vi.stubGlobal("window", browserWindow);
    const controller = new AbortController();
    const cancelled = new DOMException("Upload cancelled", "AbortError");
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    })));

    const result = request("/api/gallery/images", { signal: controller.signal });
    controller.abort(cancelled);

    await expect(result).rejects.toBe(cancelled);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
