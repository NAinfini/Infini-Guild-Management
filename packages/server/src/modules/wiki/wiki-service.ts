import {
  findRichTextProblem,
  LIMITS,
  type AuditChange,
  type BatchUpdateWikiCategoryItem,
  type PaginatedResponse,
  type WikiArticle,
  type WikiCategory,
  type WikiRevision,
  type WikiRevisionListItem,
} from "@guild/shared";
import type { DeferredTasks, NotificationPublisher, RequestContext } from "@guild/kernel";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { AppError } from "@guild/kernel";
import { nanoid } from "nanoid";
import { createAuditEvent, type AuditEventWrite } from "../audit/public.js";
import {
  canonicalizeRichTextMedia,
  extractRichTextMediaIds,
  type ImageUpload,
  type MediaService,
} from "../media/public.js";
import { assertPortableLikeSearch } from "../../portable-search.js";

const ARTICLE_MANAGE_PERMISSIONS = [
  PERMISSION_ID.WIKI_ARTICLES_CREATE,
  PERMISSION_ID.WIKI_ARTICLES_EDIT,
  PERMISSION_ID.WIKI_ARTICLES_ARCHIVE,
  PERMISSION_ID.WIKI_ARTICLES_DELETE,
] as const;

export type WikiSort = "curated" | "updated_desc" | "updated_asc";
export type WikiCategoryRecord = WikiCategory & Readonly<{ revisionToken: string }>;
export type WikiArticleRecord = WikiArticle & Readonly<{
  revisionToken: string;
  currentRevision: number;
  deletedAt: string | null;
  mediaIds: readonly string[];
}>;
export type WikiRevisionRecord = WikiRevision;

export type WikiRevisionListQuery = Readonly<{
  beforeRevision?: number;
  limit: number;
}>;

export type WikiArticleListQuery = Readonly<{
  page: number;
  limit: number;
  categoryIds: readonly string[];
  archived?: boolean;
  pinned?: boolean;
  search?: string;
  sort: WikiSort;
  canReadArchived: boolean;
}>;

