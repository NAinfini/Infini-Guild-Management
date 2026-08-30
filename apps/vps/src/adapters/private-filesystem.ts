import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  type Stats,
} from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

const POSIX_FILE_MODES = process.platform !== "win32";
const GROUP_OR_OTHER_WRITE = 0o022;
const STICKY = 0o1000;

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function privatePathError(message: string, cause?: unknown): Error {
  return cause === undefined ? new Error(message) : new Error(message, { cause });
}

export function assertPrivatePathPolicy(
  stats: Pick<Stats, "mode" | "uid">,
  leaf: boolean,
  currentUid: number,
): void {
  if (stats.uid !== 0 && stats.uid !== currentUid) {
    throw privatePathError("Private data path must be owned by root or the service account");
  }
  if ((stats.mode & GROUP_OR_OTHER_WRITE) === 0) return;
  if (!leaf && (stats.mode & STICKY) !== 0) return;
  throw privatePathError("Private data path must not be writable by group or other users");
}

function inspectPathPolicy(stats: Pick<Stats, "mode" | "uid">, leaf: boolean): void {
  if (!POSIX_FILE_MODES) return;
  const currentUid = process.getuid?.();
  if (currentUid === undefined) throw privatePathError("Cannot resolve the service account owner");
  assertPrivatePathPolicy(stats, leaf, currentUid);
}

function inspectDirectory(directory: string, leaf: boolean): ReturnType<typeof lstatSync> {
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink()) throw privatePathError("Private data path must not contain symbolic links");
  if (!stats.isDirectory()) throw privatePathError("Private data path is not a directory");
  inspectPathPolicy(stats, leaf);
  return stats;
}

function restrictDirectory(directory: string): void {
  if (!POSIX_FILE_MODES) return;
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isDirectory()) throw privatePathError("Private data path is not a directory");
    inspectPathPolicy(stats, true);
    fchmodSync(descriptor, PRIVATE_DIRECTORY_MODE);
  } finally {
    closeSync(descriptor);
  }
}

function canonicalPath(resolved: string): string {
  const canonical = realpathSync.native(resolved);
  if (path.relative(resolved, canonical) !== "" || path.relative(canonical, resolved) !== "") {
    throw privatePathError("Private data path changed during validation");
  }
  return canonical;
}

function privateDirectory(directory: string, create: boolean, restrict: boolean): string {
  if (!directory.trim()) throw new TypeError("Private data directory is required");
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  if (resolved === root) throw privatePathError("Private data directory must not be a filesystem root");

  inspectDirectory(root, false);
  let current = root;
  const segments = path.relative(root, resolved).split(path.sep).filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const leaf = index === segments.length - 1;
    let created = false;
    try {
      inspectDirectory(current, leaf);
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
      if (!create) throw privatePathError("Private data directory does not exist", error);
      try {
        mkdirSync(current, { mode: PRIVATE_DIRECTORY_MODE });
        created = true;
      } catch (mkdirError) {
        if (!isErrno(mkdirError, "EEXIST")) throw mkdirError;
      }
      inspectDirectory(current, leaf);
    }
    if (created || (restrict && leaf)) restrictDirectory(current);
  }
  return canonicalPath(resolved);
}

function securePrivateFile(filePath: string, create: boolean): boolean {
  let descriptor: number;
  try {
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink()) throw privatePathError("Private data path must not contain symbolic links");
    if (!stats.isFile()) throw privatePathError("Private data path is not a regular file");
    inspectPathPolicy(stats, true);
    descriptor = openSync(filePath, constants.O_RDONLY | (POSIX_FILE_MODES ? constants.O_NOFOLLOW : 0));
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
    if (!create) return false;
    try {
      descriptor = openSync(
        filePath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (POSIX_FILE_MODES ? constants.O_NOFOLLOW : 0),
        PRIVATE_FILE_MODE,
      );
    } catch (createError) {
      if (!isErrno(createError, "EEXIST")) throw createError;
      return securePrivateFile(filePath, false) || securePrivateFile(filePath, true);
    }
  }

  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw privatePathError("Private data path is not a regular file");
    inspectPathPolicy(stats, true);
    if (POSIX_FILE_MODES) fchmodSync(descriptor, PRIVATE_FILE_MODE);
  } finally {
    closeSync(descriptor);
  }
  canonicalPath(path.resolve(filePath));
  return true;
}

export function ensurePrivateDirectory(directory: string): string {
  return privateDirectory(directory, true, true);
}

export function requirePrivateDirectory(directory: string): string {
  return privateDirectory(directory, false, false);
}

export function preparePrivateSqliteDatabase(databasePath: string): string {
  if (!databasePath.trim()) throw new TypeError("SQLite database path is required");
  const resolved = path.resolve(databasePath);
  const directory = ensurePrivateDirectory(path.dirname(resolved));
  const database = path.join(directory, path.basename(resolved));
  securePrivateFile(database, true);
  securePrivateFile(`${database}-wal`, false);
  securePrivateFile(`${database}-shm`, false);
  return database;
}

export async function protectPrivateFileHandle(handle: FileHandle, restrict: boolean): Promise<void> {
  const stats = await handle.stat();
  if (!stats.isFile()) throw privatePathError("Private data path is not a regular file");
  if (!POSIX_FILE_MODES) return;
  inspectPathPolicy(stats, true);
  if (restrict) await handle.chmod(PRIVATE_FILE_MODE);
}
