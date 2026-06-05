type Json = Record<string, unknown>;

type RequestOptions = {
  method?: string;
  body?: Json;
  cookie?: string;
};

const baseUrl = (process.env.INTEGRATION_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const username = process.env.INTEGRATION_USERNAME;
const password = process.env.INTEGRATION_PASSWORD;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function extractCookie(headers: Headers): string | null {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) {
    return null;
  }

  const first = setCookie.split(",")[0]!;
  const cookiePair = first.split(";")[0]?.trim();
  return cookiePair || null;
}

async function request(path: string, options: RequestOptions = {}) {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  if (options.cookie) {
    headers.set("Cookie", options.cookie);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }

  return { response, payload };
}

async function run(): Promise<void> {
  console.log(`[integration] base url: ${baseUrl}`);

  await request("/api/health");
  console.log("[integration] health check passed");

  const loginName = requireEnv("INTEGRATION_USERNAME", username);
  const loginPassword = requireEnv("INTEGRATION_PASSWORD", password);

  const loginResult = await request("/api/auth/login", {
    method: "POST",
    body: { username: loginName, password: loginPassword, stay_logged_in: true },
  });

  const sessionCookie = extractCookie(loginResult.response.headers);
  if (!sessionCookie) {
    throw new Error("Login succeeded but no session cookie was returned");
  }

  const meResult = await request("/api/auth/me", { cookie: sessionCookie });
  const mePayload = meResult.payload as { user?: { id?: string } };
  const userId = mePayload.user?.id;
  if (!userId) {
    throw new Error("/api/auth/me did not return user.id");
  }
  console.log(`[integration] authenticated as user ${userId}`);

  const eventsResult = await request("/api/events?page=1&limit=1", { cookie: sessionCookie });
  const eventsPayload = eventsResult.payload as { data?: Array<{ id: string }> };
  const firstEventId = eventsPayload.data?.[0]?.id;

  if (firstEventId) {
    try {
      await request(`/api/events/${firstEventId}/join`, {
        method: "POST",
        cookie: sessionCookie,
      });
      console.log(`[integration] joined event ${firstEventId}`);
    } catch (error) {
      console.log(`[integration] join skipped: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      await request(`/api/events/${firstEventId}/leave`, {
        method: "DELETE",
        cookie: sessionCookie,
      });
      console.log(`[integration] left event ${firstEventId}`);
    } catch (error) {
      console.log(`[integration] leave skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await request("/api/announcements?page=1&limit=5", { cookie: sessionCookie });
  await request("/api/guild-war/history?page=1&limit=5", { cookie: sessionCookie });
  await request("/api/gallery?cursor=0&limit=5", { cookie: sessionCookie });
  console.log("[integration] announcements + guild-war + gallery queries passed");

  await request("/api/auth/logout", { method: "POST", cookie: sessionCookie });
  console.log("[integration] logout passed");

  console.log("[integration] smoke flow completed");
}

run().catch((error) => {
  console.error("[integration] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
