import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildLegacyCredentialImportBundle } from "./credential-import.js";

export async function prepareCredentialImport(argumentsList: readonly string[]): Promise<Readonly<{
  outputPath: string;
  rowCount: number;
}>> {
  const inputPath = option(argumentsList, "--input");
  const outputPath = option(argumentsList, "--output");
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    throw new TypeError("Input and output paths must be different");
  }
  const parsed = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  const bundle = buildLegacyCredentialImportBundle(parsed);
  await writeFile(outputPath, bundle.sql, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return Object.freeze({ outputPath: path.resolve(outputPath), rowCount: bundle.rowCount });
}

function option(argumentsList: readonly string[], name: string): string {
  const index = argumentsList.indexOf(name);
  const value = index >= 0 ? argumentsList[index + 1]?.trim() : undefined;
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}

if (import.meta.main) {
  prepareCredentialImport(process.argv.slice(2)).then(({ outputPath, rowCount }) => {
    console.info(`Prepared ${rowCount} credential row(s) at ${outputPath}`);
    console.info("Apply this private file only through the transactional migration command for the selected backend.");
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Credential import preparation failed");
    process.exitCode = 1;
  });
}
