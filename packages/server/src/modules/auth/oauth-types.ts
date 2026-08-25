import type { AuditEventWrite } from "../audit/public.js";

export const OAUTH_PROVIDERS = ["google", "discord", "kook", "wechat"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export type OAuthPurpose = "login" | "link";

export type OAuthChallenge = Readonly<{
  stateDigest: string;
  browserBindingDigest: string;
  provider: OAuthProvider;
  purpose: OAuthPurpose;
  userId: string | null;
  nonce: string | null;
  pkceVerifier: string | null;
  authRevision: number | null;
  expiresAt: string;
}>;

export type ExternalIdentity = Readonly<{
  id: string;
  userId: string;
  provider: OAuthProvider;
  providerSubject: string;
  createdAt: string;
  lastUsedAt: string;
}>;

/** Provider adapters return only the stable provider subject. Access and refresh
 * tokens are consumed immediately and must never enter persistence or logs. */
export interface OAuthProviderClient {
  readonly provider: OAuthProvider;
  readonly supported: boolean;
  authorizationUrl(input: Readonly<{
    state: string;
    redirectUri: string;
    nonce: string | null;
    pkceChallenge: string | null;
  }>): string;
  resolveSubject(input: Readonly<{
    code: string;
    redirectUri: string;
    nonce: string | null;
    pkceVerifier: string | null;
    signal?: AbortSignal;
  }>): Promise<string>;
}

export interface OAuthStore {
  createChallenge(challenge: OAuthChallenge & Readonly<{ createdAt: string }>): Promise<void>;
  consumeChallenge(
    stateDigest: string,
    browserBindingDigest: string,
    provider: OAuthProvider,
    now: string,
  ): Promise<OAuthChallenge | null>;
  findIdentity(provider: OAuthProvider, providerSubject: string): Promise<ExternalIdentity | null>;
  touchIdentity(provider: OAuthProvider, providerSubject: string, now: string): Promise<void>;
  listIdentities(userId: string): Promise<readonly ExternalIdentity[]>;
  linkIdentity(input: Readonly<{
    id: string;
    userId: string;
    provider: OAuthProvider;
    providerSubject: string;
    now: string;
    expectedAuthRevision: number;
    audit: AuditEventWrite;
  }>): Promise<"linked" | "already_linked" | "linked_elsewhere" | "invalid">;
  unlinkIdentity(input: Readonly<{
    userId: string;
    provider: OAuthProvider;
    expectedAuthRevision: number;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
}

export interface OAuthSiteConfigReader {
  oauthEnabled(provider: OAuthProvider): Promise<boolean>;
}
