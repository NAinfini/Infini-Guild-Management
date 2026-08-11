import { describe, expect, it } from "vitest";
import { findBoundaryViolations } from "./check-boundaries.mjs";

describe("package boundary guard", () => {
  it("rejects cross-package src imports while allowing public and same-package imports", () => {
    const sources = new Map([
      ["packages/application/src/bad.ts", 'import "../../persistence-sqlite/src/private.js";'],
      ["scripts/ops.ts", ["import", '"../apps/vps/src/adapters/private.js";'].join(" ")],
      ["packages/persistence-sqlite/scripts/local.ts", 'import "../src/public.js";'],
      ["packages/application/src/good.ts", 'import { x } from "@guild/persistence-sqlite";'],
    ]);

    expect(findBoundaryViolations([...sources.keys()], (file) => sources.get(file) ?? "", () => true))
      .toEqual([
        "packages/application/src/bad.ts: crosses into packages/persistence-sqlite/src/private.js",
        "scripts/ops.ts: crosses into apps/vps/src/adapters/private.js",
      ]);
  });

  it("checks tests while ignoring resource strings and same-package relatives", () => {
    const sources = new Map([
      ["packages/application/src/example.test.ts", ["import", '"../../persistence-sqlite/src/private.js";'].join(" ")],
      ["packages/application/src/read-resource.test.ts", 'const schemaPath = "../../persistence-sqlite/src/schema.sql";'],
      ["packages/application/src/helpers/example.spec.ts", 'import "../shared.js";'],
      ["apps/cloudflare/src/index.ts", ["import", '"@guild/server/src/private.js";'].join(" ")],
    ]);
    expect(findBoundaryViolations([...sources.keys()], (file) => sources.get(file) ?? "", () => true))
      .toEqual([
        "packages/application/src/example.test.ts: crosses into packages/persistence-sqlite/src/private.js",
        "apps/cloudflare/src/index.ts: imports private package src @guild/server/src/private.js",
      ]);
  });

  it("requires cross-domain server imports to use a public entry point", () => {
    const sources = new Map([
      ["packages/server/src/modules/auth/bad-relative.ts", 'import "../audit/audit.js";'],
      ["packages/server/src/modules/auth/bad-package.ts", 'import "@guild/server/modules/audit/audit";'],
      ["packages/server/src/modules/auth/bad-extensionless.ts", 'import "../audit/public";'],
      ["packages/server/src/modules/auth/good-relative-js.ts", 'import "../audit/public.js";'],
      ["packages/server/src/modules/auth/good-relative-ts.ts", 'import "../audit/public.ts";'],
      ["packages/server/src/modules/auth/good-package.ts", 'import "@guild/server/modules/audit";'],
      ["packages/server/src/modules/auth/good-same-domain.ts", 'import "./auth-types.js";'],
      ["packages/server/src/modules/auth/good-resource.ts", 'import "../events/fixture.sql";'],
    ]);

    expect(findBoundaryViolations([...sources.keys()], (file) => sources.get(file) ?? "", () => true))
      .toEqual([
        "packages/server/src/modules/auth/bad-relative.ts: crosses server module boundary into packages/server/src/modules/audit/audit.js",
        "packages/server/src/modules/auth/bad-package.ts: imports private server module path @guild/server/modules/audit/audit",
        "packages/server/src/modules/auth/bad-extensionless.ts: crosses server module boundary into packages/server/src/modules/audit/public",
      ]);
  });
});
