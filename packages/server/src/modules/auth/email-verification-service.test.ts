import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { AuthStore } from "./auth-types";
import { createPasswordHash, digestToken } from "./crypto";
import { EmailVerificationService } from "./email-verification-service";
import type { EmailVerificationStore, TransactionalEmailSender } from "./email-verification-types";

const NOW = "2026-08-22T12:00:00.000Z";
const PASSWORD = "correct horse battery staple";

function context() {
  return createRequestContext({
    requestId: "request-1",
    now: NOW,
    authorization: createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions: [],
    }),
  });
}

async function harness(send = vi.fn(async () => ({ messageId: "message-1" }))) {
  const passwordHash = await createPasswordHash(PASSWORD);
  const createChallenge = vi.fn(async (_input: Parameters<EmailVerificationStore["createChallenge"]>[0]) => true);
  const reserveResend = vi.fn<EmailVerificationStore["reserveResend"]>(async () => null);
  const removeVerifiedEmail = vi.fn<EmailVerificationStore["removeVerifiedEmail"]>(async () => false);
  const invalidateChallenge = vi.fn(async (_tokenDigest: string, _now: string) => undefined);
  const verify = vi.fn<EmailVerificationStore["verify"]>(async () => "verified");
  const store = {
    createChallenge,
    reserveResend,
    removeVerifiedEmail,
    invalidateChallenge,
    verify,
  } as unknown as EmailVerificationStore;
  const findCredentialRecord = vi.fn(async () => ({
    loginName: "member-login",
    passwordHash,
    authRevision: 1,
  }));
  const authStore = {
    findCredentialRecord,
    findUser: vi.fn(async () => ({
      id: "user-1",
      displayName: "Public One",
      isActive: true,
      deletedAt: null,
    })),
  } as unknown as Pick<AuthStore, "findCredentialRecord" | "findUser">;
  const service = new EmailVerificationService({
    store,
    authStore,
    sender: { send } as TransactionalEmailSender,
    from: "no-reply@example.com",
    publicUrl: "https://guild.example",
    generateToken: () => "raw-email-token",
  });
  return {
    service,
    passwordHash,
    findCredentialRecord,
    createChallenge,
    reserveResend,
    removeVerifiedEmail,
    invalidateChallenge,
    verify,
    send,
  };
}

describe("EmailVerificationService", () => {
  it("stores only a digest and sends the raw token in a URL fragment", async () => {
    const value = await harness();
    await expect(value.service.request(context(), {
      currentPassword: PASSWORD,
      email: "  MEMBER@Example.com ",
    })).resolves.toEqual({ ok: true });

    expect(value.createChallenge).toHaveBeenCalledWith(expect.objectContaining({
      tokenDigest: await digestToken("raw-email-token"),
      userId: "user-1",
      expectedAuthRevision: 1,
      pendingEmail: "member@example.com",
    }));
    expect(value.createChallenge.mock.calls[0]?.[0].tokenDigest).not.toContain("raw-email-token");
    expect(value.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "member@example.com",
      from: "no-reply@example.com",
      text: expect.stringContaining("https://guild.example/verify-email#token=raw-email-token"),
    }));
  });

  it("deletes the reserved challenge and reports failure when delivery fails", async () => {
    const send = vi.fn(async () => { throw new Error("provider failed"); });
    const value = await harness(send);
    await expect(value.service.request(context(), {
      currentPassword: PASSWORD,
      email: "member@example.com",
    })).rejects.toMatchObject({ code: "SERVER_ERROR", status: 500 });
    expect(value.invalidateChallenge).toHaveBeenCalledWith(await digestToken("raw-email-token"), NOW);
  });

  it("fails closed when no deployment email sender is configured", async () => {
    const passwordHash = await createPasswordHash(PASSWORD);
    const service = new EmailVerificationService({
      store: {} as EmailVerificationStore,
      authStore: {
        findCredentialRecord: async () => ({ loginName: "member-login", passwordHash, authRevision: 1 }),
        findUser: async () => null,
      } as unknown as Pick<AuthStore, "findCredentialRecord" | "findUser">,
      sender: null,
      from: null,
      publicUrl: "https://guild.example",
    });
    expect(service.available).toBe(false);
    await expect(service.request(context(), {
      currentPassword: PASSWORD,
      email: "member@example.com",
    })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("does not reveal whether verification failed because another account owns the email", async () => {
    const value = await harness();
    value.verify.mockResolvedValueOnce("email_taken").mockResolvedValueOnce("invalid");
    await expect(value.service.verify(context(), "token-1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
      message: "Email verification could not be completed",
    });
    await expect(value.service.verify(context(), "token-2")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
      message: "Email verification could not be completed",
    });
  });

  it("does not send a request or resend when the verified credential revision changed", async () => {
    const request = await harness();
    request.createChallenge.mockResolvedValueOnce(false);
    request.findCredentialRecord
      .mockResolvedValueOnce({ loginName: "member-login", passwordHash: request.passwordHash, authRevision: 1 })
      .mockResolvedValueOnce({ loginName: "member-login", passwordHash: "rotated", authRevision: 2 });

    await expect(request.service.request(context(), {
      currentPassword: PASSWORD,
      email: "member@example.com",
    })).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Authentication state changed" });
    expect(request.send).not.toHaveBeenCalled();

    const resend = await harness();
    resend.reserveResend.mockResolvedValueOnce(null);
    resend.findCredentialRecord
      .mockResolvedValueOnce({ loginName: "member-login", passwordHash: resend.passwordHash, authRevision: 1 })
      .mockResolvedValueOnce({ loginName: "member-login", passwordHash: "rotated", authRevision: 2 });

    await expect(resend.service.resend(context(), PASSWORD))
      .rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Authentication state changed" });
    expect(resend.send).not.toHaveBeenCalled();
  });

  it("binds password-confirmed email writes to the credential revision", async () => {
    const value = await harness();
    value.reserveResend.mockResolvedValueOnce({
      tokenDigest: "resend-digest",
      userId: "user-1",
      pendingEmail: "member@example.com",
      expiresAt: "2026-08-22T12:30:00.000Z",
      sentCount: 2,
      lastSentAt: NOW,
    });
    value.removeVerifiedEmail.mockResolvedValueOnce(true);

    await value.service.resend(context(), PASSWORD);
    await value.service.remove(context(), PASSWORD);

    expect(value.reserveResend).toHaveBeenCalledWith(expect.objectContaining({ expectedAuthRevision: 1 }));
    expect(value.removeVerifiedEmail).toHaveBeenCalledWith(expect.objectContaining({ expectedAuthRevision: 1 }));
  });
});
