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
  /*
   * The /api/* mutation guard requires an allowed Origin plus the XHR header.
   * Without them this POST came back 403 and, because the status was never
   * checked, the suite ran unseeded and still reported success.
   */
  const options = {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:8787",
      "X-Requested-With": "XMLHttpRequest",
    },
  };

  const req = http.request(SEED_ENDPOINT, options, (res) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        console.error(`Seeding failed: POST /api/dev/seed returned ${res.statusCode} ${body}`);
        process.exit(1);
      });
      return;
    }
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
