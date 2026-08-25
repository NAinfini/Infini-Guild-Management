import { describe, expect, it, vi } from "vitest";
import { CloudflareRestEmailSender } from "./cloudflare-email-sender.js";

const MESSAGE = {
  to: "member@example.com",
  from: "no-reply@example.com",
  subject: "Verify",
  text: "Verify",
  html: "<p>Verify</p>",
};

describe("CloudflareRestEmailSender", () => {
  it("uses the deployment account token and accepts a queued recipient", async () => {
    const fetcher = vi.fn(async () => Response.json({
      success: true,
      result: { queued: [MESSAGE.to], delivered: [], bounced: [] },
    })) as typeof fetch;
    const sender = new CloudflareRestEmailSender("account/id", "private-token", fetcher);

    await expect(sender.send(MESSAGE)).resolves.toEqual({});
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/account%2Fid/email/sending/send",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer private-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(MESSAGE),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("fails with a generic error when Cloudflare rejects the send", async () => {
    const fetcher = vi.fn(async () => Response.json({
      success: false,
      errors: [{ message: "secret provider detail" }],
    }, { status: 403 })) as typeof fetch;
    const sender = new CloudflareRestEmailSender("account", "private-token", fetcher);
    await expect(sender.send(MESSAGE)).rejects.toThrow("rejected the recipient");
    await expect(sender.send(MESSAGE)).rejects.not.toThrow(/private-token|secret provider detail/);
  });
});
