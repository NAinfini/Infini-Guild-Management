const PORTAL_BASE = "http://localhost:5173";
const WORKER_BASE = "http://127.0.0.1:8787";

const RETRY_COUNT = 60;
const RETRY_DELAY_MS = 1000;

const PAGE_ROUTES = ["/dashboard", "/guild-war", "/events", "/roster", "/gallery"];

const PAGE_API_CHECKS = [
  { page: "Dashboard", path: "/api/users" },
  { page: "Dashboard", path: "/api/events?limit=5" },
  { page: "Dashboard", path: "/api/guild-war/active" },
  { page: "GuildWar", path: "/api/guild-war/history?limit=5" },
  { page: "GuildWar", path: "/api/guild-war/analytics" },
  { page: "GuildWar", path: "/api/guild-war/templates" },
  { page: "Events", path: "/api/events" },
  { page: "Roster", path: "/api/users?limit=20" },
  { page: "Gallery", path: "/api/gallery" },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, init, label) {
  let lastError = null;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`${label} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(RETRY_DELAY_MS);
  }

  throw new Error(`${label} did not become ready: ${String(lastError)}`);
}

async function waitForServices() {
  await fetchWithRetry(`${WORKER_BASE}/api/health`, undefined, "worker health");
  await fetchWithRetry(`${PORTAL_BASE}/`, undefined, "portal root");
}

async function seedDatabase() {
  const response = await fetch(`${WORKER_BASE}/api/dev/reseed`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`seed failed with ${response.status}`);
  }
}

async function loginAdmin() {
  const response = await fetch(`${WORKER_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: "admin123",
      stay_logged_in: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`login failed with ${response.status}`);
  }

  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("missing set-cookie from login response");
  }

  return setCookie.split(";")[0];
}

async function checkPageRoutes() {
  for (const route of PAGE_ROUTES) {
    const response = await fetch(`${PORTAL_BASE}${route}`);
    if (!response.ok) {
      throw new Error(`page route ${route} returned ${response.status}`);
    }
    const html = await response.text();
    if (!html.includes("<div id=\"root\">")) {
      throw new Error(`page route ${route} missing root container`);
    }
  }
}

async function checkPageApis(cookie) {
  for (const { page, path } of PAGE_API_CHECKS) {
    const response = await fetch(`${WORKER_BASE}${path}`, {
      headers: {
        Cookie: cookie,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${page} API ${path} returned ${response.status}: ${body}`);
    }
  }
}

async function main() {
  await waitForServices();
  await seedDatabase();
  const cookie = await loginAdmin();
  await checkPageRoutes();
  await checkPageApis(cookie);
  console.log("Smoke check passed for key pages: Dashboard, GuildWar, Events, Roster, Gallery");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
