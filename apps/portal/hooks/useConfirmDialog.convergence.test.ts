// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const portalRoot = resolve(process.cwd(), "apps/portal");

function listSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = resolve(root, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry) && !/\.test\.(?:ts|tsx)$/.test(entry)
      ? [path]
      : [];
  });
}

describe("confirm dialog convergence", () => {
  it("routes every production confirmation through the Base UI queue", () => {
    const sourceFiles = listSourceFiles(portalRoot);
    const imperativeOffenders = sourceFiles
      .filter((path) => readFileSync(path, "utf8").includes("modals.openConfirmModal"))
      .map((path) => path.slice(portalRoot.length + 1).replaceAll("\\", "/"));
    const manualStateMarkers = [
      "archiveConfirmEvent",
      "deleteConfirmOpen",
      "pendingRemove",
      "pendingDeleteTeamId",
    ];
    const manualModalOffenders = sourceFiles
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return manualStateMarkers.some((marker) => source.includes(marker));
      })
      .map((path) => path.slice(portalRoot.length + 1).replaceAll("\\", "/"));

    expect(imperativeOffenders).toEqual([]);
    expect(manualModalOffenders).toEqual([]);
  });

  it("keeps the host on the shared Base UI primitive without a custom provider", () => {
    const host = readFileSync(
      resolve(portalRoot, "components/shared/ConfirmDialogHost.tsx"),
      "utf8",
    );

    expect(host).toContain('@portal/components/ui/alert-dialog');
    expect(host).toContain("useSyncExternalStore");
    expect(host).not.toContain("ConfirmDialogProvider");
  });
});
