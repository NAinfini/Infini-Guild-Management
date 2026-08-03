import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

if (args.length !== 1 || !/^(?:0|[1-9]\d*)$/.test(args[0])) {
  throw new Error("Usage: node scripts/reset-e2e-slot-state.mjs <nonnegative-integer-slot>");
}

const slot = args[0];
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const expectedParent = path.resolve(repoRoot, "apps", "worker", ".wrangler");
const expectedName = `e2e-${slot}`;
const target = path.resolve(expectedParent, expectedName);

if (path.dirname(target) !== expectedParent || path.basename(target) !== expectedName) {
  throw new Error(`Refusing to remove unexpected path: ${target}`);
}

await rm(target, { recursive: true, force: true });
