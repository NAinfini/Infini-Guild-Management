import { z } from "zod";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const managedPrefixSchema = z.enum(["media/", "audit/"]);

export const blobReconciliationCheckpointSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("manifest"),
    checkpoint: z.string().min(1).max(4_096).optional(),
  }).strict(),
  z.object({
    phase: z.literal("inventory"),
    prefix: managedPrefixSchema,
    checkpoint: z.string().min(1).max(4_096).optional(),
  }).strict(),
]);

const manifestDescriptorSchema = z.object({
  source: z.enum(["media", "audit"]),
  source_id: z.string().min(1),
  object_key: z.string().min(1),
  byte_size: z.number().int().nonnegative(),
  content_type: z.string().min(1),
  sha256: sha256Schema,
}).strict();

const blobMetadataSchema = z.object({
  object_key: z.string().min(1),
  byte_size: z.number().int().nonnegative(),
  content_type: z.string().min(1),
  sha256: sha256Schema,
  etag: z.string(),
  last_modified: z.string().datetime(),
}).strict();

export const blobReconciliationFindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("missing_blob"), expected: manifestDescriptorSchema }).strict(),
  z.object({
    kind: z.literal("metadata_mismatch"),
    expected: manifestDescriptorSchema,
    actual: blobMetadataSchema,
  }).strict(),
  z.object({ kind: z.literal("orphan_candidate"), actual: blobMetadataSchema }).strict(),
]);

export const blobReconciliationResponseSchema = z.object({
  status: z.enum(["clean", "drift", "incomplete"]),
  scanned: z.number().int().nonnegative().max(50),
  findings: z.array(blobReconciliationFindingSchema).max(50),
  next_checkpoint: blobReconciliationCheckpointSchema.nullable(),
}).strict();

export type BlobReconciliationCheckpointWire = z.infer<typeof blobReconciliationCheckpointSchema>;
export type BlobReconciliationResponse = z.infer<typeof blobReconciliationResponseSchema>;
