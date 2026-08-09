import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, resetApiSessionCache } from "./client";

describe("apiRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
