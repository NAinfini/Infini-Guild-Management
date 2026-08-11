import {
  MEMBER_BROADCAST_HINTS,
  heartbeatMessageSchema,
  pushMessageSchema,
  type HeartbeatAckMessage,
  type HeartbeatMessage,
  type PushMessage,
} from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import type { AuthorizationContext, NotificationPublisher } from "@guild/kernel";
import { AppError } from "@guild/kernel";

export class NotificationService implements NotificationPublisher {
  constructor(private readonly publisher: NotificationPublisher) {}

  async publish(message: Parameters<NotificationPublisher["publish"]>[0]): Promise<void> {
    await this.publisher.publish(pushMessageSchema.parse(message));
  }

  heartbeat(input: unknown, serverAt: string, connections: number): HeartbeatAckMessage {
    const heartbeat = heartbeatMessageSchema.parse(input);
    if (!Number.isSafeInteger(connections) || connections < 1) {
      throw new TypeError("WebSocket connection count must be a positive safe integer");
    }
    return {
      type: "heartbeat_ack",
      tab_id: heartbeat.tab_id,
      seq: heartbeat.seq,
      server_at: serverAt,
      connections,
    };
  }
}

export function parseHeartbeat(input: unknown): HeartbeatMessage {
  return heartbeatMessageSchema.parse(input);
}

export function canReceiveNotification(authorization: AuthorizationContext, messageInput: unknown): boolean {
  if (!authorization.actor) return false;
  const message: PushMessage = pushMessageSchema.parse(messageInput);
  if (message.type !== "entity_changed" || MEMBER_BROADCAST_HINTS.has(message.hint)) return true;
  if (message.hint === "badge_assigned" || message.hint === "badge_unassigned") {
    return authorization.has(PERMISSION_ID.ADMIN_BADGES_MANAGE);
  }
  if (message.hint === "profile_moderated") {
    return authorization.has(PERMISSION_ID.ADMIN_USERS_VIEW)
      || authorization.has(PERMISSION_ID.ADMIN_USERS_EDIT);
  }
  if (message.hint === "role_tags_updated") return authorization.has(PERMISSION_ID.GUILD_WAR_TEAMS_EDIT);
  return false;
}

export function requireNotificationSession(authorization: AuthorizationContext): string {
  const actor = authorization.requireAuthenticated();
  if (!actor.sessionId) throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Session is required" });
  return actor.sessionId;
}
