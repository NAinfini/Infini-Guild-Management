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

  it("enforces the one-way package dependency matrix on alias imports", () => {
    const sources = new Map([
      ["apps/portal/api/bad-kernel.ts", ["import { AppError } from", '"@guild/kernel";'].join(" ")],
      ["packages/kernel/src/good-shared.ts", ["import { ERROR_STATUS } from", '"@guild/shared/constants/errors";'].join(" ")],
      ["packages/kernel/src/bad-server.ts", ["import { x } from", '"@guild/server";'].join(" ")],
      ["packages/server/src/bad-transport.ts", ["import { y } from", '"@guild/transport-http";'].join(" ")],
      ["apps/shared/utils/bad-unregistered.ts", ["import { z } from", '"@guild/worker";'].join(" ")],
      ["apps/vps/src/good-application.ts", ["import { createPortalApiApp } from", '"@guild/application";'].join(" ")],
      ["apps/portal/components/good-self.ts", ["import { api } from", '"@portal/api/client";'].join(" ")],
    ]);

    expect(findBoundaryViolations([...sources.keys()], (file) => sources.get(file) ?? "", () => true))
      .toEqual([
        "apps/portal/api/bad-kernel.ts: imports @guild/kernel outside the allowed package dependency matrix",
        "packages/kernel/src/bad-server.ts: imports @guild/server outside the allowed package dependency matrix",
        "packages/server/src/bad-transport.ts: imports @guild/transport-http outside the allowed package dependency matrix",
        "apps/shared/utils/bad-unregistered.ts: imports unregistered package alias @guild/worker",
      ]);
  });

  it("limits runtime-parity vps imports to cloudflare test files", () => {
    const sources = new Map([
      ["apps/cloudflare/src/runtime/parity.test.ts", ["import { Hub } from", '"@guild/vps/testing/notification-runtime";'].join(" ")],
      ["apps/cloudflare/src/runtime/bad-runtime.ts", ["import { Hub } from", '"@guild/vps/testing/notification-runtime";'].join(" ")],
    ]);

    expect(findBoundaryViolations([...sources.keys()], (file) => sources.get(file) ?? "", () => true))
      .toEqual([
        "apps/cloudflare/src/runtime/bad-runtime.ts: imports @guild/vps/testing/notification-runtime outside the allowed package dependency matrix",
      ]);
  });

  it("flags relative crossings into src-less packages and scopes the tooling exceptions", () => {
    const sources = new Map([
      ["apps/portal/utils/bad-relative-shared.ts", ["import { toEmbedVideoUrl } from", '"../../shared/utils/video";'].join(" ")],
      ["apps/portal/vite.config.ts", ["import { DEFAULT_SITE_DESCRIPTION } from", '"../shared/config/site-branding.js";'].join(" ")],
      ["apps/portal/components/fixture-strings.test.ts", ["import", '"../../api/client";'].join(" ")],
      ["packages/persistence-sqlite/src/stores/good-test-tooling.test.ts", ["import", '"../../../../scripts/testing/application-migrations.js";'].join(" ")],
      ["apps/cloudflare/scripts/good-dev-tooling.ts", ["import", '"../../../scripts/dev/media-fixtures.mjs";'].join(" ")],
      ["packages/server/src/bad-prod-tooling.ts", ["import", '"../../../scripts/testing/application-migrations.js";'].join(" ")],
    ]);

    expect(findBoundaryViolations([...sources.keys()], (file) => sources.get(file) ?? "", () => true))
      .toEqual([
        "apps/portal/utils/bad-relative-shared.ts: crosses into apps/shared/utils/video",
        "packages/server/src/bad-prod-tooling.ts: crosses into scripts/testing/application-migrations.js",
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
