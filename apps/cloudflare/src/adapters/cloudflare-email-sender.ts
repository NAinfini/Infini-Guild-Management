import type { TransactionalEmailMessage, TransactionalEmailSender } from "@guild/server";

export type CloudflareEmailBinding = Readonly<{
  send(message: TransactionalEmailMessage): Promise<Readonly<{ messageId?: string }>>;
}>;

export class CloudflareEmailSender implements TransactionalEmailSender {
  constructor(private readonly binding: CloudflareEmailBinding) {}

  async send(message: TransactionalEmailMessage): Promise<Readonly<{ messageId?: string }>> {
    const result = await this.binding.send(message);
    if (!result.messageId) throw new TypeError("Cloudflare Email Sending returned no message ID");
    return result;
  }
}
