const BASE_URL = (process.env.MOCK_DB_BASE_URL ?? process.env.WORKER_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const HEALTH_ENDPOINT = `${BASE_URL}/api/health`;
const RESEED_ENDPOINT = `${BASE_URL}/api/dev/reseed`;

const RETRY_COUNT = 60;
const RETRY_DELAY_MS = 1000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWorker() {
  let lastError = null;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(HEALTH_ENDPOINT);
      if (response.ok) {
        return;
      }
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(RETRY_DELAY_MS);
  }

  throw new Error(`worker did not become ready at ${HEALTH_ENDPOINT}: ${String(lastError)}`);
}

async function reseed() {
  const response = await fetch(RESEED_ENDPOINT, { method: "POST" });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`reseed failed with ${response.status}${body ? `: ${body}` : ""}`);
  }

  return response.json().catch(() => ({ ok: true }));
}

async function main() {
  console.log(`[db:mock:seed] waiting for worker at ${BASE_URL}`);
  await waitForWorker();

  console.log("[db:mock:seed] reseeding local D1 database");
  await reseed();

  console.log("[db:mock:seed] comprehensive local mock database is ready");
  console.log("[db:mock:seed] accounts: admin/admin123, mod_1/moderator123, member_01/member1234");
}

main().catch((error) => {
  console.error(`[db:mock:seed] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
