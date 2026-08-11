import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPasswordHash, requireSafePasswordIterations } from "@guild/server/modules/auth";
import { buildSiteOwnerBootstrapBundle } from "./site-owner-bootstrap";

const options = parseArguments(process.argv.slice(2));
const iterations = requireSafePasswordIterations(Number(process.env.IG_PBKDF2_ITERATIONS ?? 10_000));
const password = process.env.IG_BOOTSTRAP_PASSWORD;

if (options.mode === "create" && !password) {
  throw new Error("IG_BOOTSTRAP_PASSWORD is required in create mode");
}
if (options.mode === "promote" && password) {
  throw new Error("IG_BOOTSTRAP_PASSWORD must be unset in promote mode");
}

const bundle = buildSiteOwnerBootstrapBundle(options.mode === "create"
  ? {
      mode: "create",
      userId: options.userId,
      username: options.username!,
      passwordHash: await createPasswordHash(password!, iterations),
    }
  : { mode: "promote", userId: options.userId });
const outputPath = resolve(options.output);
await writeFile(outputPath, bundle.sql, { encoding: "utf8", flag: "wx", mode: 0o600 });
await chmod(outputPath, 0o600);

// Never print the generated SQL, password, or password hash.
console.log(`Prepared private ${bundle.mode} bootstrap migration for ${bundle.userId}: ${outputPath}`);

type Options = Readonly<{
  mode: "create" | "promote";
  userId: string;
  username?: string;
  output: string;
}>;

function parseArguments(args: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Arguments must be provided as --name value pairs");
    if (values.has(key)) throw new Error(`Duplicate argument: ${key}`);
    values.set(key, value);
  }
  const allowed = new Set(["--mode", "--user-id", "--username", "--output"]);
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`Unknown argument: ${key}`);
  const mode = values.get("--mode");
  if (mode !== "create" && mode !== "promote") throw new Error("--mode must be create or promote");
  const userId = values.get("--user-id");
  const output = values.get("--output");
  const username = values.get("--username");
  if (!userId || !output) throw new Error("--user-id and --output are required");
  if (mode === "create" && !username) throw new Error("--username is required in create mode");
  if (mode === "promote" && username) throw new Error("--username is not accepted in promote mode");
  return { mode, userId, username, output };
}
