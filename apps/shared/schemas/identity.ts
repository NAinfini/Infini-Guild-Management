import { z } from "zod";
import { LIMITS } from "../config/limits";

const { identityName } = LIMITS.content;

/** Public display names and login names share one portable identity contract. */
export const identityNameSchema = z.string()
  .min(identityName.min)
  .max(identityName.max)
  .regex(/^[a-zA-Z0-9_一-鿿]+$/);
