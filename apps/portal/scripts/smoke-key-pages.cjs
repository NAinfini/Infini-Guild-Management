const PORTAL_BASE = "http://localhost:5173";
const WORKER_BASE = "http://127.0.0.1:8787";

const RETRY_COUNT = 60;
const RETRY_DELAY_MS = 1000;

/*
 * Every /api/* mutation is behind an Origin + XHR-header guard, so a bare POST
 * from a script is rejected with 403 before it reaches the route.
 */
const MUTATION_HEADERS = {
  Origin: WORKER_BASE,
  "X-Requested-With": "XMLHttpRequest",
};

const PAGE_ROUTES = [
  "/",
  "/events",
  "/roster",
  "/announcements",
  "/guild-war",
  "/gallery",
  "/wiki",
  "/settings",
  "/tools",
  "/login",
  "/register/SEEDLIVE",
];

const STATIC_PAGE_API_CHECKS = [
  { page: "Dashboard", path: "/api/users?limit=20" },
  { page: "Dashboard", path: "/api/events?limit=5" },
  { page: "Dashboard", path: "/api/guild-war/active" },
  { page: "Roster", path: "/api/users?limit=20&external_view=true" },
  { page: "Announcements", path: "/api/announcements?page=1&limit=10" },
  { page: "Announcements", path: "/api/announcements?page=1&limit=10&status=archived" },
  { page: "GuildWar", path: "/api/guild-war/history?limit=5" },
  { page: "GuildWar", path: "/api/guild-war/analytics" },
  { page: "Gallery", path: "/api/gallery?limit=20" },
  { page: "Wiki", path: "/api/wiki/categories" },
  { page: "Wiki", path: "/api/wiki/articles?page=1&limit=10" },
  { page: "Admin", path: "/api/admin/invite-links?include_expired=true&include_revoked=true" },
  { page: "Admin", path: "/api/admin/invite-links/stats" },
  { page: "Admin", path: "/api/admin/audit-log?page=1&limit=20" },
  { page: "Admin", path: "/api/admin/roles" },
  { page: "Admin", path: "/api/admin/status" },
  { page: "Profile", path: "/api/auth/me" },
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
  const response = await fetch(`${WORKER_BASE}/api/dev/reseed`, { method: "POST", headers: MUTATION_HEADERS });
  if (!response.ok) {
    throw new Error(`seed failed with ${response.status}`);
  }
}

async function login(username, password) {
  const response = await fetch(`${WORKER_BASE}/api/auth/login`, {
    method: "POST",
    headers: { ...MUTATION_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
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

async function assertForbidden(path, cookie, label) {
  const response = await fetch(`${WORKER_BASE}${path}`, {
    headers: {
      Cookie: cookie,
    },
  });

  if (response.status !== 401 && response.status !== 403) {
    const body = await response.text().catch(() => "");
    throw new Error(`${label} expected 401/403 for ${path} but got ${response.status}: ${body}`);
  }
}

async function checkPageRoutes() {
  for (const route of PAGE_ROUTES) {
    const response = await fetch(`${PORTAL_BASE}${route}`);
    if (!response.ok) {
      throw new Error(`page route ${route} returned ${response.status}`);
    }
    const html = await response.text();
    if (!html.includes('<div id="root">')) {
      throw new Error(`page route ${route} missing root container`);
    }
  }
}

async function fetchWorkerJson(path, cookie) {
  const response = await fetch(`${WORKER_BASE}${path}`, {
    headers: {
      Cookie: cookie,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${path} returned ${response.status}: ${body}`);
  }

  return response.json();
}

function getFirstArrayItem(value) {
  return Array.isArray(value) && value.length > 0 ? value[0] : null;
}

async function resolveDetailTargets(cookie) {
  const [events, users, announcements, wikiArticles, warHistory] = await Promise.all([
    fetchWorkerJson("/api/events?limit=1", cookie),
    fetchWorkerJson("/api/users?limit=1", cookie),
    fetchWorkerJson("/api/announcements?page=1&limit=1", cookie),
    fetchWorkerJson("/api/wiki/articles?page=1&limit=1", cookie),
    fetchWorkerJson("/api/guild-war/history?limit=1", cookie),
  ]);

  const firstEvent = getFirstArrayItem(events.data);
  const firstUser = getFirstArrayItem(users.data);
  const firstAnnouncement = getFirstArrayItem(announcements.data);
  const firstWikiArticle = getFirstArrayItem(wikiArticles.data);
  const firstWarHistory = getFirstArrayItem(warHistory.data);

  if (!firstEvent?.id || !firstUser?.user?.id || !firstAnnouncement?.id || !firstWikiArticle?.slug || !firstWarHistory?.id) {
    throw new Error("seeded detail targets were incomplete");
  }

  return {
    eventId: firstEvent.id,
    userId: firstUser.user.id,
    announcementId: firstAnnouncement.id,
    wikiSlug: firstWikiArticle.slug,
    warHistoryId: firstWarHistory.id,
  };
}

async function checkPageApis(cookie) {
  for (const { page, path } of STATIC_PAGE_API_CHECKS) {
    await fetchWorkerJson(path, cookie).catch((error) => {
      throw new Error(`${page} API ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  const targets = await resolveDetailTargets(cookie);
  const detailChecks = [
    { page: "Events", path: `/api/events/${targets.eventId}` },
    { page: "Roster", path: `/api/users/${targets.userId}` },
    { page: "Announcements", path: `/api/announcements/${targets.announcementId}` },
    { page: "Wiki", path: `/api/wiki/articles/${targets.wikiSlug}` },
    { page: "GuildWar", path: `/api/guild-war/history/${targets.warHistoryId}` },
  ];

  for (const { page, path } of detailChecks) {
    await fetchWorkerJson(path, cookie).catch((error) => {
      throw new Error(`${page} detail API ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

async function checkMemberAdminAccessDenied(cookie) {
  const forbiddenChecks = [
    "/api/admin/status",
    "/api/admin/invite-links",
    "/api/admin/audit-log?page=1&limit=5",
    "/api/admin/roles",
  ];

  for (const path of forbiddenChecks) {
    await assertForbidden(path, cookie, "member admin access");
  }
}

async function main() {
  await waitForServices();
  await seedDatabase();
  const adminCookie = await login("admin", "admin123");
  const memberCookie = await login("member_01", "member1234");
  await checkPageRoutes();
  await checkPageApis(adminCookie);
  await checkMemberAdminAccessDenied(memberCookie);
  console.log("Smoke check passed for portal routes, seeded APIs, and member denial on admin APIs");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
