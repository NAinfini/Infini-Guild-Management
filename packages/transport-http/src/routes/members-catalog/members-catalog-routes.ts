import type { MemberCatalogService } from "@guild/server/modules/members";
import {
  assignBadgeSchema,
  catalogRecordRevisionSchema,
  createClassCatalogItemSchema,
  createClassTagSchema,
  createMemberBadgeSchema,
  reorderClassCatalogSchema,
  reorderClassTagsSchema,
  reorderMemberBadgesSchema,
  deleteClassTagSchema,
  unassignBadgeSchema,
  updateClassCatalogItemSchema,
  updateClassTagSchema,
  updateMemberBadgeSchema,
} from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { Hono } from "hono";
import { requestContext, type HttpEnv } from "../../core/http-env.js";
import { parseFormData, parseImageUploads, parseJsonBody, validation } from "../../core/parsing.js";
import {
  presentBadge,
  presentBadgeAssigned,
  presentBadgeAssignments,
  presentBadgeDeleted,
  presentBadges,
  presentBadgeUnassigned,
  presentClass,
  presentClassDeleted,
  presentClasses,
  presentClassTag,
  presentClassTagDeleted,
  presentClassTags,
} from "../../presenters/members-catalog/members-catalog-presenter.js";

type CatalogHttpService = Pick<MemberCatalogService,
  | "listClasses" | "getClass" | "createClass" | "updateClass" | "reorderClasses"
  | "uploadClassIcon" | "deleteClassIcon" | "deleteClass"
  | "listClassTags" | "createClassTag" | "getClassTag" | "updateClassTag"
  | "reorderClassTags" | "deleteClassTag"
  | "listBadges" | "getBadge" | "createBadge" | "updateBadge" | "reorderBadges"
  | "deleteBadge" | "listBadgeAssignments" | "assignBadge" | "unassignBadge"
>;

export type MembersCatalogRoutesDependencies = Readonly<{ service: CatalogHttpService }>;

export function createClassRoutes(dependencies: MembersCatalogRoutesDependencies): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/", async (context) => {
    requestContext(context);
    return context.json(presentClasses(await dependencies.service.listClasses()));
  });
  routes.post("/", async (context) => context.json(presentClass(await dependencies.service.createClass(
    requestContext(context),
    await parseJsonBody(context.req.raw, createClassCatalogItemSchema, "Invalid class payload"),
  )), 201));
  routes.patch("/reorder", async (context) => context.json(presentClasses(await dependencies.service.reorderClasses(
    requestContext(context),
    await parseJsonBody(context.req.raw, reorderClassCatalogSchema, "Invalid class order payload"),
  ))));
  routes.get("/:id", async (context) => {
    requestContext(context);
    return context.json(presentClass(await dependencies.service.getClass(context.req.param("id"))));
  });
  routes.patch("/:id", async (context) => context.json(presentClass(await dependencies.service.updateClass(
    requestContext(context),
    context.req.param("id"),
    await parseJsonBody(context.req.raw, updateClassCatalogItemSchema, "Invalid class update payload"),
  ))));
  routes.post("/:id/icon", async (context) => {
    const request = requestContext(context);
    request.authorization.require(PERMISSION_ID.ADMIN_CLASSES_MANAGE);
    const form = await parseFormData(context.req.raw);
    const revision = catalogRecordRevisionSchema.safeParse({ expected_updated_at: form.get("expected_updated_at") });
    if (!revision.success) throw validation("Invalid class icon revision");
    const uploads = await parseImageUploads(form);
    if (uploads.length !== 1) throw validation("Exactly one class icon is required");
    return context.json(presentClass(await dependencies.service.uploadClassIcon(
      request, context.req.param("id"), uploads[0]!, revision.data.expected_updated_at,
    )), 201);
  });
  routes.delete("/:id/icon", async (context) => {
    const revision = await parseJsonBody(
      context.req.raw,
      catalogRecordRevisionSchema,
      "Invalid class icon revision",
    );
    return context.json(presentClass(await dependencies.service.deleteClassIcon(
      requestContext(context), context.req.param("id"), revision.expected_updated_at,
    )));
  });
  routes.delete("/:id", async (context) => {
    const revision = await parseJsonBody(context.req.raw, catalogRecordRevisionSchema, "Invalid class delete revision");
    return context.json(presentClassDeleted(await dependencies.service.deleteClass(
      requestContext(context), context.req.param("id"), revision.expected_updated_at,
    )));
  });

  return routes;
}

