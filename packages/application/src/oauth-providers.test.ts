import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createOAuthProviderClients, oauthProviderAvailability, type OAuthRuntimeConfig } from "./oauth-providers.js";

const CONFIG: OAuthRuntimeConfig = Object.freeze({
  google: { clientId: "google-client", clientSecret: "google-secret" },
  discord: { clientId: "discord-client", clientSecret: "discord-secret" },
  kook: { clientId: "kook-client", clientSecret: "kook-secret" },
  wechat: { clientId: "wechat-client", clientSecret: "wechat-secret" },
});

describe("OAuth provider clients", () => {
  it("requests only the approved scopes and keeps WeChat unavailable", () => {
    const clients = createOAuthProviderClients(CONFIG, vi.fn() as typeof fetch);
    const common = {
      state: "state",
      redirectUri: "https://guild.example/api/auth/oauth/callback",
      nonce: "nonce",
      pkceChallenge: "challenge",
    };

    const google = new URL(clients.google.authorizationUrl(common));
    expect(google.searchParams.get("scope")).toBe("openid profile");
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");
    expect(google.searchParams.has("email")).toBe(false);

    const discord = new URL(clients.discord.authorizationUrl(common));
    expect(discord.searchParams.get("scope")).toBe("identify");
    expect(discord.searchParams.has("permissions")).toBe(false);

    const kook = new URL(clients.kook.authorizationUrl(common));
    expect(kook.searchParams.get("scope")).toBe("get_user_info");
    expect(kook.searchParams.has("code_challenge")).toBe(false);

    expect(oauthProviderAvailability(CONFIG)).toEqual({
      google: true,
      discord: true,
      kook: true,
      wechat: false,
    });
    expect(clients.wechat.supported).toBe(false);
  });

  it("verifies Google signature, issuer, audience, nonce, and stable sub", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
    const idToken = await new SignJWT({ nonce: "expected-nonce" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://accounts.google.com")
      .setAudience("google-client")
      .setSubject("google-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ id_token: idToken });
      if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const client = createOAuthProviderClients(CONFIG, fetcher).google;

    await expect(client.resolveSubject({
      code: "authorization-code",
      redirectUri: "https://guild.example/api/auth/oauth/google/callback",
      nonce: "expected-nonce",
      pkceVerifier: "pkce-verifier",
    })).resolves.toBe("google-subject");
    await expect(client.resolveSubject({
      code: "authorization-code",
      redirectUri: "https://guild.example/api/auth/oauth/google/callback",
      nonce: "wrong-nonce",
      pkceVerifier: "pkce-verifier",
    })).rejects.toThrow();
  });

  it("uses only stable provider IDs for Discord and KOOK", async () => {
    const discordFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "discord-access" });
      expect(init?.headers).toEqual({ Authorization: "Bearer discord-access" });
      return Response.json({ id: "discord-subject", username: "public-name", email: "ignored@example.com" });
    }) as typeof fetch;
    await expect(createOAuthProviderClients(CONFIG, discordFetch).discord.resolveSubject({
      code: "code",
      redirectUri: "https://guild.example/api/auth/oauth/discord/callback",
      nonce: null,
      pkceVerifier: null,
    })).resolves.toBe("discord-subject");

    const kookFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/oauth2/token")) return Response.json({ access_token: "kook-access" });
      expect(init?.headers).toEqual({ Authorization: "Bearer kook-access" });
      return Response.json({ code: 0, data: { id: "kook-subject", username: "ignored" } });
    }) as typeof fetch;
    await expect(createOAuthProviderClients(CONFIG, kookFetch).kook.resolveSubject({
      code: "code",
      redirectUri: "https://guild.example/api/auth/oauth/kook/callback",
      nonce: null,
      pkceVerifier: null,
    })).resolves.toBe("kook-subject");
  });
});
