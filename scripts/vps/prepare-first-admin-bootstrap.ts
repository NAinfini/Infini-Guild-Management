import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPasswordHash, requireSafePasswordIterations } from "@guild/server/modules/auth";
import { buildFirstAdminBootstrapBundle } from "./first-admin-bootstrap";

const options = parseArguments(process.argv.slice(2));
const iterations = requireSafePasswordIterations(Number(process.env.IG_PBKDF2_ITERATIONS ?? 10_000));
const password = process.env.IG_BOOTSTRAP_PASSWORD;

if (options.mode === "create" && !password) {
  throw new Error("IG_BOOTSTRAP_PASSWORD is required in create mode");
}
if (options.mode === "promote" && password) {
  throw new Error("IG_BOOTSTRAP_PASSWORD must be unset in promote mode");
}

const bundle = buildFirstAdminBootstrapBundle(options.mode === "create"
  ? {
      mode: "create",
      userId: options.userId,
      loginName: options.loginName!,
      displayName: options.displayName!,
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
  loginName?: string;
  displayName?: string;
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
  const allowed = new Set(["--mode", "--user-id", "--login-name", "--display-name", "--output"]);
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`Unknown argument: ${key}`);
  const mode = values.get("--mode");
  if (mode !== "create" && mode !== "promote") throw new Error("--mode must be create or promote");
  const userId = values.get("--user-id");
  const output = values.get("--output");
  const loginName = values.get("--login-name");
  const displayName = values.get("--display-name");
  if (!userId || !output) throw new Error("--user-id and --output are required");
  if (mode === "create" && (!loginName || !displayName)) {
    throw new Error("--login-name and --display-name are required in create mode");
  }
  if (mode === "promote" && (loginName || displayName)) {
    throw new Error("--login-name and --display-name are not accepted in promote mode");
  }
  return { mode, userId, loginName, displayName, output };
}
