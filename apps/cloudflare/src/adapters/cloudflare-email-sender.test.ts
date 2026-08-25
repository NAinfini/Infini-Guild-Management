import { describe, expect, it, vi } from "vitest";
import { CloudflareEmailSender } from "./cloudflare-email-sender.js";

const MESSAGE = {
  to: "member@example.com",
  from: "no-reply@example.com",
  subject: "Verify",
  text: "Verify",
  html: "<p>Verify</p>",
};

describe("CloudflareEmailSender", () => {
  it("passes the structured message to the binding and requires a message ID", async () => {
    const send = vi.fn(async () => ({ messageId: "message-1" }));
    await expect(new CloudflareEmailSender({ send }).send(MESSAGE)).resolves.toEqual({ messageId: "message-1" });
    expect(send).toHaveBeenCalledWith(MESSAGE);

    await expect(new CloudflareEmailSender({ send: async () => ({}) }).send(MESSAGE))
      .rejects.toThrow("returned no message ID");
  });
});
