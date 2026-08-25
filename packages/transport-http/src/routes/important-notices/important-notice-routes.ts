import {
  acknowledgeImportantNoticeSchema,
  createImportantNoticeSchema,
  importantNoticeAcknowledgementResponseSchema,
  importantNoticeAcknowledgementsResponseSchema,
  importantNoticeActiveResponseSchema,
  importantNoticeOkResponseSchema,
  importantNoticeSchema,
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
  | "listActive" | "listAcknowledgements" | "acknowledge"
>;

export function createImportantNoticeRoutes(
  dependencies: Readonly<{ service: ImportantNoticeHttpService }>,
): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/active", async (context) => context.json(importantNoticeActiveResponseSchema.parse({
    data: await dependencies.service.listActive(requestContext(context)),
  })));

  routes.get("/acknowledgements", async (context) => context.json(importantNoticeAcknowledgementsResponseSchema.parse({
    data: await dependencies.service.listAcknowledgements(requestContext(context)),
  })));

  routes.put("/:id/acknowledgement", async (context) => {
    const id = noticeIdSchema.parse(context.req.param("id"));
    const input = await parseJsonBody(
      context.req.raw,
      acknowledgeImportantNoticeSchema,
      "Invalid important notice acknowledgement payload",
    );
    return context.json(importantNoticeAcknowledgementResponseSchema.parse(
      await dependencies.service.acknowledge(requestContext(context), id, input.publication_revision),
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
