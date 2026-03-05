const http = require("http");
const { spawn } = require("child_process");

const MAX_RETRIES = 40;
const RETRY_MS = 1000;
const SEED_ENDPOINT = "http://127.0.0.1:8787/api/dev/seed";

function runVitest() {
  const child = spawn("pnpm", ["test"], {
    shell: true,
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

function seedAndRun(retries) {
  const req = http.request(SEED_ENDPOINT, { method: "POST" }, (res) => {
    res.resume();
    runVitest();
  });

  req.on("error", () => {
    if (retries >= MAX_RETRIES) {
      console.error("Worker did not become ready for /api/dev/seed");
      process.exit(1);
      return;
    }

    setTimeout(() => {
      seedAndRun(retries + 1);
    }, RETRY_MS);
  });

  req.end();
}

seedAndRun(0);
