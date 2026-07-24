import { execFile } from "node:child_process";
import { randomBytes, randomUUID, webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { validateWorkerConfig, parseJsonc } from "./check-worker-config.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const usernamePattern = /^[a-zA-Z0-9_一-鿿]+$/;

function escapeSql(value) {
  return value.replaceAll("'", "''");
}

function encodeBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

export async function createPasswordHash(password, salt = randomBytes(16)) {
  const keyMaterial = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 10_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  return {
    passwordHash: encodeBase64(new Uint8Array(bits)),
    salt: encodeBase64(salt),
  };
}

export function buildAdminSql({ userId, profileId, username, passwordHash, salt }) {
  const values = {
    userId: escapeSql(userId),
    profileId: escapeSql(profileId),
    username: escapeSql(username),
    passwordHash: escapeSql(passwordHash),
    salt: escapeSql(salt),
  };

  return `BEGIN TRANSACTION;
INSERT INTO users (id, username, role, is_active)
SELECT '${values.userId}', '${values.username}', 'admin', 1
WHERE NOT EXISTS (SELECT 1 FROM users);
INSERT INTO user_auth_password (user_id, password_hash, salt)
SELECT '${values.userId}', '${values.passwordHash}', '${values.salt}'
WHERE EXISTS (SELECT 1 FROM users WHERE id = '${values.userId}');
INSERT INTO member_profiles (id, user_id, power, classes, images, video_urls)
SELECT '${values.profileId}', '${values.userId}', 0, '[]', '[]', '[]'
WHERE EXISTS (SELECT 1 FROM users WHERE id = '${values.userId}');
COMMIT;
`;
}

export function findCount(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const count = findCount(item);
      if (count !== null) return count;
    }
    return null;
  }

  if (value !== null && typeof value === "object") {
    if ("count" in value && Number.isInteger(Number(value.count))) {
      return Number(value.count);
    }
    for (const item of Object.values(value)) {
      const count = findCount(item);
      if (count !== null) return count;
    }
  }

  return null;
}

function parseArguments(argv) {
  const envArgument = argv.find((argument) => argument.startsWith("--env="));
  const usernameArgument = argv.find((argument) => argument.startsWith("--username="));
  const configArgument = argv.find((argument) => argument.startsWith("--config="));
  return {
    environment: envArgument?.slice("--env=".length) ?? "",
    username: usernameArgument?.slice("--username=".length) ?? "",
    configPath: resolve(repositoryRoot, configArgument?.slice("--config=".length) ?? "apps/worker/wrangler.jsonc"),
  };
}

function validateUsername(username) {
  if (username.length < 1 || username.length > 50 || !usernamePattern.test(username)) {
    throw new Error("Username must be 1-50 characters and contain only letters, numbers, underscores, or Chinese characters.");
  }
}

function validatePassword(password) {
  if (password.length < 12 || password.length > 128) {
    throw new Error("The first administrator password must be 12-128 characters.");
  }
}

async function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("An interactive terminal is required so the password can be entered without echoing it.");
  }

  process.stdout.write(prompt);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolvePromise, rejectPromise) => {
    let value = "";

    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };

    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          rejectPromise(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolvePromise(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    };

    process.stdin.on("data", onData);
  });
}

async function runWrangler(argumentsList) {
  const wranglerEntry = resolve(repositoryRoot, "node_modules/wrangler/bin/wrangler.js");
  return execFileAsync(process.execPath, [wranglerEntry, ...argumentsList], {
    cwd: repositoryRoot,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
}

async function queryCount(environment, configPath, command) {
  const { stdout } = await runWrangler([
    "d1",
    "execute",
    "DB",
    "--remote",
    "--env",
    environment,
    "--config",
    configPath,
    "--command",
    command,
    "--json",
  ]);
  const count = findCount(JSON.parse(stdout));
  if (count === null) throw new Error("Could not read the user count returned by Wrangler.");
  return count;
}

async function assertConfigReady(environment, configPath) {
  const config = parseJsonc(await readFile(configPath, "utf8"));
  const errors = validateWorkerConfig(config, environment);
  if (errors.length > 0) {
    throw new Error(`Worker configuration is not ready:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
}

export async function runCreateAdmin(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (!["production", "staging"].includes(options.environment)) {
    throw new Error("Use --env=production or --env=staging. This command never writes to an unspecified database.");
  }

  await assertConfigReady(options.environment, options.configPath);

  const existingUserCount = await queryCount(
    options.environment,
    options.configPath,
    "SELECT COUNT(*) AS count FROM users;",
  );
  if (existingUserCount !== 0) {
    throw new Error(
      `Refusing to create a bootstrap administrator because the ${options.environment} database already has ${existingUserCount} user(s).`,
    );
  }

  let username = options.username.trim();
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!username) username = (await input.question("Administrator username: ")).trim();
  } finally {
    input.close();
  }
  validateUsername(username);

  const password = await readHidden("Administrator password (12-128 characters): ");
  validatePassword(password);
  const confirmation = await readHidden("Confirm administrator password: ");
  if (password !== confirmation) throw new Error("Passwords do not match.");

  const { passwordHash, salt } = await createPasswordHash(password);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "infini-admin-"));
  const sqlPath = join(temporaryDirectory, "create-admin.sql");
  const userId = randomUUID();

  try {
    await writeFile(sqlPath, buildAdminSql({
      userId,
      profileId: randomUUID(),
      username,
      passwordHash,
      salt,
    }), { encoding: "utf8", mode: 0o600 });

    await runWrangler([
      "d1",
      "execute",
      "DB",
      "--remote",
      "--env",
      options.environment,
      "--config",
      options.configPath,
      "--file",
      sqlPath,
    ]);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const createdAdminCount = await queryCount(
    options.environment,
    options.configPath,
    `SELECT COUNT(*) AS count FROM users WHERE id = '${escapeSql(userId)}' AND role = 'admin';`,
  );
  if (createdAdminCount !== 1) {
    throw new Error("Administrator creation could not be verified. No matching administrator row was found.");
  }

  return { environment: options.environment, username };
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  try {
    const result = await runCreateAdmin();
    console.log(`[setup] Created administrator "${result.username}" in ${result.environment}.`);
  } catch (error) {
    console.error(`[setup] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
