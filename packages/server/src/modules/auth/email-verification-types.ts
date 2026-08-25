import type { AuditEventWrite } from "../audit/public.js";

export type TransactionalEmailMessage = Readonly<{
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}>;

export interface TransactionalEmailSender {
  send(message: TransactionalEmailMessage): Promise<Readonly<{ messageId?: string }>>;
}

export type PendingEmailVerification = Readonly<{
  tokenDigest: string;
  userId: string;
  pendingEmail: string;
  expiresAt: string;
  sentCount: number;
  lastSentAt: string;
}>;

export interface EmailVerificationStore {
  getVerifiedEmail(userId: string): Promise<string | null>;
  createChallenge(input: Readonly<{
    tokenDigest: string;
    userId: string;
    expectedAuthRevision: number;
    pendingEmail: string;
    expiresAt: string;
    now: string;
    maximumSendsInWindow: number;
    sendWindowSeconds: number;
  }>): Promise<boolean>;
  findActiveChallenge(userId: string, now: string): Promise<PendingEmailVerification | null>;
  reserveResend(input: Readonly<{
    userId: string;
    expectedAuthRevision: number;
    nextTokenDigest: string;
    now: string;
    minimumIntervalSeconds: number;
    maximumSends: number;
    maximumSendsInWindow: number;
    sendWindowSeconds: number;
  }>): Promise<PendingEmailVerification | null>;
  invalidateChallenge(tokenDigest: string, now: string): Promise<void>;
  verify(input: Readonly<{
    tokenDigest: string;
    userId: string;
    now: string;
    audit: AuditEventWrite;
  }>): Promise<"verified" | "invalid" | "email_taken">;
  removeVerifiedEmail(input: Readonly<{
    userId: string;
    expectedAuthRevision: number;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
}
