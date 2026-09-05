import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function buildVpsServer(outfile = path.join(root, "apps/vps/dist/server.mjs")) {
  return build({
    absWorkingDir: root,
    entryPoints: ["apps/vps/src/index.ts"],
    bundle: true,
    platform: "node",
    target: "node26",
    format: "esm",
    // ws owns CommonJS modules and optional native addons; Node must load that boundary.
    external: ["ws"],
    outfile,
  });
}

if (import.meta.main) await buildVpsServer(process.argv[2]);
