import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPrivatePathPolicy,
  ensurePrivateDirectory,
  preparePrivateSqliteDatabase,
} from "./private-filesystem.js";

const POSIX_FILE_MODES = process.platform !== "win32";

function mode(target: string): number {
  return lstatSync(target).mode & 0o777;
}

describe("private VPS filesystem paths", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function fixture(): string {
    const root = mkdtempSync(path.join(tmpdir(), "guild-private-paths-"));
    roots.push(root);
    return root;
  }

  it("accepts only trusted owners and protected writable ancestors", () => {
    expect(() => assertPrivatePathPolicy({ uid: 0, mode: 0o755 }, false, 1_000)).not.toThrow();
    expect(() => assertPrivatePathPolicy({ uid: 1_000, mode: 0o700 }, true, 1_000)).not.toThrow();
    expect(() => assertPrivatePathPolicy({ uid: 0, mode: 0o1777 }, false, 1_000)).not.toThrow();
    expect(() => assertPrivatePathPolicy({ uid: 2_000, mode: 0o700 }, true, 1_000)).toThrow(/owned/i);
    expect(() => assertPrivatePathPolicy({ uid: 1_000, mode: 0o770 }, true, 1_000)).toThrow(/writable/i);
    expect(() => assertPrivatePathPolicy({ uid: 0, mode: 0o777 }, false, 1_000)).toThrow(/writable/i);
  });

  it.runIf(POSIX_FILE_MODES)("creates and tightens only exact SQLite data paths", () => {
    const root = fixture();
    const sharedParent = path.join(root, "shared");
    mkdirSync(sharedParent, { mode: 0o755 });
    chmodSync(sharedParent, 0o755);
    const databasePath = path.join(sharedParent, "data", "guild.sqlite");

    const database = preparePrivateSqliteDatabase(databasePath);
    writeFileSync(`${database}-wal`, "wal", { mode: 0o644 });
    writeFileSync(`${database}-shm`, "shm", { mode: 0o644 });
    chmodSync(`${database}-wal`, 0o644);
    chmodSync(`${database}-shm`, 0o644);
    preparePrivateSqliteDatabase(databasePath);

    expect(mode(sharedParent)).toBe(0o755);
    expect(mode(path.dirname(database))).toBe(0o700);
    expect(mode(database)).toBe(0o600);
    expect(mode(`${database}-wal`)).toBe(0o600);
    expect(mode(`${database}-shm`)).toBe(0o600);
  });

  it("rejects symbolic-link path components without touching their target", () => {
    const root = fixture();
    const outside = path.join(root, "outside");
    const link = path.join(root, "linked");
    mkdirSync(outside);
    symlinkSync(outside, link, POSIX_FILE_MODES ? "dir" : "junction");

    expect(() => ensurePrivateDirectory(path.join(link, "data"))).toThrow(/symbolic/i);
    expect(existsSync(path.join(outside, "data"))).toBe(false);
  });

  it.runIf(POSIX_FILE_MODES)("rejects unsafe writable leaves and ancestors before changing them", () => {
    const root = fixture();
    const unsafeLeaf = path.join(root, "unsafe-leaf");
    mkdirSync(unsafeLeaf, { mode: 0o777 });
    chmodSync(unsafeLeaf, 0o777);

    expect(() => ensurePrivateDirectory(unsafeLeaf)).toThrow(/writable/i);
    expect(mode(unsafeLeaf)).toBe(0o777);

    const unsafeAncestor = path.join(root, "unsafe-ancestor");
    mkdirSync(unsafeAncestor, { mode: 0o777 });
    chmodSync(unsafeAncestor, 0o777);
    expect(() => ensurePrivateDirectory(path.join(unsafeAncestor, "data"))).toThrow(/writable/i);
    expect(existsSync(path.join(unsafeAncestor, "data"))).toBe(false);
  });

  it.runIf(POSIX_FILE_MODES)("allows a trusted sticky writable ancestor", () => {
    const root = fixture();
    const sticky = path.join(root, "sticky");
    mkdirSync(sticky, { mode: 0o1777 });
    chmodSync(sticky, 0o1777);

    expect(ensurePrivateDirectory(path.join(sticky, "data"))).toBe(path.join(sticky, "data"));
    expect(lstatSync(sticky).mode & 0o1777).toBe(0o1777);
    expect(mode(path.join(sticky, "data"))).toBe(0o700);
  });

  it.runIf(!POSIX_FILE_MODES)("keeps Windows directory and SQLite creation usable", () => {
    const root = fixture();
    const database = preparePrivateSqliteDatabase(path.join(root, "data", "guild.sqlite"));

    expect(existsSync(path.dirname(database))).toBe(true);
    expect(existsSync(database)).toBe(true);
  });
});
