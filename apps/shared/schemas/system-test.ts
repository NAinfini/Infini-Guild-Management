import { z } from "zod";

export const SYSTEM_TEST_ARTIFACT_TYPES = [
  "guild_war",
  "event",
  "recurring_template",
  "storage_batch",
  "storage_item",
  "storage_category",
  "storage",
  "wiki_article",
  "wiki_category",
  "announcement",
  "gallery_item",
  "badge",
  "invite_link",
  "member_absence",
  "user",
  "role",
  "class_tag",
  "class_catalog",
  "media_asset",
  "error_log",
  "audit_log",
] as const;

export type SystemTestArtifactType = (typeof SYSTEM_TEST_ARTIFACT_TYPES)[number];

export const systemTestRunStatusSchema = z.enum([
  "running",
  "cleaning",
  "cleanup_failed",
  "completed",
]);

export const systemTestRunResponseSchema = z.object({
  run_id: z.string().uuid(),
  fixture_id: z.string().uuid(),
}).strict();

export const systemTestCleanupResponseSchema = z.object({
  ok: z.boolean(),
  status: systemTestRunStatusSchema,
  attempts: z.number().int().nonnegative(),
}).strict();

export const systemTestSummarySchema = z.object({
  total: z.number().int().nonnegative().max(10_000),
  passed: z.number().int().nonnegative().max(10_000),
  failed: z.number().int().nonnegative().max(10_000),
  errors: z.array(z.object({
    category: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    method: z.string().min(1).max(16),
    path: z.string().min(1).max(2_048),
    status: z.number().int().min(100).max(599).nullable(),
    error: z.string().max(1_000).nullable(),
  }).strict()).max(10_000),
}).strict().superRefine((value, context) => {
  if (value.passed + value.failed !== value.total) {
    context.addIssue({ code: "custom", message: "passed + failed must equal total" });
  }
  if (value.errors.length !== value.failed) {
    context.addIssue({ code: "custom", message: "errors must contain every failed endpoint" });
  }
});

export type SystemTestSummary = z.infer<typeof systemTestSummarySchema>;
