import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { fetchWithTimeout } from "@guild/kernel";
import type { OAuthProvider, OAuthProviderClient } from "@guild/server";

export type OAuthProviderRuntimeConfig = Readonly<{
  clientId: string;
  clientSecret: string;
}>;

export type OAuthRuntimeConfig = Readonly<Record<OAuthProvider, OAuthProviderRuntimeConfig | null>>;

type Fetcher = typeof fetch;

export function oauthProviderAvailability(config: OAuthRuntimeConfig): Readonly<Record<OAuthProvider, boolean>> {
  return Object.freeze({
    google: config.google !== null,
    discord: config.discord !== null,
    kook: config.kook !== null,
    // WeChat's official callback/token rules were not available for verification.
    wechat: false,
  });
}

export function createOAuthProviderClients(
  config: OAuthRuntimeConfig,
  fetcher: Fetcher = fetch,
): Readonly<Record<OAuthProvider, OAuthProviderClient>> {
  return Object.freeze({
    google: config.google ? googleClient(config.google, fetcher) : unavailableClient("google"),
    discord: config.discord ? discordClient(config.discord, fetcher) : unavailableClient("discord"),
    kook: config.kook ? kookClient(config.kook, fetcher) : unavailableClient("kook"),
    // Do not guess an adapter from third-party WeChat material. This must remain unavailable.
    wechat: unavailableClient("wechat"),
  });
}

function googleClient(config: OAuthProviderRuntimeConfig, fetcher: Fetcher): OAuthProviderClient {
  const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), {
    [customFetch]: (input, init) => fetchWithTimeout(fetcher, input, init),
  });
  return {
    provider: "google",
    supported: true,
    authorizationUrl(input) {
      return authorizationUrl("https://accounts.google.com/o/oauth2/v2/auth", {
        client_id: config.clientId,
        redirect_uri: input.redirectUri,
        response_type: "code",
        scope: "openid profile",
        state: input.state,
        nonce: required(input.nonce, "Google nonce"),
        code_challenge: required(input.pkceChallenge, "Google PKCE challenge"),
        code_challenge_method: "S256",
      });
    },
    async resolveSubject(input) {
      const token = await tokenResponse(fetcher, "https://oauth2.googleapis.com/token", {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: input.code,
        code_verifier: required(input.pkceVerifier, "Google PKCE verifier"),
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
      }, input.signal);
      const idToken = requiredString(token.id_token);
      const { payload } = await jwtVerify(idToken, jwks, {
        algorithms: ["RS256"],
        audience: config.clientId,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        requiredClaims: ["exp", "iat", "sub", "nonce"],
        clockTolerance: 15,
      });
      if (payload.nonce !== input.nonce || typeof payload.iat !== "number" || payload.iat * 1_000 > Date.now() + 60_000) {
        throw new TypeError("Invalid Google ID token claims");
      }
      return requiredString(payload.sub);
    },
  };
}

function discordClient(config: OAuthProviderRuntimeConfig, fetcher: Fetcher): OAuthProviderClient {
  return {
    provider: "discord",
    supported: true,
    authorizationUrl(input) {
      return authorizationUrl("https://discord.com/oauth2/authorize", {
        client_id: config.clientId,
        redirect_uri: input.redirectUri,
        response_type: "code",
        scope: "identify",
        state: input.state,
      });
    },
    async resolveSubject(input) {
      const token = await tokenResponse(fetcher, "https://discord.com/api/v10/oauth2/token", {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
      }, input.signal);
      const response = await fetchWithTimeout(fetcher, "https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bearer ${requiredString(token.access_token)}` },
        signal: input.signal,
      });
      return requiredString((await responseJson(response)).id);
    },
  };
}

function kookClient(config: OAuthProviderRuntimeConfig, fetcher: Fetcher): OAuthProviderClient {
  return {
    provider: "kook",
    supported: true,
    authorizationUrl(input) {
      return authorizationUrl("https://www.kookapp.cn/oauth2/authorize", {
        client_id: config.clientId,
        redirect_uri: input.redirectUri,
        response_type: "code",
        scope: "get_user_info",
        state: input.state,
      });
    },
    async resolveSubject(input) {
      const token = await tokenResponse(fetcher, "https://www.kookapp.cn/api/oauth2/token", {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
      }, input.signal);
      const response = await fetchWithTimeout(fetcher, "https://www.kookapp.cn/api/v3/user/me", {
        headers: { Authorization: `Bearer ${requiredString(token.access_token)}` },
        signal: input.signal,
      });
      const payload = await responseJson(response);
      if (payload.code !== 0 || !isRecord(payload.data)) throw new TypeError("Invalid KOOK user response");
      return requiredString(payload.data.id);
    },
  };
}

function unavailableClient(provider: OAuthProvider): OAuthProviderClient {
  return {
    provider,
    supported: false,
    authorizationUrl() {
      throw new TypeError(`${provider} OAuth is unavailable`);
    },
    async resolveSubject() {
      throw new TypeError(`${provider} OAuth is unavailable`);
    },
  };
}

function authorizationUrl(endpoint: string, values: Record<string, string>): string {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.toString();
}

async function tokenResponse(
  fetcher: Fetcher,
  endpoint: string,
  values: Record<string, string>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(fetcher, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
    signal,
  });
  return responseJson(response);
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new TypeError("OAuth provider request failed");
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new TypeError("OAuth provider returned an invalid response");
  return value;
}

function required(value: string | null, label: string): string {
  if (!value) throw new TypeError(`${label} is required`);
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("OAuth provider response is missing an identity value");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
