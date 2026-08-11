import type {
  NotificationMessage,
  NotificationPublisher,
} from "@guild/kernel";

export type NotificationFetcher = {
  fetch(input: string, init: RequestInit): Promise<Response>;
};

export class CloudflareNotificationPublisher implements NotificationPublisher {
  constructor(private readonly target: NotificationFetcher) {}

  async publish(message: NotificationMessage): Promise<void> {
    if (!message.type.trim()) throw new TypeError("Notification type is required");
    const response = await this.target.fetch("https://notifications.internal/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw new Error(`Notification publisher returned HTTP ${response.status}`);
  }
}