export function createClassTagRoutes(dependencies: MembersCatalogRoutesDependencies): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/", async (context) => {
    requestContext(context);
    return context.json(presentClassTags(await dependencies.service.listClassTags()));
  });
  routes.post("/", async (context) => context.json(presentClassTag(await dependencies.service.createClassTag(
    requestContext(context),
    await parseJsonBody(context.req.raw, createClassTagSchema, "Invalid class tag payload"),
  )), 201));
  routes.patch("/reorder", async (context) => context.json(presentClassTags(await dependencies.service.reorderClassTags(
    requestContext(context),
    await parseJsonBody(context.req.raw, reorderClassTagsSchema, "Invalid class tag order payload"),
  ))));
  routes.get("/:id", async (context) => {
    requestContext(context);
    return context.json(presentClassTag(await dependencies.service.getClassTag(context.req.param("id"))));
  });
  routes.patch("/:id", async (context) => context.json(presentClassTag(await dependencies.service.updateClassTag(
    requestContext(context),
    context.req.param("id"),
    await parseJsonBody(context.req.raw, updateClassTagSchema, "Invalid class tag update payload"),
  ))));
  routes.delete("/:id", async (context) => {
    const revision = await parseJsonBody(context.req.raw, deleteClassTagSchema, "Invalid class tag delete revision");
    return context.json(presentClassTagDeleted(await dependencies.service.deleteClassTag(
      requestContext(context), context.req.param("id"), revision.expected_updated_at, revision.expected_usage_count,
    )));
  });

  return routes;
}

export function createBadgeRoutes(dependencies: MembersCatalogRoutesDependencies): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/", async (context) => {
    requestContext(context);
    return context.json(presentBadges(await dependencies.service.listBadges()));
  });
  routes.post("/", async (context) => context.json(presentBadge(await dependencies.service.createBadge(
    requestContext(context),
    await parseJsonBody(context.req.raw, createMemberBadgeSchema, "Invalid badge payload"),
  )), 201));
  routes.patch("/reorder", async (context) => context.json(presentBadges(await dependencies.service.reorderBadges(
    requestContext(context),
    await parseJsonBody(context.req.raw, reorderMemberBadgesSchema, "Invalid badge order payload"),
  ))));
  routes.get("/:id/assignments", async (context) => context.json(presentBadgeAssignments(
    await dependencies.service.listBadgeAssignments(requestContext(context), context.req.param("id"), {
      limit: context.req.query("limit"),
      cursor: context.req.query("cursor"),
    }),
  )));
  routes.post("/:id/assign", async (context) => {
    const input = await parseJsonBody(context.req.raw, assignBadgeSchema, "Invalid badge assignment payload");
    return context.json(presentBadgeAssigned(await dependencies.service.assignBadge(
      requestContext(context), context.req.param("id"), input.user_ids,
    )));
  });
  routes.post("/:id/unassign", async (context) => {
    const input = await parseJsonBody(context.req.raw, unassignBadgeSchema, "Invalid badge unassignment payload");
    return context.json(presentBadgeUnassigned(await dependencies.service.unassignBadge(
      requestContext(context), context.req.param("id"), input.user_ids,
    )));
  });
  routes.get("/:id", async (context) => {
    requestContext(context);
    return context.json(presentBadge(await dependencies.service.getBadge(context.req.param("id"))));
  });
  routes.patch("/:id", async (context) => context.json(presentBadge(await dependencies.service.updateBadge(
    requestContext(context),
    context.req.param("id"),
    await parseJsonBody(context.req.raw, updateMemberBadgeSchema, "Invalid badge update payload"),
  ))));
  routes.delete("/:id", async (context) => {
    const revision = await parseJsonBody(context.req.raw, catalogRecordRevisionSchema, "Invalid badge delete revision");
    return context.json(presentBadgeDeleted(await dependencies.service.deleteBadge(
      requestContext(context), context.req.param("id"), revision.expected_updated_at,
    )));
  });

  return routes;
}
