import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { AuthStore } from "./auth-types";
import { digestToken } from "./crypto";
import { OAuthService } from "./oauth-service";
import type { OAuthChallenge, OAuthProviderClient, OAuthStore } from "./oauth-types";

const NOW = "2026-08-22T12:00:00.000Z";

function anonymousContext() {
  return createRequestContext({
    requestId: "request-anonymous",
    now: NOW,
    authorization: createAuthorizationContext(null),
  });
}

function clients(client: OAuthProviderClient) {
  const unavailable = (provider: "discord" | "kook" | "wechat"): OAuthProviderClient => ({
    provider,
    supported: false,
    authorizationUrl: () => { throw new Error("unavailable"); },
    resolveSubject: async () => { throw new Error("unavailable"); },
  });
  return {
    google: client,
    discord: unavailable("discord"),
    kook: unavailable("kook"),
    wechat: unavailable("wechat"),
  } as const;
}

function authStore() {
  return {
    findCredentialRecord: vi.fn(async () => ({
      loginName: "member-login",
      passwordHash: "password-hash",
      authRevision: 1,
    })),
    findUser: vi.fn(async () => ({
      id: "user-1",
      displayName: "Public One",
      isActive: true,
      deletedAt: null,
    })),
  } as unknown as Pick<AuthStore, "findCredentialRecord" | "findUser">;
}

describe("OAuthService", () => {
  it("stores only digested state, uses fixed callback data, and rejects replay", async () => {
    let saved: (OAuthChallenge & { createdAt: string }) | null = null;
    let consumed = false;
    const store = {
      createChallenge: vi.fn(async (challenge) => { saved = challenge; }),
      consumeChallenge: vi.fn(async (stateDigest, browserBindingDigest, provider) => {
        if (
          consumed
          || !saved
          || saved.stateDigest !== stateDigest
          || saved.browserBindingDigest !== browserBindingDigest
          || saved.provider !== provider
        ) return null;
        consumed = true;
        return saved;
      }),
      findIdentity: vi.fn(async () => ({
        id: "identity-1",
        userId: "user-1",
        provider: "google",
        providerSubject: "google-subject",
        createdAt: NOW,
        lastUsedAt: NOW,
      })),
      touchIdentity: vi.fn(async () => undefined),
    } as unknown as OAuthStore;
    const authorizationUrl = vi.fn((input) => `https://provider.example/auth?state=${input.state}`);
    const resolveSubject = vi.fn(async () => "google-subject");
    const client: OAuthProviderClient = {
      provider: "google",
      supported: true,
      authorizationUrl,
      resolveSubject,
    };
    const tokens = ["raw-state", "raw-browser-binding", "raw-nonce", "raw-pkce"];
    const service = new OAuthService({
      store,
      authStore: authStore(),
      siteConfig: { oauthEnabled: async () => true },
      clients: clients(client),
      publicUrl: "https://guild.example/base",
      generateToken: () => tokens.shift()!,
    });

    await expect(service.startLogin("google", NOW)).resolves.toEqual({
      authorizationUrl: "https://provider.example/auth?state=raw-state",
      browserBindingToken: "raw-browser-binding",
    });
    const savedChallenge = saved as (OAuthChallenge & { createdAt: string }) | null;
    expect(savedChallenge).toMatchObject({
      stateDigest: await digestToken("raw-state"),
      browserBindingDigest: await digestToken("raw-browser-binding"),
      nonce: "raw-nonce",
      pkceVerifier: "raw-pkce",
      authRevision: null,
      purpose: "login",
      userId: null,
    });
    expect(savedChallenge?.stateDigest).not.toContain("raw-state");
    expect(authorizationUrl).toHaveBeenCalledWith(expect.objectContaining({
      redirectUri: "https://guild.example/api/auth/oauth/google/callback",
      nonce: "raw-nonce",
    }));

    const callback = {
      provider: "google" as const,
      state: "raw-state",
      browserBindingToken: "raw-browser-binding",
      code: "code",
      now: NOW,
    };
    await expect(service.finish(anonymousContext(), callback)).resolves.toEqual({
      kind: "login",
      userId: "user-1",
      authRevision: 1,
    });
    expect(resolveSubject).toHaveBeenCalledWith(expect.objectContaining({
      code: "code",
      nonce: "raw-nonce",
      pkceVerifier: "raw-pkce",
    }));
    await expect(service.finish(anonymousContext(), callback)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("never auto-registers or merges an unlinked provider subject", async () => {
    const challenge: OAuthChallenge = {
      stateDigest: await digestToken("raw-state"),
      browserBindingDigest: await digestToken("raw-browser-binding"),
      provider: "google",
      purpose: "login",
      userId: null,
      nonce: "nonce",
      pkceVerifier: "verifier",
      authRevision: null,
      expiresAt: "2026-08-22T12:10:00.000Z",
    };
    const store = {
      consumeChallenge: vi.fn(async () => challenge),
      findIdentity: vi.fn(async () => null),
    } as unknown as OAuthStore;
    const client: OAuthProviderClient = {
      provider: "google",
      supported: true,
      authorizationUrl: () => "https://provider.example",
      resolveSubject: async () => "unlinked-subject",
    };
    const service = new OAuthService({
      store,
      authStore: authStore(),
      siteConfig: { oauthEnabled: async () => true },
      clients: clients(client),
      publicUrl: "https://guild.example",
    });

    await expect(service.finish(anonymousContext(), {
      provider: "google",
      state: "raw-state",
      browserBindingToken: "raw-browser-binding",
      code: "code",
      now: NOW,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("keeps unsupported providers fail-closed even when Site Config is enabled", async () => {
    const unsupported: OAuthProviderClient = {
      provider: "google",
      supported: false,
      authorizationUrl: () => "https://provider.example",
      resolveSubject: async () => "subject",
    };
    const service = new OAuthService({
      store: {} as OAuthStore,
      authStore: authStore(),
      siteConfig: { oauthEnabled: async () => true },
      clients: clients(unsupported),
      publicUrl: "https://guild.example",
    });
    await expect(service.startLogin("google", NOW)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });
});
