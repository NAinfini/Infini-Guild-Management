import type {
  NotificationMessage,
  NotificationPublisher,
} from "@guild/kernel";

export type NotificationBroadcast = (message: NotificationMessage) => void | Promise<void>;

export class NodeNotificationPublisher implements NotificationPublisher {
  constructor(private readonly broadcast: NotificationBroadcast) {}

  async publish(message: NotificationMessage): Promise<void> {
    if (!message.type.trim()) throw new TypeError("Notification type is required");
    await this.broadcast(message);
  }
}
