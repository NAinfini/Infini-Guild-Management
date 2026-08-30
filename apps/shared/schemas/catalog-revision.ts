import { z } from "zod";

/** The derived token carries at most 200 small catalog rows and stays well below the JSON body limit. */
export const catalogRevisionTokenSchema = z.string().min(2).max(128_000);
export const catalogUpdatedAtSchema = z.string().datetime().max(64);
export const catalogRecordRevisionSchema = z.object({
  expected_updated_at: catalogUpdatedAtSchema,
}).strict();
