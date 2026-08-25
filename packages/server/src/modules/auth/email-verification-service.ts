import { AppError, type RequestContext } from "@guild/kernel";
import { createAuditEvent } from "../audit/public.js";
import { createOpaqueToken, digestToken, verifyPassword } from "./crypto.js";
import type { AuthStore } from "./auth-types.js";
import type { EmailVerificationStore, TransactionalEmailSender } from "./email-verification-types.js";

const EMAIL_VERIFICATION_TTL_MS = 30 * 60 * 1_000;
const RESEND_MINIMUM_INTERVAL_SECONDS = 60;
const MAXIMUM_SENDS = 3;
const EMAIL_SEND_WINDOW_SECONDS = 60 * 60;

export type EmailVerificationServiceOptions = Readonly<{
  store: EmailVerificationStore;
  authStore: Pick<AuthStore, "findCredentialRecord" | "findUser">;
  sender: TransactionalEmailSender | null;
  from: string | null;
  publicUrl: string;
  generateToken?: () => string;
}>;

export class EmailVerificationService {
  private readonly generateToken: () => string;

  constructor(private readonly options: EmailVerificationServiceOptions) {
    this.generateToken = options.generateToken ?? (() => createOpaqueToken());
  }

  get available(): boolean {
    return this.options.sender !== null && this.options.from !== null;
  }

  async getVerifiedEmail(context: RequestContext): Promise<string | null> {
    const actor = context.authorization.requireAuthenticated();
    return this.options.store.getVerifiedEmail(actor.userId);
  }

  async request(context: RequestContext, input: Readonly<{ currentPassword: string; email: string }>): Promise<{ ok: true }> {
    const actor = context.authorization.requireAuthenticated();
    this.requireNormalSession(actor.sessionScope);
    this.requireSender();
    const verified = await this.verifyCurrentPassword(actor.userId, input.currentPassword);
    const email = normalizeEmail(input.email);
    const token = this.generateToken();
    const tokenDigest = await digestToken(token);
    const created = await this.options.store.createChallenge({
      tokenDigest,
      userId: actor.userId,
      expectedAuthRevision: verified.credential.authRevision,
      pendingEmail: email,
      expiresAt: new Date(Date.parse(context.now) + EMAIL_VERIFICATION_TTL_MS).toISOString(),
      now: context.now,
      maximumSendsInWindow: MAXIMUM_SENDS,
      sendWindowSeconds: EMAIL_SEND_WINDOW_SECONDS,
    });
    if (!created) {
      await this.assertCredentialRevisionCurrent(actor.userId, verified.credential.authRevision);
      throw new AppError({ code: "RATE_LIMITED", status: 429, message: "Too many email verification requests" });
    }
    try {
      await this.send(email, token);
    } catch (error) {
      await this.options.store.invalidateChallenge(tokenDigest, context.now);
      throw deliveryFailure(error);
    }
    return { ok: true };
  }

  async resend(context: RequestContext, currentPassword: string): Promise<{ ok: true }> {
    const actor = context.authorization.requireAuthenticated();
    this.requireNormalSession(actor.sessionScope);
    this.requireSender();
    const verified = await this.verifyCurrentPassword(actor.userId, currentPassword);
    const token = this.generateToken();
    const challenge = await this.options.store.reserveResend({
      userId: actor.userId,
      expectedAuthRevision: verified.credential.authRevision,
      nextTokenDigest: await digestToken(token),
      now: context.now,
      minimumIntervalSeconds: RESEND_MINIMUM_INTERVAL_SECONDS,
      maximumSends: MAXIMUM_SENDS,
      maximumSendsInWindow: MAXIMUM_SENDS,
      sendWindowSeconds: EMAIL_SEND_WINDOW_SECONDS,
    });
    if (!challenge) {
      await this.assertCredentialRevisionCurrent(actor.userId, verified.credential.authRevision);
      throw new AppError({ code: "CONFLICT", status: 409, message: "No email verification can be resent yet" });
    }
    try {
      await this.send(challenge.pendingEmail, token);
    } catch (error) {
      await this.options.store.invalidateChallenge(challenge.tokenDigest, context.now);
      throw deliveryFailure(error);
    }
    return { ok: true };
  }

