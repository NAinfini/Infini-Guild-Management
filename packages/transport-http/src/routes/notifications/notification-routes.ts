import {
  inboxNotificationListResponseSchema,
  inboxNotificationMutationResponseSchema,
  inboxNotificationUnreadCountResponseSchema,
  markInboxNotificationsReadSchema,
  notificationPreferencesSchema,
  updateNotificationPreferencesSchema,
} from "@guild/shared";
import {
  decodeNotificationInboxCursor,
  type NotificationInboxService,
} from "@guild/server/modules/notifications";
import { Hono } from "hono";
import { z } from "zod";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { parseJsonBody, parseQuery } from "../../core/parsing.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(512).optional(),
}).strict();

type NotificationInboxHttpService = Pick<NotificationInboxService,
  "getUnreadCount" | "list" | "markRead" | "getPreferences" | "updatePreferences">;

export function createNotificationInboxRoutes(
  dependencies: Readonly<{ service: NotificationInboxHttpService }>,
): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/unread-count", async (context) => context.json(inboxNotificationUnreadCountResponseSchema.parse(
    await dependencies.service.getUnreadCount(requestContext(context)),
  )));

  routes.get("/", async (context) => {
    const query = parseQuery(context.req.raw, listQuerySchema, "Invalid notification query");
    return context.json(inboxNotificationListResponseSchema.parse(await dependencies.service.list(
      requestContext(context),
      { limit: query.limit, cursor: decodeNotificationInboxCursor(query.cursor) },
    )));
  });

  routes.get("/preferences", async (context) => context.json(notificationPreferencesSchema.parse(
    await dependencies.service.getPreferences(requestContext(context)),
  )));

  routes.patch("/preferences", async (context) => {
    const input = await parseJsonBody(
      context.req.raw,
      updateNotificationPreferencesSchema,
      "Invalid notification preferences",
    );
    return context.json(notificationPreferencesSchema.parse(
      await dependencies.service.updatePreferences(requestContext(context), input),
    ));
  });

  routes.patch("/read", async (context) => {
    const input = await parseJsonBody(
      context.req.raw,
      markInboxNotificationsReadSchema,
      "Invalid notification read payload",
    );
    return context.json(inboxNotificationMutationResponseSchema.parse(await dependencies.service.markRead(
      requestContext(context),
      { ids: input.all === true ? null : [...new Set(input.ids ?? [])] },
    )));
  });

  return routes;
}