export interface WikiStore {
  listCategories(): Promise<Readonly<{ records: readonly WikiCategoryRecord[]; stateToken: string }>>;
  createCategory(input: Readonly<{
    record: WikiCategoryRecord;
    expectedStateToken: string;
    stateToken: string;
    audit: AuditEventWrite;
  }>): Promise<"created" | "conflict" | "limit_reached">;
  updateCategories(input: Readonly<{
    records: readonly WikiCategoryRecord[];
    expectedStateToken: string;
    stateToken: string;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
  deleteCategory(input: Readonly<{
    id: string;
    expectedStateToken: string;
    stateToken: string;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
  listArticles(query: WikiArticleListQuery): Promise<PaginatedResponse<WikiArticle>>;
  getArticleBySlug(slug: string, canReadArchived: boolean): Promise<WikiArticleRecord | null>;
  getArticleById(id: string, includeDeleted?: boolean): Promise<WikiArticleRecord | null>;
  createArticle(input: Readonly<{
    record: WikiArticleRecord;
    initialRevision: WikiRevisionRecord;
    mediaIds: readonly string[];
    audit: AuditEventWrite;
  }>): Promise<void>;
  mutateArticle(input: Readonly<{
    record: WikiArticleRecord;
    expectedRevisionToken: string;
    revision: WikiRevisionRecord;
    mediaIds: readonly string[];
    audit: AuditEventWrite;
  }>): Promise<boolean>;
  listRevisions(articleId: string, query: WikiRevisionListQuery): Promise<readonly WikiRevisionListItem[]>;
  getRevision(articleId: string, revision: number): Promise<WikiRevisionRecord | null>;
  recordAudit(audit: AuditEventWrite): Promise<void>;
}

export type CreateWikiCategoryInput = Readonly<{
  name: string;
  slug?: string;
  sort_order: number;
  parent_id?: string | null;
}>;
export type UpdateWikiCategoryInput = Partial<CreateWikiCategoryInput>;
export type CreateWikiArticleInput = Readonly<{
  title: string;
  slug?: string;
  category_id: string;
  body_json: string;
  sort_order: number;
  pinned: boolean;
}>;
export type UpdateWikiArticleInput = Partial<CreateWikiArticleInput> & Readonly<{ archived_at?: string | null }>;

export class WikiService {
  constructor(
    private readonly store: WikiStore,
    private readonly media: MediaService,
    private readonly notifications: NotificationPublisher,
    private readonly deferred: DeferredTasks,
  ) {}

  async listCategories(): Promise<readonly WikiCategory[]> {
    return (await this.store.listCategories()).records.map(withoutCategoryRevision);
  }

  async createCategory(context: RequestContext, input: CreateWikiCategoryInput): Promise<WikiCategory> {
    context.authorization.require(PERMISSION_ID.WIKI_CATEGORIES_MANAGE);
    const tree = await this.store.listCategories();
    const parentId = input.parent_id ?? null;
    assertCategoryParent(tree.records, "new", parentId);
    const name = normalizeName(input.name, "Category name", 120);
    const record: WikiCategoryRecord = {
      id: nanoid(),
      name,
      slug: slugify(input.slug ?? name),
      sort_order: input.sort_order,
      parent_id: parentId,
      created_at: context.now,
      updated_at: context.now,
      revisionToken: crypto.randomUUID(),
    };
    const audit = createAuditEvent(context, {
      subjectType: "wiki_category",
      subjectId: record.id,
      subjectLabel: record.name,
      action: "create",
      context: [
        { field: "slug", value: { type: "code", value: record.slug } },
        { field: "sort_order", value: { type: "number", value: record.sort_order } },
        ...(parentId === null ? [] : [{
          field: "parent_id" as const,
          value: {
            type: "reference" as const,
            value: { id: parentId, label: tree.records.find(({ id }) => id === parentId)?.name ?? null },
          },
        }]),
      ],
    });
    const outcome = await this.store.createCategory({
      record,
      expectedStateToken: tree.stateToken,
      stateToken: crypto.randomUUID(),
      audit,
    });
    if (outcome === "conflict") throw conflict("Wiki category tree changed");
    if (outcome === "limit_reached") throw validation("Wiki category limit reached");
    this.publish(record.id, "category_created", context.now);
    return withoutCategoryRevision(record);
  }

  async updateCategory(context: RequestContext, id: string, input: UpdateWikiCategoryInput): Promise<WikiCategory> {
    context.authorization.require(PERMISSION_ID.WIKI_CATEGORIES_MANAGE);
    const tree = await this.store.listCategories();
    const existing = tree.records.find((category) => category.id === id);
    if (!existing) throw notFound("Wiki category not found");
    const projected = applyCategoryPatch(existing, input, context.now);
    assertProjectedCategoryTree(tree.records.map((category) => category.id === id ? projected : category));
    if (sameCategory(existing, projected)) return withoutCategoryRevision(existing);
    const audit = createAuditEvent(context, {
      subjectType: "wiki_category",
      subjectId: id,
      subjectLabel: projected.name,
      action: "update",
      changes: categoryChanges(existing, projected, categoryLabelMap(tree.records)),
    });
    if (!await this.store.updateCategories({
      records: [projected],
      expectedStateToken: tree.stateToken,
      stateToken: crypto.randomUUID(),
      audit,
    })) throw conflict("Wiki category tree changed");
    this.publish(id, "category_updated", projected.updated_at);
    return withoutCategoryRevision(projected);
  }

  async batchUpdateCategories(
    context: RequestContext,
    updates: readonly BatchUpdateWikiCategoryItem[],
  ): Promise<readonly WikiCategory[]> {
    context.authorization.require(PERMISSION_ID.WIKI_CATEGORIES_MANAGE);
    if (updates.length < 1 || updates.length > LIMITS.content.wikiCategoryBatch.max
      || new Set(updates.map(({ id }) => id)).size !== updates.length) {
      throw validation(`Category batch must contain 1 to ${LIMITS.content.wikiCategoryBatch.max} unique rows`);
    }
    const tree = await this.store.listCategories();
    const updateById = new Map(updates.map((update) => [update.id, update]));
    for (const id of updateById.keys()) {
      if (!tree.records.some((category) => category.id === id)) throw notFound(`Wiki category not found: ${id}`);
    }
    const projected = tree.records.map((category) => {
      const update = updateById.get(category.id);
      return update ? applyCategoryPatch(category, update, context.now) : category;
    });
    assertProjectedCategoryTree(projected);
    const changedRecords = projected.filter((category) => {
      const existing = tree.records.find(({ id }) => id === category.id)!;
      return !sameCategory(existing, category);
    });
    if (changedRecords.length === 0) return projected.map(withoutCategoryRevision);
    const audit = createAuditEvent(context, {
      subjectType: "wiki_category",
      subjectId: context.requestId,
      subjectLabel: null,
      action: "batch_update",
      context: [
        {
          field: "item_ids",
          value: {
            type: "list",
            value: changedRecords.map(({ id, name }) => ({
              type: "reference" as const,
              value: { id, label: name },
            })),
          },
        },
        // Renaming, re-parenting, and reordering all land here, so the log names which of them happened.
        {
          field: "changed_sections",
          value: {
            type: "list",
            value: categoryBatchSections(tree.records, changedRecords)
              .map((value) => ({ type: "code" as const, value })),
          },
        },
      ],
    });
    if (!await this.store.updateCategories({
      records: changedRecords,
      expectedStateToken: tree.stateToken,
      stateToken: crypto.randomUUID(),
      audit,
    })) throw conflict("Wiki category tree changed");
    this.publish("categories", "categories_updated", context.now);
    return projected.map(withoutCategoryRevision);
  }

  async deleteCategory(context: RequestContext, id: string): Promise<Readonly<{ ok: true }>> {
    context.authorization.require(PERMISSION_ID.WIKI_CATEGORIES_MANAGE);
    const tree = await this.store.listCategories();
    const existing = tree.records.find((category) => category.id === id);
    if (!existing) throw notFound("Wiki category not found");
    if (tree.records.some((category) => category.parent_id === id)) throw conflict("Category still has children");
    const audit = createAuditEvent(context, {
      subjectType: "wiki_category",
      subjectId: id,
      subjectLabel: existing.name,
      action: "delete",
      context: [
        { field: "slug", value: { type: "code", value: existing.slug } },
        { field: "sort_order", value: { type: "number", value: existing.sort_order } },
        { field: "parent_id", value: existing.parent_id === null
          ? { type: "null", value: null }
          : {
              type: "reference",
              value: {
                id: existing.parent_id,
                label: tree.records.find(({ id: categoryId }) => categoryId === existing.parent_id)?.name ?? null,
              },
            } },
      ],
    });
    if (!await this.store.deleteCategory({
      id,
      expectedStateToken: tree.stateToken,
      stateToken: crypto.randomUUID(),
      audit,
    })) throw conflict("Wiki category changed or is still in use");
    this.publish(id, "category_deleted", context.now);
    return { ok: true };
  }

  listArticles(context: RequestContext, query: Omit<WikiArticleListQuery, "canReadArchived">): Promise<PaginatedResponse<WikiArticle>> {
    assertPagination(query.page, query.limit);
    if (query.categoryIds.length > 100) throw validation("Maximum 100 category filters");
    assertPortableLikeSearch(query.search?.toLowerCase(), "Wiki search");
    const canReadArchived = canManageArticles(context);
    if (query.archived === true && !canReadArchived) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Archived wiki articles require management permission" });
    }
    return this.store.listArticles({ ...query, canReadArchived });
  }

  async getArticleBySlug(context: RequestContext, slug: string): Promise<WikiArticle> {
    const record = await this.store.getArticleBySlug(slug, canManageArticles(context));
    if (!record) throw notFound("Wiki article not found");
    return withoutArticleRevision(record);
  }

  async createArticle(context: RequestContext, input: CreateWikiArticleInput, requestOrigin: string): Promise<WikiArticle> {
    const actor = context.authorization.require(PERMISSION_ID.WIKI_ARTICLES_CREATE);
    const title = normalizeName(input.title, "Article title", 200);
    const bodyJson = this.canonicalizeBody(input.body_json, requestOrigin);
    const categoryLabels = await this.categoryLabels([input.category_id]);
    const mediaIds = extractRichTextMediaIds(bodyJson);
    const record: WikiArticleRecord = {
      id: nanoid(),
      title,
      slug: slugify(input.slug ?? title),
      category_id: input.category_id,
      body_json: bodyJson,
      sort_order: input.sort_order,
      pinned: input.pinned,
      archived_at: null,
      deletedAt: null,
      created_by: actor.userId,
      updated_by: null,
      updated_by_username: null,
      created_at: context.now,
      updated_at: context.now,
      revisionToken: crypto.randomUUID(),
      currentRevision: 1,
      mediaIds,
    };
    const audit = createAuditEvent(context, {
      subjectType: "wiki_article",
      subjectId: record.id,
      subjectLabel: record.title,
      action: "create",
      context: [
        {
          field: "category_id",
          value: {
            type: "reference",
            value: { id: record.category_id, label: categoryLabels.get(record.category_id) ?? null },
          },
        },
        { field: "slug", value: { type: "code", value: record.slug } },
        { field: "sort_order", value: { type: "number", value: record.sort_order } },
        { field: "pinned", value: { type: "boolean", value: record.pinned } },
        { field: "revision", value: { type: "number", value: record.currentRevision } },
      ],
    });
    await this.store.createArticle({
      record,
      initialRevision: revisionOf(record, actor.userId, null),
      mediaIds,
      audit,
    });
    this.publish(record.id, "article_created", context.now);
    return withoutArticleRevision(record);
  }

  async updateArticle(
    context: RequestContext,
    id: string,
    input: UpdateWikiArticleInput,
    requestOrigin: string,
    ifMatch?: string,
  ): Promise<WikiArticle> {
    const actor = context.authorization.require(PERMISSION_ID.WIKI_ARTICLES_EDIT);
    if (input.archived_at !== undefined) context.authorization.require(PERMISSION_ID.WIKI_ARTICLES_ARCHIVE);
    const existing = await this.store.getArticleById(id);
    if (!existing) throw notFound("Wiki article not found");
    if (ifMatch && ifMatch !== "*" && ifMatch !== wikiArticleEtag(existing)) throw conflict("Wiki article changed");
    const title = input.title === undefined ? existing.title : normalizeName(input.title, "Article title", 200);
    const bodyJson = input.body_json === undefined
      ? existing.body_json
      : this.canonicalizeBody(input.body_json, requestOrigin);
    const mediaIds = input.body_json === undefined ? existing.mediaIds : extractRichTextMediaIds(bodyJson);
    const record: WikiArticleRecord = {
      ...existing,
      title,
      slug: input.slug === undefined ? existing.slug : slugify(input.slug),
      category_id: input.category_id ?? existing.category_id,
      body_json: bodyJson,
      sort_order: input.sort_order ?? existing.sort_order,
      pinned: input.pinned ?? existing.pinned,
      archived_at: input.archived_at === undefined ? existing.archived_at : input.archived_at,
      deletedAt: existing.deletedAt,
      updated_by: actor.userId,
      updated_by_username: null,
      updated_at: monotonicTimestamp(context.now, existing.updated_at),
      revisionToken: crypto.randomUUID(),
      currentRevision: existing.currentRevision + 1,
      mediaIds,
    };
    if (!articleChanged(existing, record)) return withoutArticleRevision(existing);
    const categoryLabels = existing.category_id === record.category_id
      ? new Map<string, string>()
      : await this.categoryLabels([existing.category_id, record.category_id]);
    const audit = createAuditEvent(context, {
      subjectType: "wiki_article",
      subjectId: id,
      subjectLabel: record.title,
      action: "update",
      changes: articleChanges(existing, record, categoryLabels),
      context: input.body_json === undefined ? [] : [{
        field: "changed_sections",
        value: {
          type: "list",
          value: [{ type: "code", value: "body_json" }],
        },
      }],
    });
    if (!await this.store.mutateArticle({
      record,
      expectedRevisionToken: existing.revisionToken,
      revision: revisionOf(record, actor.userId, null),
      mediaIds,
      audit,
    })) throw conflict("Wiki article changed");
    this.publish(id, "article_updated", record.updated_at);
    return withoutArticleRevision(record);
  }

  async archiveArticle(context: RequestContext, id: string): Promise<Readonly<{ ok: true }>> {
    const actor = context.authorization.require(PERMISSION_ID.WIKI_ARTICLES_ARCHIVE);
    const existing = await this.store.getArticleById(id);
    if (!existing) throw notFound("Wiki article not found");
    if (existing.archived_at) return { ok: true };
    const record: WikiArticleRecord = {
      ...existing,
      archived_at: context.now,
      deletedAt: existing.deletedAt,
      updated_by: actor.userId,
      updated_by_username: null,
      updated_at: monotonicTimestamp(context.now, existing.updated_at),
      revisionToken: crypto.randomUUID(),
      currentRevision: existing.currentRevision + 1,
      mediaIds: existing.mediaIds,
    };
    const audit = createAuditEvent(context, {
      subjectType: "wiki_article",
      subjectId: id,
      subjectLabel: record.title,
      action: "archive",
      changes: [{
        field: "archived_at",
        before: { type: "null", value: null },
        after: { type: "datetime", value: record.archived_at! },
      }],
    });
    if (!await this.store.mutateArticle({
      record,
      expectedRevisionToken: existing.revisionToken,
      revision: revisionOf(record, actor.userId, null),
      mediaIds: record.mediaIds,
      audit,
    })) {
      throw conflict("Wiki article changed");
    }
    this.publish(id, "article_archived", record.updated_at);
    return { ok: true };
  }

  async deleteArticle(context: RequestContext, id: string): Promise<Readonly<{ ok: true }>> {
    const actor = context.authorization.require(PERMISSION_ID.WIKI_ARTICLES_DELETE);
    const existing = await this.store.getArticleById(id);
    if (!existing) throw notFound("Wiki article not found");
    const categoryLabels = await this.categoryLabels([existing.category_id]);
    const audit = createAuditEvent(context, {
      subjectType: "wiki_article",
      subjectId: id,
      subjectLabel: existing.title,
      action: "delete",
      context: [
        {
          field: "category_id",
          value: {
            type: "reference",
            value: { id: existing.category_id, label: categoryLabels.get(existing.category_id) ?? null },
          },
        },
        { field: "slug", value: { type: "code", value: existing.slug } },
        { field: "sort_order", value: { type: "number", value: existing.sort_order } },
        { field: "pinned", value: { type: "boolean", value: existing.pinned } },
        { field: "status", value: { type: "code", value: existing.archived_at === null ? "active" : "archived" } },
        { field: "revision", value: { type: "number", value: existing.currentRevision } },
      ],
    });
    const record: WikiArticleRecord = {
      ...existing,
      deletedAt: context.now,
      archived_at: existing.archived_at ?? context.now,
      updated_by: actor.userId,
      updated_by_username: null,
      updated_at: monotonicTimestamp(context.now, existing.updated_at),
      revisionToken: crypto.randomUUID(),
      currentRevision: existing.currentRevision + 1,
      mediaIds: existing.mediaIds,
    };
    if (!await this.store.mutateArticle({
      record,
      expectedRevisionToken: existing.revisionToken,
      revision: revisionOf(record, actor.userId, null),
      mediaIds: record.mediaIds,
      audit,
    })) throw conflict("Wiki article changed");
    this.publish(id, "article_deleted", context.now);
    return { ok: true };
  }

  async listRevisions(
    context: RequestContext,
    articleId: string,
    query: WikiRevisionListQuery = { limit: 50 },
  ): Promise<readonly WikiRevisionListItem[]> {
    context.authorization.require(PERMISSION_ID.WIKI_ARTICLES_EDIT);
    assertRevisionListQuery(query);
    if (!await this.store.getArticleById(articleId, true)) throw notFound("Wiki article not found");
    return this.store.listRevisions(articleId, query);
  }

  async getRevision(context: RequestContext, articleId: string, revision: number): Promise<WikiRevision> {
    context.authorization.require(PERMISSION_ID.WIKI_ARTICLES_EDIT);
    if (!Number.isInteger(revision) || revision < 1) throw validation("Invalid wiki revision");
    const record = await this.store.getRevision(articleId, revision);
    if (!record) throw notFound("Wiki revision not found");
    return record;
  }

  async restoreRevision(context: RequestContext, articleId: string, revisionNumber: number): Promise<WikiArticle> {
    const actor = context.authorization.require(PERMISSION_ID.WIKI_ARTICLES_EDIT);
    const [existing, snapshot] = await Promise.all([
      this.store.getArticleById(articleId, true),
      this.store.getRevision(articleId, revisionNumber),
    ]);
    if (!existing) throw notFound("Wiki article not found");
    if (!snapshot) throw notFound("Wiki revision not found");
    if (snapshot.archived_at !== existing.archived_at) context.authorization.require(PERMISSION_ID.WIKI_ARTICLES_ARCHIVE);
    if (snapshot.deleted_at !== existing.deletedAt) context.authorization.require(PERMISSION_ID.WIKI_ARTICLES_DELETE);
    if (sameArticleSnapshot(existing, snapshot)) {
      throw validation("Revision matches the current article");
    }
    const record: WikiArticleRecord = {
      ...existing,
      title: snapshot.title,
      slug: snapshot.slug,
      category_id: snapshot.category_id,
      body_json: snapshot.body_json,
      sort_order: snapshot.sort_order,
      pinned: snapshot.pinned,
      archived_at: snapshot.archived_at,
      deletedAt: snapshot.deleted_at,
      mediaIds: snapshot.media_ids,
      updated_by: actor.userId,
      updated_by_username: null,
      updated_at: monotonicTimestamp(context.now, existing.updated_at),
      revisionToken: crypto.randomUUID(),
      currentRevision: existing.currentRevision + 1,
    };
    const categoryLabels = existing.category_id === record.category_id
      ? new Map<string, string>()
      : await this.categoryLabels([existing.category_id, record.category_id]);
    const audit = createAuditEvent(context, {
      subjectType: "wiki_article",
      subjectId: articleId,
      subjectLabel: record.title,
      action: "rollback",
      changes: articleChanges(existing, record, categoryLabels),
      context: [
        { field: "restored_from", value: { type: "number", value: revisionNumber } },
        ...(existing.body_json === record.body_json ? [] : [{
          field: "changed_sections" as const,
          value: { type: "list" as const, value: [{ type: "code" as const, value: "body_json" }] },
        }]),
        ...(sameIds(existing.mediaIds, record.mediaIds) ? [] : [{
          field: "media_count" as const,
          value: { type: "number" as const, value: record.mediaIds.length },
        }]),
      ],
    });
    if (!await this.store.mutateArticle({
      record,
      expectedRevisionToken: existing.revisionToken,
      revision: revisionOf(record, actor.userId, revisionNumber),
      mediaIds: record.mediaIds,
      audit,
    })) throw conflict("Wiki article changed");
    this.publish(articleId, "article_updated", record.updated_at);
    return withoutArticleRevision(record);
  }

  async uploadArticleImages(
    context: RequestContext,
    articleId: string,
    uploads: readonly ImageUpload[],
    quota: number,
    maxBytes: number,
  ): Promise<Readonly<{ media_ids: readonly string[] }>> {
    context.authorization.require(PERMISSION_ID.WIKI_ARTICLES_EDIT);
    const article = await this.store.getArticleById(articleId);
    if (!article) throw notFound("Wiki article not found");
    if (uploads.length < 1 || uploads.length > quota) throw validation(`Wiki image quota is ${quota}`);
    const mediaIds = await this.media.uploadImages(context, "wiki_image", uploads, maxBytes);
    await this.store.recordAudit(createAuditEvent(context, {
      subjectType: "wiki_article",
      subjectId: articleId,
      subjectLabel: article.title,
      action: "upload_images",
      context: [{ field: "upload_count", value: { type: "number", value: mediaIds.length } }],
    }));
    return { media_ids: mediaIds };
  }

  private async categoryLabels(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const labels = categoryLabelMap((await this.store.listCategories()).records);
    const missing = [...new Set(ids)].filter((id) => !labels.has(id));
    if (missing.length > 0) throw notFound("Wiki category not found");
    return labels;
  }

  private canonicalizeBody(value: string, requestOrigin: string): string {
    const canonical = canonicalizeRichTextMedia(value, requestOrigin);
    const problem = findRichTextProblem(JSON.parse(canonical) as unknown);
    if (problem) throw validation(`Unsupported rich-text content: ${problem}`);
    return canonical;
  }

  private publish(id: string, hint: string, updatedAt: string): void {
    this.deferred.defer(() => this.notifications.publish({
      type: "entity_changed",
      entity_type: "wiki",
      entity_id: id,
      updated_at: updatedAt,
      hint,
    }));
  }
}

function applyCategoryPatch(
  existing: WikiCategoryRecord,
  input: UpdateWikiCategoryInput | BatchUpdateWikiCategoryItem,
  now: string,
): WikiCategoryRecord {
  return {
    ...existing,
    name: input.name === undefined ? existing.name : normalizeName(input.name, "Category name", 120),
    slug: "slug" in input && input.slug !== undefined ? slugify(input.slug) : existing.slug,
    sort_order: input.sort_order ?? existing.sort_order,
    parent_id: input.parent_id === undefined ? existing.parent_id : input.parent_id,
    updated_at: monotonicTimestamp(now, existing.updated_at),
    revisionToken: crypto.randomUUID(),
  };
}

function assertCategoryParent(records: readonly WikiCategoryRecord[], id: string, parentId: string | null): void {
  if (!parentId) return;
  if (parentId === id) throw validation("Category cannot be its own parent");
  const parent = records.find((category) => category.id === parentId);
  if (!parent) throw notFound("Parent category not found");
  if (parent.parent_id) throw validation("Wiki categories support one child level");
}

function assertProjectedCategoryTree(records: readonly WikiCategoryRecord[]): void {
  for (const category of records) {
    assertCategoryParent(records, category.id, category.parent_id);
    if (category.parent_id && records.some((candidate) => candidate.parent_id === category.id)) {
      throw validation("Category with children cannot become a child");
    }
  }
}

function revisionOf(record: WikiArticleRecord, actorUserId: string, restoredFrom: number | null): WikiRevisionRecord {
  return {
    id: nanoid(),
    article_id: record.id,
    revision: record.currentRevision,
    title: record.title,
    slug: record.slug,
    category_id: record.category_id,
    body_json: record.body_json,
    sort_order: record.sort_order,
    pinned: record.pinned,
    archived_at: record.archived_at,
    deleted_at: record.deletedAt,
    media_ids: [...record.mediaIds],
    edited_by: actorUserId,
    edited_by_username: null,
    restored_from: restoredFrom,
    created_at: record.updated_at,
  };
}

function normalizeName(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw validation(`${label} is invalid`);
  return normalized;
}

export function slugifyWiki(value: string): string {
  return slugify(value);
}

function slugify(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (normalized || `wiki-${nanoid(8)}`).slice(0, 120);
}

function articleChanged(before: WikiArticleRecord, after: WikiArticleRecord): boolean {
  return before.title !== after.title || before.slug !== after.slug || before.category_id !== after.category_id
    || before.body_json !== after.body_json || before.sort_order !== after.sort_order || before.pinned !== after.pinned
    || before.archived_at !== after.archived_at || before.deletedAt !== after.deletedAt
    || !sameIds(before.mediaIds, after.mediaIds);
}

function sameArticleSnapshot(article: WikiArticleRecord, revision: WikiRevisionRecord): boolean {
  return article.title === revision.title
    && article.slug === revision.slug
    && article.category_id === revision.category_id
    && article.body_json === revision.body_json
    && article.sort_order === revision.sort_order
    && article.pinned === revision.pinned
    && article.archived_at === revision.archived_at
    && article.deletedAt === revision.deleted_at
    && sameIds(article.mediaIds, revision.media_ids);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameCategory(before: WikiCategoryRecord, after: WikiCategoryRecord): boolean {
  return before.name === after.name && before.slug === after.slug && before.sort_order === after.sort_order
    && before.parent_id === after.parent_id;
}

function categoryBatchSections(
  before: readonly WikiCategoryRecord[],
  after: readonly WikiCategoryRecord[],
): readonly string[] {
  const previous = new Map(before.map((category) => [category.id, category]));
  const sections = new Set<string>();
  for (const category of after) {
    const existing = previous.get(category.id);
    if (!existing) continue;
    if (existing.name !== category.name) sections.add("name");
    if (existing.slug !== category.slug) sections.add("slug");
    if (existing.parent_id !== category.parent_id) sections.add("parent_id");
    if (existing.sort_order !== category.sort_order) sections.add("sort_order");
  }
  return [...sections];
}

function categoryLabelMap(records: readonly WikiCategoryRecord[]): ReadonlyMap<string, string> {
  return new Map(records.map(({ id, name }) => [id, name]));
}

function categoryChanges(
  before: WikiCategoryRecord,
  after: WikiCategoryRecord,
  labels: ReadonlyMap<string, string>,
): AuditChange[] {
  const changes: AuditChange[] = [];
  if (before.name !== after.name) changes.push({
    field: "name",
    before: { type: "text", value: before.name },
    after: { type: "text", value: after.name },
  });
  if (before.slug !== after.slug) changes.push({
    field: "slug",
    before: { type: "code", value: before.slug },
    after: { type: "code", value: after.slug },
  });
  if (before.sort_order !== after.sort_order) changes.push({
    field: "sort_order",
    before: { type: "number", value: before.sort_order },
    after: { type: "number", value: after.sort_order },
  });
  if (before.parent_id !== after.parent_id) changes.push({
    field: "parent_id",
    before: before.parent_id === null
      ? { type: "null", value: null }
      : { type: "reference", value: { id: before.parent_id, label: labels.get(before.parent_id) ?? null } },
    after: after.parent_id === null
      ? { type: "null", value: null }
      : { type: "reference", value: { id: after.parent_id, label: labels.get(after.parent_id) ?? null } },
  });
  return changes;
}

function articleChanges(
  before: WikiArticleRecord,
  after: WikiArticleRecord,
  labels: ReadonlyMap<string, string>,
): AuditChange[] {
  const changes: AuditChange[] = [];
  if (before.title !== after.title) changes.push({
    field: "title",
    before: { type: "text", value: before.title },
    after: { type: "text", value: after.title },
  });
  if (before.slug !== after.slug) changes.push({
    field: "slug",
    before: { type: "code", value: before.slug },
    after: { type: "code", value: after.slug },
  });
  if (before.category_id !== after.category_id) changes.push({
    field: "category_id",
    before: { type: "reference", value: { id: before.category_id, label: labels.get(before.category_id) ?? null } },
    after: { type: "reference", value: { id: after.category_id, label: labels.get(after.category_id) ?? null } },
  });
  if (before.sort_order !== after.sort_order) changes.push({
    field: "sort_order",
    before: { type: "number", value: before.sort_order },
    after: { type: "number", value: after.sort_order },
  });
  if (before.pinned !== after.pinned) changes.push({
    field: "pinned",
    before: { type: "boolean", value: before.pinned },
    after: { type: "boolean", value: after.pinned },
  });
  if (before.archived_at !== after.archived_at) changes.push({
    field: "archived_at",
    before: before.archived_at === null
      ? { type: "null", value: null }
      : { type: "datetime", value: before.archived_at },
    after: after.archived_at === null
      ? { type: "null", value: null }
      : { type: "datetime", value: after.archived_at },
  });
  return changes;
}

function canManageArticles(context: RequestContext): boolean {
  return ARTICLE_MANAGE_PERMISSIONS.some((permission) => context.authorization.has(permission));
}

function withoutCategoryRevision(record: WikiCategoryRecord): WikiCategory {
  const { revisionToken: _revisionToken, ...category } = record;
  return category;
}

function withoutArticleRevision(record: WikiArticleRecord): WikiArticle {
  const {
    revisionToken: _revisionToken,
    currentRevision: _currentRevision,
    deletedAt: _deletedAt,
    mediaIds: _mediaIds,
    ...article
  } = record;
  return article;
}

export function wikiArticleEtag(record: Pick<WikiArticleRecord, "id" | "updated_at">): string {
  return `"wiki-${record.id}-${record.updated_at}"`;
}

function assertPagination(page: number, limit: number): void {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw validation("Invalid wiki pagination");
  }
}

function assertRevisionListQuery(query: WikiRevisionListQuery): void {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50
    || (query.beforeRevision !== undefined
      && (!Number.isInteger(query.beforeRevision) || query.beforeRevision < 1))) {
    throw validation("Invalid wiki revision pagination");
  }
}

function monotonicTimestamp(now: string, previous: string): string {
  if (Date.parse(now) > Date.parse(previous)) return now;
  return new Date(Date.parse(previous) + 1).toISOString();
}

function validation(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}

function notFound(message: string): AppError {
  return new AppError({ code: "NOT_FOUND", status: 404, message });
}

function conflict(message: string): AppError {
  return new AppError({ code: "CONFLICT", status: 409, message });
}