  async verify(context: RequestContext, rawToken: string): Promise<{ ok: true }> {
    const actor = context.authorization.requireAuthenticated();
    this.requireNormalSession(actor.sessionScope);
    const user = await this.options.authStore.findUser(actor.userId);
    if (!user) throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Authentication required" });
    const outcome = await this.options.store.verify({
      tokenDigest: await digestToken(rawToken),
      userId: actor.userId,
      now: context.now,
      audit: createAuditEvent(context, {
        subjectType: "user_auth",
        subjectId: actor.userId,
        subjectLabel: user.displayName,
        action: "update",
        context: [{ field: "changed_sections", value: { type: "list", value: [{ type: "code", value: "email" }] } }],
      }),
    });
    if (outcome !== "verified") throw new AppError({
      code: "UNAUTHORIZED",
      status: 401,
      message: "Email verification could not be completed",
    });
    return { ok: true };
  }

  async remove(context: RequestContext, currentPassword: string): Promise<{ ok: true }> {
    const actor = context.authorization.requireAuthenticated();
    this.requireNormalSession(actor.sessionScope);
    const verified = await this.verifyCurrentPassword(actor.userId, currentPassword);
    const removed = await this.options.store.removeVerifiedEmail({
      userId: actor.userId,
      expectedAuthRevision: verified.credential.authRevision,
      audit: createAuditEvent(context, {
        subjectType: "user_auth",
        subjectId: actor.userId,
        subjectLabel: verified.user.displayName,
        action: "update",
        context: [{ field: "changed_sections", value: { type: "list", value: [{ type: "code", value: "email" }] } }],
      }),
    });
    if (!removed) {
      await this.assertCredentialRevisionCurrent(actor.userId, verified.credential.authRevision);
      throw new AppError({ code: "NOT_FOUND", status: 404, message: "Verified email is not configured" });
    }
    return { ok: true };
  }

  private async verifyCurrentPassword(userId: string, password: string) {
    const [credential, user] = await Promise.all([
      this.options.authStore.findCredentialRecord(userId),
      this.options.authStore.findUser(userId),
    ]);
    if (!credential || !user || !(await verifyPassword(password, credential.passwordHash))) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Current password is incorrect" });
    }
    return { credential, user };
  }

  private async assertCredentialRevisionCurrent(userId: string, expectedAuthRevision: number): Promise<void> {
    const credential = await this.options.authStore.findCredentialRecord(userId);
    if (!credential || credential.authRevision !== expectedAuthRevision) {
      throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Authentication state changed" });
    }
  }

  private async send(email: string, token: string): Promise<void> {
    const { sender, from } = this.requireSender();
    const url = new URL("/verify-email", this.options.publicUrl);
    url.hash = new URLSearchParams({ token }).toString();
    await sender.send({
      to: email,
      from,
      subject: "Verify your Infini Guild email / 验证您的 Infini Guild 邮箱",
      text: `Open this page while signed in to verify your email: ${url.toString()}`,
      html: `<p>Open this page while signed in to verify your email:</p><p><a href="${escapeHtml(url.toString())}">Verify email / 验证邮箱</a></p>`,
    });
  }

  private requireSender(): Readonly<{ sender: TransactionalEmailSender; from: string }> {
    if (!this.options.sender || !this.options.from) {
      throw new AppError({ code: "NOT_FOUND", status: 404, message: "Email verification is unavailable" });
    }
    return { sender: this.options.sender, from: this.options.from };
  }

  private requireNormalSession(scope: "normal" | "password_change"): void {
    if (scope !== "normal") throw new AppError({ code: "FORBIDDEN", status: 403, message: "Complete your password reset first" });
  }
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Invalid email address" });
  }
  return email;
}

function deliveryFailure(cause: unknown): AppError {
  return new AppError({
    code: "SERVER_ERROR",
    status: 500,
    message: "Email verification could not be sent",
    ...(cause instanceof Error ? { cause } : {}),
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
