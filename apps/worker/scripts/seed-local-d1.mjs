const workerUrl = process.env.WORKER_URL ?? "http://127.0.0.1:8787";
const portalOrigin = process.env.PORTAL_ORIGIN ?? "http://localhost:5173";
const healthUrl = `${workerUrl}/api/health`;
const reseedUrl = `${workerUrl}/api/dev/reseed`;

const startupTimeoutMs = Number(process.env.SEED_STARTUP_TIMEOUT_MS ?? 60_000);
const requestTimeoutMs = Number(process.env.SEED_REQUEST_TIMEOUT_MS ?? 30_000);
const retryIntervalMs = Number(process.env.SEED_RETRY_INTERVAL_MS ?? 500);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${requestTimeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function withOperationTimeout(label, operation) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${requestTimeoutMs}ms`));
    }, requestTimeoutMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForWorker() {
  const startedAt = Date.now();
  let lastError = null;

  console.log(`[db:mock:seed] waiting for worker at ${workerUrl}`);

  while (Date.now() - startedAt < startupTimeoutMs) {
    try {
      const response = await fetchWithTimeout(healthUrl);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(retryIntervalMs);
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Worker did not become healthy within ${startupTimeoutMs}ms.${suffix}`);
}

async function reseed() {
  await waitForWorker();

  console.log("[db:mock:seed] reseeding local D1 database");
  const text = await withOperationTimeout("Local D1 reseed", async () => {
    const response = await fetchWithTimeout(reseedUrl, {
      method: "POST",
      headers: {
        Origin: portalOrigin,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`Reseed failed with ${response.status}: ${body}`);
    }

    return body;
  });

  console.log(text || "[db:mock:seed] reseed completed");
}

reseed().catch((error) => {
  console.error(`[db:mock:seed] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
