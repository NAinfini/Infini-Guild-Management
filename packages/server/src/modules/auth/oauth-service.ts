import {
  AppError,
  type DeferredTasks,
  type NotificationPublisher,
  type RequestContext,
} from "@guild/kernel";
import { createAuditEvent } from "../audit/public.js";
import { createOpaqueToken, digestToken, verifyPassword } from "./crypto.js";
import type { AuthStore } from "./auth-types.js";
import {
  OAUTH_PROVIDERS,
  type OAuthProvider,
  type OAuthProviderClient,
  type OAuthSiteConfigReader,
  type OAuthStore,
} from "./oauth-types.js";

const CHALLENGE_TTL_MS = 10 * 60 * 1_000;

export type OAuthServiceOptions = Readonly<{
  store: OAuthStore;
  authStore: Pick<AuthStore, "findCredentialRecord" | "findUser">;
  siteConfig: OAuthSiteConfigReader;
  clients: Readonly<Record<OAuthProvider, OAuthProviderClient>>;
  publicUrl: string;
  notifications?: NotificationPublisher;
  deferred?: DeferredTasks;
  generateId?: () => string;
  generateToken?: () => string;
}>;

export class OAuthService {
  private readonly generateId: () => string;
  private readonly generateToken: () => string;

  constructor(private readonly options: OAuthServiceOptions) {
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.generateToken = options.generateToken ?? (() => createOpaqueToken());
  }

  async startLogin(provider: OAuthProvider, now: string): Promise<Readonly<{
    authorizationUrl: string;
    browserBindingToken: string;
  }>> {
    return this.start(provider, "login", null, null, now);
  }

