import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSetupArguments, setupLocal } from "./setup-local.mjs";

const temporaryDirectories: string[] = [];
async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "infini-setup-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "apps", "cloudflare"), { recursive: true });
  await mkdir(join(root, "apps", "vps"), { recursive: true });
  await mkdir(join(root, "scripts", "templates"), { recursive: true });
  await writeFile(
    join(root, "apps", "cloudflare", "wrangler.example.jsonc"),
    '{"vars":{"IG_PUBLIC_URL":"https://replace-with-public-origin.example","IG_ALLOWED_ORIGINS":"https://replace-with-allowed-origin.example"}}\n',
  );
  await writeFile(
    join(root, "apps", "cloudflare", ".dev.vars.example"),
    "# optional local variables\n",
  );
  await writeFile(
    join(root, "scripts", "templates", "vps.env.example"),
    "IG_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173\n",
  );
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("local setup", () => {
  it("requires one explicit runtime", () => {
    expect(parseSetupArguments(["--runtime", "cloudflare"])).toBe("cloudflare");
    expect(parseSetupArguments(["--runtime", "vps"])).toBe("vps");
    expect(() => parseSetupArguments([])).toThrow(/--runtime/);
    expect(() => parseSetupArguments(["--runtime", "worker"])).toThrow(/cloudflare|vps/);
  });

  it("creates Cloudflare config and its optional local variables file", async () => {
    const root = await createFixture();
    const result = await setupLocal({ root, runtime: "cloudflare" });

    expect(result.created).toEqual([
      "apps/cloudflare/wrangler.jsonc",
      "apps/cloudflare/.dev.vars",
    ]);
    const config = await readFile(join(root, "apps", "cloudflare", "wrangler.jsonc"), "utf8");
    expect(config).toContain('"IG_PUBLIC_URL":"http://localhost:5173"');
    expect(config).toContain('"IG_ALLOWED_ORIGINS":"http://localhost:5173"');
    const variables = await readFile(join(root, "apps", "cloudflare", ".dev.vars"), "utf8");
    expect(variables).toBe("# optional local variables\n");
  });

  it("creates a VPS env file from the VPS template", async () => {
    const root = await createFixture();
    const result = await setupLocal({ root, runtime: "vps" });

    expect(result.created).toEqual(["apps/vps/.env"]);
    const variables = await readFile(join(root, "apps", "vps", ".env"), "utf8");
    expect(variables).toContain("IG_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173");
  });

  it("does not overwrite existing runtime configuration", async () => {
    const root = await createFixture();
    await writeFile(join(root, "apps", "vps", ".env"), "existing config");

    const result = await setupLocal({ root, runtime: "vps" });

    expect(result.kept).toEqual(["apps/vps/.env"]);
    expect(await readFile(join(root, "apps", "vps", ".env"), "utf8")).toBe("existing config");
  });
});
