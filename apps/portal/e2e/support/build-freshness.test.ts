import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertE2eBuildFresh, type E2eBuildFreshnessPaths } from "./build-freshness";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<{ paths: E2eBuildFreshnessPaths; portalSource: string; workerSource: string }> {
  const root = await mkdtemp(join(tmpdir(), "infini-e2e-build-freshness-"));
  temporaryDirectories.push(root);
  const portalDistDir = join(root, "portal-dist");
  const portalSource = join(root, "portal-source");
  const workerSource = join(root, "worker-source");
  const workerBundlePath = join(root, "worker-dist", "worker.mjs");
  await Promise.all([
    mkdir(portalDistDir, { recursive: true }),
    mkdir(portalSource, { recursive: true }),
    mkdir(workerSource, { recursive: true }),
    mkdir(join(root, "worker-dist"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(portalDistDir, "index.html"), "portal"),
    writeFile(join(portalSource, "entry.ts"), "portal source"),
    writeFile(join(workerSource, "entry.ts"), "worker source"),
    writeFile(workerBundlePath, "worker"),
  ]);
  const earlier = new Date("2026-08-30T10:00:00.000Z");
  const later = new Date("2026-08-30T11:00:00.000Z");
  await Promise.all([
    utimes(join(portalDistDir, "index.html"), later, later),
    utimes(join(portalSource, "entry.ts"), earlier, earlier),
    utimes(join(workerSource, "entry.ts"), earlier, earlier),
    utimes(workerBundlePath, later, later),
  ]);
  return {
    paths: {
      portalDistDir,
      portalSourceDirs: [portalSource],
      workerBundlePath,
      workerSourceDirs: [workerSource],
    },
    portalSource,
    workerSource,
  };
}

describe("E2E build freshness", () => {
  it("accepts current Portal and Worker artifacts", async () => {
    const { paths } = await fixture();
    await expect(assertE2eBuildFresh(paths)).resolves.toBeUndefined();
  });

  it("rejects a missing deployable Worker bundle", async () => {
    const { paths } = await fixture();
    await rm(paths.workerBundlePath);
    await expect(assertE2eBuildFresh(paths)).rejects.toThrow("worker.mjs 不存在");
  });

  it("rejects a Worker bundle older than its source", async () => {
    const { paths, workerSource } = await fixture();
    const newest = new Date("2026-08-30T12:00:00.000Z");
    await utimes(join(workerSource, "entry.ts"), newest, newest);
    await expect(assertE2eBuildFresh(paths)).rejects.toThrow("worker.mjs 比源码旧");
  });
});