  async startLink(
    context: RequestContext,
    provider: OAuthProvider,
    currentPassword: string,
  ): Promise<Readonly<{ authorizationUrl: string; browserBindingToken: string }>> {
    const actor = context.authorization.requireAuthenticated();
    if (actor.sessionScope !== "normal") {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Complete your password reset first" });
    }
    const credential = await this.options.authStore.findCredentialRecord(actor.userId);
    if (!credential || !(await verifyPassword(currentPassword, credential.passwordHash))) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Current password is incorrect" });
    }
    return this.start(provider, "link", actor.userId, credential.authRevision, context.now);
  }

  async finish(
    context: RequestContext,
    input: Readonly<{
      provider: OAuthProvider;
      state: string;
      browserBindingToken: string;
      code: string;
      now: string;
    }>,
  ): Promise<
    | Readonly<{ kind: "login"; userId: string; authRevision: number }>
    | Readonly<{ kind: "link" }>
  > {
    const client = await this.requireClient(input.provider);
    const challenge = await this.options.store.consumeChallenge(
      await digestToken(input.state),
      await digestToken(input.browserBindingToken),
      input.provider,
      input.now,
    );
    if (!challenge) throw unavailableAuthorization();
    let subject: string;
    try {
      subject = await client.resolveSubject({
        code: input.code,
        redirectUri: this.redirectUri(input.provider),
        nonce: challenge.nonce,
        pkceVerifier: challenge.pkceVerifier,
        signal: context.signal,
      });
    } catch {
      throw unavailableAuthorization();
    }
    if (!subject.trim()) throw unavailableAuthorization();

    if (challenge.purpose === "login") {
      const identity = await this.options.store.findIdentity(input.provider, subject);
      if (!identity) throw unavailableAuthorization();
      const [user, credential, recheckedIdentity] = await Promise.all([
        this.options.authStore.findUser(identity.userId),
        this.options.authStore.findCredentialRecord(identity.userId),
        this.options.store.findIdentity(input.provider, subject),
      ]);
      if (
        !user
        || !credential
        || !recheckedIdentity
        || recheckedIdentity.userId !== identity.userId
        || !user.isActive
        || user.deletedAt !== null
      ) throw unavailableAuthorization();
      await this.options.store.touchIdentity(input.provider, subject, input.now);
      return { kind: "login", userId: identity.userId, authRevision: credential.authRevision };
    }

    const actor = context.authorization.requireAuthenticated();
    if (
      actor.sessionScope !== "normal"
      || challenge.userId !== actor.userId
      || challenge.authRevision === null
    ) throw unavailableAuthorization();
    const user = await this.options.authStore.findUser(actor.userId);
    if (!user || !user.isActive || user.deletedAt !== null) throw unavailableAuthorization();
    const linked = await this.options.store.linkIdentity({
      id: this.generateId(),
      userId: actor.userId,
      provider: input.provider,
      providerSubject: subject,
      now: input.now,
      expectedAuthRevision: challenge.authRevision,
      audit: createAuditEvent(context, {
        subjectType: "user_auth",
        subjectId: actor.userId,
        subjectLabel: user.displayName,
        action: "update",
        context: [{ field: "provider", value: { type: "text", value: input.provider } }],
      }),
    });
    if (linked === "linked_elsewhere" || linked === "invalid") throw unavailableAuthorization();
    return { kind: "link" };
  }

  async unlink(
    context: RequestContext,
    provider: OAuthProvider,
    currentPassword: string,
  ): Promise<{ ok: true }> {
    const actor = context.authorization.requireAuthenticated();
    if (actor.sessionScope !== "normal") {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Complete your password reset first" });
    }
    const [credential, user] = await Promise.all([
      this.options.authStore.findCredentialRecord(actor.userId),
      this.options.authStore.findUser(actor.userId),
    ]);
    if (!credential || !user || !(await verifyPassword(currentPassword, credential.passwordHash))) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Current password is incorrect" });
    }
    const removed = await this.options.store.unlinkIdentity({
      userId: actor.userId,
      provider,
      expectedAuthRevision: credential.authRevision,
      audit: createAuditEvent(context, {
        subjectType: "user_auth",
        subjectId: actor.userId,
        subjectLabel: user.displayName,
        action: "update",
        context: [{ field: "provider", value: { type: "text", value: provider } }],
      }),
    });
    if (!removed) throw new AppError({ code: "NOT_FOUND", status: 404, message: "OAuth identity is not linked" });
    const { deferred, notifications } = this.options;
    if (deferred && notifications) {
      deferred.defer(() => notifications.publish({
        type: "authorization_refresh",
        user_ids: [actor.userId],
      }));
    }
    return { ok: true };
  }

  async listLinkedProviders(context: RequestContext): Promise<readonly OAuthProvider[]> {
    const actor = context.authorization.requireAuthenticated();
    const identities = await this.options.store.listIdentities(actor.userId);
    return identities.map((identity) => identity.provider);
  }

  private async start(
    provider: OAuthProvider,
    purpose: "login" | "link",
    userId: string | null,
    authRevision: number | null,
    now: string,
  ): Promise<Readonly<{ authorizationUrl: string; browserBindingToken: string }>> {
    const client = await this.requireClient(provider);
    const state = this.generateToken();
    const browserBindingToken = this.generateToken();
    const nonce = provider === "google" ? this.generateToken() : null;
    const pkceVerifier = provider === "google" ? this.generateToken() : null;
    const pkceChallenge = pkceVerifier === null ? null : await pkceS256(pkceVerifier);
    await this.options.store.createChallenge({
      stateDigest: await digestToken(state),
      browserBindingDigest: await digestToken(browserBindingToken),
      provider,
      purpose,
      userId,
      authRevision,
      nonce,
      pkceVerifier,
      expiresAt: new Date(Date.parse(now) + CHALLENGE_TTL_MS).toISOString(),
      createdAt: now,
    });
    return {
      authorizationUrl: client.authorizationUrl({
        state,
        redirectUri: this.redirectUri(provider),
        nonce,
        pkceChallenge,
      }),
      browserBindingToken,
    };
  }

  private async requireClient(provider: OAuthProvider): Promise<OAuthProviderClient> {
    if (!OAUTH_PROVIDERS.includes(provider)) throw unavailableAuthorization();
    const client = this.options.clients[provider];
    if (!client.supported || !await this.options.siteConfig.oauthEnabled(provider)) throw unavailableAuthorization();
    return client;
  }

  private redirectUri(provider: OAuthProvider): string {
    return new URL(`/api/auth/oauth/${provider}/callback`, this.options.publicUrl).toString();
  }
}

async function pkceS256(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function unavailableAuthorization(): AppError {
  return new AppError({ code: "UNAUTHORIZED", status: 401, message: "OAuth authorization could not be completed" });
}
