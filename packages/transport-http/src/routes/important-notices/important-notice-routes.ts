import {
  createImportantNoticeSchema,
  importantNoticeAcknowledgementResponseSchema,
  importantNoticeActiveResponseSchema,
  importantNoticeAudienceRolesResponseSchema,
  importantNoticeOkResponseSchema,
  importantNoticeReadResponseSchema,
  importantNoticeSchema,
  markImportantNoticesReadSchema,
  updateImportantNoticeSchema,
} from "@guild/shared";
import type { ImportantNoticeService } from "@guild/server/modules/important-notices";
import { Hono } from "hono";
import { z } from "zod";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { parseJsonBody } from "../../core/parsing.js";

const noticeIdSchema = z.string().min(1).max(200);

type ImportantNoticeHttpService = Pick<
  ImportantNoticeService,
  "listAdmin" | "getAdmin" | "create" | "update" | "publish" | "withdraw" | "delete"
  | "listAudienceRoles" | "listActive" | "markRead" | "acknowledge"
>;

export function createImportantNoticeRoutes(
  dependencies: Readonly<{ service: ImportantNoticeHttpService }>,
): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/active", async (context) => context.json(importantNoticeActiveResponseSchema.parse({
    data: await dependencies.service.listActive(requestContext(context)),
  })));

  routes.patch("/read", async (context) => context.json(importantNoticeReadResponseSchema.parse(
    await dependencies.service.markRead(
      requestContext(context),
      await parseJsonBody(context.req.raw, markImportantNoticesReadSchema, "Invalid important notice read payload"),
    ),
  )));

  routes.put("/:id/acknowledgement", async (context) => {
    const id = noticeIdSchema.parse(context.req.param("id"));
    return context.json(importantNoticeAcknowledgementResponseSchema.parse(
      await dependencies.service.acknowledge(requestContext(context), id),
    ));
  });

  return routes;
}

export function createAdminImportantNoticeRoutes(
  dependencies: Readonly<{ service: ImportantNoticeHttpService }>,
): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/", async (context) => context.json(z.array(importantNoticeSchema).parse(
    await dependencies.service.listAdmin(requestContext(context)),
  )));

  routes.get("/audience-roles", async (context) => context.json(importantNoticeAudienceRolesResponseSchema.parse({
    data: await dependencies.service.listAudienceRoles(requestContext(context)),
  })));

  routes.post("/", async (context) => context.json(importantNoticeSchema.parse(await dependencies.service.create(
    requestContext(context),
    await parseJsonBody(context.req.raw, createImportantNoticeSchema, "Invalid important notice payload"),
  )), 201));

  routes.get("/:id", async (context) => context.json(importantNoticeSchema.parse(
    await dependencies.service.getAdmin(requestContext(context), noticeIdSchema.parse(context.req.param("id"))),
  )));

  routes.patch("/:id", async (context) => context.json(importantNoticeSchema.parse(await dependencies.service.update(
    requestContext(context),
    noticeIdSchema.parse(context.req.param("id")),
    await parseJsonBody(context.req.raw, updateImportantNoticeSchema, "Invalid important notice payload"),
  ))));

  routes.post("/:id/publish", async (context) => context.json(importantNoticeSchema.parse(
    await dependencies.service.publish(requestContext(context), noticeIdSchema.parse(context.req.param("id"))),
  )));

  routes.post("/:id/withdraw", async (context) => context.json(importantNoticeSchema.parse(
    await dependencies.service.withdraw(requestContext(context), noticeIdSchema.parse(context.req.param("id"))),
  )));

  routes.delete("/:id", async (context) => context.json(importantNoticeOkResponseSchema.parse(
    await dependencies.service.delete(requestContext(context), noticeIdSchema.parse(context.req.param("id"))),
  )));

  return routes;
}
