import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPhase1Migration, buildPhase2Migration, buildR2CopyManifest, type MigrationBundle } from "./migration.js";
import { buildTargetInitPlan, type TargetMigrationSource } from "./preflight.js";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const flags = parseFlags(args);
  const output = privateOutput(requiredOne(flags, "out"));
  if (command === "init-plan") {
    const sources = await readTargetMigrations(requiredOne(flags, "core"));
    const plan = buildTargetInitPlan(sources);
    await mkdir(output, { recursive: true });
    await writeJson(join(output, "target-init-plan.json"), plan);
    process.stdout.write(`Target initialization plan written under ${output}; no remote command was executed.\n`);
    return;
  }
  const snapshot = JSON.parse(await readFile(requiredOne(flags, "snapshot"), "utf8")) as unknown;
  if (command === "r2-manifest") {
    const inventory = JSON.parse(await readFile(requiredOne(flags, "inventory"), "utf8")) as unknown;
    const manifest = buildR2CopyManifest(snapshot, inventory);
    await mkdir(dirname(output), { recursive: true });
    await writeJson(output, manifest);
    process.stdout.write(`R2 copy manifest written to ${output}: ${manifest.objects.length} bounded objects.\n`);
    return;
  }
  const options = { siteOwnerUserIds: requiredMany(flags, "site-owner-user-id") };
  const core = await readFile(requiredOne(flags, "core"), "utf8");
  if (command === "phase-1") {
    await writeBundle(output, buildPhase1Migration(snapshot, options, core));
    return;
  }
  if (command === "phase-2") {
    const manifestText = await readFile(requiredOne(flags, "manifest"), "utf8");
    const reconciliationText = await readFile(requiredOne(flags, "reconciliation"), "utf8");
    const reconciliation = JSON.parse(reconciliationText) as unknown;
    await writeBundle(output, buildPhase2Migration(snapshot, options, manifestText, reconciliation, core), {
      r2ManifestSha256: sha256(manifestText),
      reconciliationSha256: sha256(reconciliationText),
    });
    return;
  }
  throw new TypeError("Usage: prepare.ts init-plan|phase-1|r2-manifest|phase-2 with explicit --core/--snapshot/--inventory/--manifest/--reconciliation/--site-owner-user-id/--out flags");
}

async function readTargetMigrations(corePathInput: string): Promise<readonly TargetMigrationSource[]> {
  const corePath = resolve(corePathInput);
  const directory = dirname(corePath);
  const raw = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as unknown;
  if (!Array.isArray(raw) || raw.length === 0) throw new TypeError("Generated migration manifest must not be empty");
  const sources = await Promise.all(raw.map(async (candidate, ordinal) => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) throw new TypeError(`Migration manifest entry ${ordinal} is invalid`);
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.id !== "string" || entry.ordinal !== ordinal || entry.file !== `${entry.id}.sql` || typeof entry.checksum !== "string") throw new TypeError(`Migration manifest entry ${ordinal} is invalid`);
    const file = entry.file;
    if (basename(file) !== file) throw new TypeError(`Migration manifest entry ${ordinal} has an unsafe file`);
    return Object.freeze({
      id: entry.id,
      ordinal,
      file,
      checksum: entry.checksum,
      sql: await readFile(join(directory, file), "utf8"),
    });
  }));
  if (resolve(directory, sources[0]!.file) !== corePath) throw new TypeError("--core must name the first generated migration");
  return Object.freeze(sources);
}

async function writeBundle(
  output: string,
  bundle: MigrationBundle,
  inputs?: Readonly<{ r2ManifestSha256: string; reconciliationSha256: string }>,
): Promise<void> {
  await mkdir(output, { recursive: true });
  await writeJson(join(output, "report.json"), bundle.report);
  const checkpointDocument = { version: 1, phase: bundle.phase, sourceDigest: bundle.sourceDigest, checkpoints: bundle.checkpoints };
  const checkpointText = `${JSON.stringify(checkpointDocument, null, 2)}\n`;
  await writeText(join(output, "checkpoints.json"), checkpointText);
  await writeJson(join(output, "bundle-manifest.json"), {
    version: 1,
    phase: bundle.phase,
    sourceDigest: bundle.sourceDigest,
    checkpointsSha256: createHash("sha256").update(checkpointText).digest("hex"),
    ...(inputs ? { inputs } : {}),
  });
  await writeJson(join(output, "media-plan.json"), { version: 1, objects: bundle.mediaPlan });
  const preserved = bundle.preservedRecords.map(({ ndjson: _ndjson, ...entry }) => entry);
  await writeJson(join(output, "preserved-manifest.json"), { version: 1, objects: preserved });
  for (const record of bundle.preservedRecords) await writeText(join(output, "preserved", `${record.table}.ndjson`), record.ndjson);
  if (!bundle.ready) {
    process.stderr.write(`${bundle.phase} rejected with ${bundle.report.rejections.length} finding(s); report written to ${output}.\n`);
    process.exitCode = 1;
    return;
  }
  for (const batch of bundle.batches) await writeText(join(output, batch.fileName), batch.sql);
  process.stdout.write(`${bundle.phase} written to ${output}: ${bundle.statementCount} statements in ${bundle.batches.length} batch(es).\n`);
}

function parseFlags(args: readonly string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]; const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) throw new TypeError(`Invalid CLI flag near ${flag ?? "end"}`);
    const name = flag.slice(2); result.set(name, [...result.get(name) ?? [], value]);
  }
  return result;
}

function requiredOne(flags: Map<string, string[]>, name: string): string { const values = flags.get(name); if (values?.length !== 1) throw new TypeError(`Exactly one --${name} is required`); return values[0]!; }
function requiredMany(flags: Map<string, string[]>, name: string): string[] { const values = flags.get(name); if (!values || values.length === 0) throw new TypeError(`At least one --${name} is required`); return values; }

function privateOutput(path: string): string {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const output = resolve(path);
  const parts = relative(root, output).split(sep);
  if (parts[0] === ".." || !parts.includes("private-migrations")) throw new TypeError("Migration outputs must stay under the repository private-migrations directory");
  return output;
}

async function writeJson(path: string, value: unknown): Promise<void> { await writeText(path, `${JSON.stringify(value, null, 2)}\n`); }
async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, value, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
import { createHash } from "node:crypto";
