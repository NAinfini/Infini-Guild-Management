import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./client";

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
});
