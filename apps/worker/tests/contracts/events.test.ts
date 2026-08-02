import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventSchema } from "@guild/shared";

const BASE_URL = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

type Json = Record<string, unknown>;

async function api(
  path: string,
  options: { method?: string; body?: Json | FormData; cookie?: string; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body
      ? options.body instanceof FormData
        ? options.body
        : JSON.stringify(options.body)
      : undefined,
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return {
    status: response.status,
    headers: response.headers,
    payload: payload as Json,
  };
}

function extractCookie(headers: Headers): string | null {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return null;
  const first = setCookie.split(",")[0]!;
  return first.split(";")[0]?.trim() || null;
}

async function login(username: string, password: string): Promise<string> {
  const { headers } = await api("/api/auth/login", {
    method: "POST",
    body: { username, password, stay_logged_in: true },
  });
  const cookie = extractCookie(headers);
  if (!cookie) {
    throw new Error(`Login failed for ${username}: no cookie`);
  }
  return cookie;
}

let moderatorCookie = "";

beforeAll(async () => {
  const health = await api("/api/health");
  if (health.status !== 200) {
    throw new Error(`Worker not running at ${BASE_URL}. Start with: pnpm dev:worker`);
  }
  moderatorCookie = await login("mod_1", "moderator123");
});

afterAll(async () => {
  if (moderatorCookie) {
    await api("/api/auth/logout", {
      method: "POST",
      cookie: moderatorCookie,
    }).catch(() => {});
  }
});

describe("event contracts", () => {
  it("accepts json event creation and returns the shared event schema", async () => {
    const { status, payload } = await api("/api/events", {
      method: "POST",
      cookie: moderatorCookie,
      body: {
        type: "social",
        title: "Contract Event",
        start_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    expect(status).toBe(201);
    expect(() => eventSchema.parse(payload)).not.toThrow();
  });

  it("accepts multipart creation with attachments and returns typed attachment keys", async () => {
    const formData = new FormData();
    formData.append(
      "data",
      JSON.stringify({
        type: "social",
        title: "Contract Event With File",
        start_at: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );
    /* 字节头必须是真的：上传路径会按魔数复核声明的 Content-Type。 */
    formData.append(
      "files",
      new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])], "poster.png", { type: "image/png" }),
    );

    const { status, payload } = await api("/api/events", {
      method: "POST",
      cookie: moderatorCookie,
      body: formData,
    });

    expect(status).toBe(201);
    const parsed = eventSchema.parse(payload);
    expect(parsed.attachments).toHaveLength(1);
  });
});
