import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = realpathSync.native(resolve(scriptDirectory, ".."));
const vitestCli = resolve(repoRoot, "node_modules", "vitest", "vitest.mjs");
const args = [...process.argv.slice(2), "--root", repoRoot];

const child = spawn(process.execPath, [vitestCli, ...args], {
  cwd: repoRoot,
  stdio: "inherit",
  windowsHide: true,
});

child.once("error", (error) => {
  console.error(`Unable to start Vitest: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
