import type { ApplicationConfig } from "./application.js";
import { PASSWORD_HASH_ITERATIONS, requireSafePasswordIterations } from "@guild/server";
import type { OAuthProviderRuntimeConfig, OAuthRuntimeConfig } from "./oauth-providers.js";

export type ApplicationEnvironment = Readonly<Record<string, string | undefined>>;

export function readApplicationConfig(environment: ApplicationEnvironment): ApplicationConfig {
  const publicUrl = required(environment, "IG_PUBLIC_URL");
  const publicOrigin = rootOrigin(publicUrl, "IG_PUBLIC_URL");
  const inviteTokenSecret = requiredSecret(environment, "IG_INVITE_TOKEN_SECRET");
  const auditDownloadSecret = new TextEncoder().encode(
    requiredSecret(environment, "IG_AUDIT_DOWNLOAD_SECRET"),
  );
  const sessionCookieName = optional(environment, "IG_SESSION_COOKIE_NAME");
  const passwordIterations = requireSafePasswordIterations(integer(
    environment.IG_PBKDF2_ITERATIONS,
    PASSWORD_HASH_ITERATIONS,
    "IG_PBKDF2_ITERATIONS",
  ));
  const allowedOrigins = commaSeparated(environment.IG_ALLOWED_ORIGINS)
    .map((value) => rootOrigin(value, "IG_ALLOWED_ORIGINS"))
    .filter((value, index, values) => value !== publicOrigin && values.indexOf(value) === index);

  return Object.freeze({
    publicUrl: publicOrigin,
    allowedOrigins: Object.freeze(allowedOrigins),
    ...(sessionCookieName ? { sessionCookieName } : {}),
    inviteTokenSecret,
    auditDownloadSecret,
    passwordIterations,
    oauth: oauthConfig(environment),
    emailFrom: optional(environment, "IG_EMAIL_FROM") ?? null,
  });
}

function oauthConfig(environment: ApplicationEnvironment): OAuthRuntimeConfig {
  return Object.freeze({
    google: credentialPair(environment, "IG_OAUTH_GOOGLE_CLIENT_ID", "IG_OAUTH_GOOGLE_CLIENT_SECRET"),
    discord: credentialPair(environment, "IG_OAUTH_DISCORD_CLIENT_ID", "IG_OAUTH_DISCORD_CLIENT_SECRET"),
    kook: credentialPair(environment, "IG_OAUTH_KOOK_CLIENT_ID", "IG_OAUTH_KOOK_CLIENT_SECRET"),
    wechat: credentialPair(environment, "IG_OAUTH_WECHAT_APP_ID", "IG_OAUTH_WECHAT_APP_SECRET"),
  });
}

function credentialPair(
  environment: ApplicationEnvironment,
  idKey: string,
  secretKey: string,
): OAuthProviderRuntimeConfig | null {
  const clientId = optional(environment, idKey);
  const clientSecret = optional(environment, secretKey);
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new TypeError(`${idKey} and ${secretKey} must be configured together`);
  }
  return clientId && clientSecret ? Object.freeze({ clientId, clientSecret }) : null;
}

function required(environment: ApplicationEnvironment, key: string): string {
  const value = optional(environment, key);
  if (!value) throw new TypeError(`${key} is required`);
  return value;
}

function optional(environment: ApplicationEnvironment, key: string): string | undefined {
  const value = environment[key]?.trim();
  return value ? value : undefined;
}

function requiredSecret(environment: ApplicationEnvironment, key: string): string {
  const value = required(environment, key);
  if (new TextEncoder().encode(value).byteLength < 32) {
    throw new TypeError(`${key} must contain at least 32 UTF-8 bytes`);
  }
  return value;
}

function commaSeparated(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function integer(value: string | undefined, fallback: number, key: string): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${key} must be an integer`);
  return parsed;
}

function rootOrigin(value: string, key: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${key} must contain valid HTTP(S) origins`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new TypeError(`${key} must contain root HTTP(S) origins`);
  }
  return url.origin;
}
