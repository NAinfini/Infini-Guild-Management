import type { Context } from "hono";
import type { Bindings } from "../index";
import { writeAuditLog, type WriteAuditLogInput } from "../services/audit";
import { publishEntityChanged, publishAnnouncementPublished } from "../services/push";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";

export function commonDeps(c: Context) {
  return {
    writeAuditLog: (input: WriteAuditLogInput) => writeAuditLog(c, input),
    publishEntityChanged: (payload: { entityType: PushEntityType; entityId: string; hint: PushHint; displayName?: string }) =>
      publishEntityChanged(c, payload),
  };
}

export function withMedia(c: Context) {
  return {
    ...commonDeps(c),
    media: (c.env as Bindings).MEDIA,
  };
}

export function withMediaAndPublishAnnouncement(c: Context) {
  return {
    ...withMedia(c),
    publishAnnouncementPublished: (payload: { announcementId: string; title: string; publishedAt?: string }) =>
      publishAnnouncementPublished(c, payload),
  };
}
