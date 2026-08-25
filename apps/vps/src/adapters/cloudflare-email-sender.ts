import type { TransactionalEmailMessage, TransactionalEmailSender } from "@guild/server";
import { fetchWithTimeout } from "@guild/kernel";

export class CloudflareRestEmailSender implements TransactionalEmailSender {
  constructor(
    private readonly accountId: string,
    private readonly apiToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(message: TransactionalEmailMessage): Promise<Readonly<{ messageId?: string }>> {
    const response = await fetchWithTimeout(
      this.fetcher,
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      },
    );
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(payload) || payload.success !== true || !acceptedRecipient(payload.result, message.to)) {
      throw new TypeError("Cloudflare Email Sending rejected the recipient");
    }
    return isRecord(payload.result) && typeof payload.result.message_id === "string"
      ? { messageId: payload.result.message_id }
      : {};
  }
}

function acceptedRecipient(result: unknown, recipient: string): boolean {
  if (!isRecord(result)) return false;
  return [result.delivered, result.queued].some((group) => Array.isArray(group) && group.some((entry) => {
    if (entry === recipient) return true;
    return isRecord(entry) && (entry.to === recipient || entry.email === recipient || entry.recipient === recipient);
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
