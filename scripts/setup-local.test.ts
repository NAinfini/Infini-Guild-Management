import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setupLocal } from "./setup-local.mjs";

const temporaryDirectories: string[] = [];

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "infini-setup-"));
  temporaryDirectories.push(root);
  const workerDirectory = join(root, "apps", "worker");
  await mkdir(workerDirectory, { recursive: true });
  await writeFile(join(workerDirectory, "wrangler.example.jsonc"), "{\"name\":\"example\"}\n");
  await writeFile(
    join(workerDirectory, ".dev.vars.example"),
    "SIGNING_SECRET=replace-with-a-random-secret\n",
  );
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("local setup", () => {
  it("creates ignored local configuration without printing or retaining the placeholder", async () => {
    const root = await createFixture();
    const result = await setupLocal(root, "test-generated-secret");

    expect(result.created).toEqual([
      "apps/worker/wrangler.jsonc",
      "apps/worker/.dev.vars",
    ]);
    expect(await readFile(join(root, "apps", "worker", ".dev.vars"), "utf8"))
      .toBe("SIGNING_SECRET=test-generated-secret\n");
  });

  it("does not overwrite existing local configuration", async () => {
    const root = await createFixture();
    const workerDirectory = join(root, "apps", "worker");
    await writeFile(join(workerDirectory, "wrangler.jsonc"), "existing config");
    await writeFile(join(workerDirectory, ".dev.vars"), "existing secret");

    const result = await setupLocal(root, "new-secret");

    expect(result.kept).toEqual([
      "apps/worker/wrangler.jsonc",
      "apps/worker/.dev.vars",
    ]);
    expect(await readFile(join(workerDirectory, ".dev.vars"), "utf8")).toBe("existing secret");
  });
});
