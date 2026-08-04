import { z } from "zod";

/** A serialized JSON object, excluding arrays, null, and scalar JSON values. */
export function jsonObjectStringSchema(base: z.ZodString) {
  return base.refine((value) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }, { message: "Must be a valid JSON object" });
}
