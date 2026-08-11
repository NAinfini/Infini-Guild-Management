import { readApplicationConfig, type ApplicationConfig } from "@guild/application";
import { isIP } from "node:net";
import path from "node:path";

export type VpsRuntimeConfig = Readonly<{
  application: ApplicationConfig;
  host: string;
  port: number;
  databasePath: string;
  blobPath: string;
  staticPath: string;
  trustedProxyAddresses: ReadonlySet<string>;
}>;

export function readVpsRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  workingDirectory = process.cwd(),
): VpsRuntimeConfig {
  const application = readApplicationConfig(environment);
  const publicUrl = new URL(application.publicUrl);
  if (publicUrl.protocol !== "https:" && !isLoopbackHost(publicUrl.hostname)) {
    throw new TypeError("IG_PUBLIC_URL must use HTTPS outside local development");
  }
  const host = environment.IG_HOST?.trim() || "127.0.0.1";
  const port = integer(environment.IG_PORT, 3_000, "IG_PORT", 1, 65_535);
  const trustedProxyAddresses = new Set(
    commaSeparated(environment.IG_TRUSTED_PROXY_IPS).map((value) => normalizeIp(value, "IG_TRUSTED_PROXY_IPS")),
  );
  return Object.freeze({
    application,
    host,
    port,
    databasePath: resolvePath(environment.IG_DATABASE_PATH, workingDirectory, "data/infini-guild.sqlite"),
    blobPath: resolvePath(environment.IG_BLOB_PATH, workingDirectory, "data/blobs"),
    staticPath: resolvePath(environment.IG_STATIC_PATH, workingDirectory, "dist"),
    trustedProxyAddresses,
  });
}

function integer(
  value: string | undefined,
  fallback: number,
  key: string,
  minimum: number,
  maximum: number,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function resolvePath(value: string | undefined, workingDirectory: string, fallback: string): string {
  return path.resolve(workingDirectory, value?.trim() || fallback);
}

function commaSeparated(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function normalizeIp(value: string, key: string): string {
  const normalized = value.startsWith("::ffff:") && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  if (isIP(normalized) === 0) throw new TypeError(`${key} must contain only IP addresses`);
  return normalized;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}
