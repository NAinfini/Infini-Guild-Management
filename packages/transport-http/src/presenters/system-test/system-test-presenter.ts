import {
  systemTestCleanupResponseSchema,
  systemTestRunResponseSchema,
} from "@guild/shared/schemas/system-test";
import { z } from "zod";

const okSchema = z.object({ ok: z.literal(true) }).strict();

export function presentSystemTestRun(value: unknown): { run_id: string; fixture_id: string } {
  return systemTestRunResponseSchema.parse(value);
}

export function presentSystemTestCleanup(value: unknown): {
  ok: boolean;
  status: "running" | "cleaning" | "cleanup_failed" | "completed";
  attempts: number;
} {
  return systemTestCleanupResponseSchema.parse(value);
}

export function presentSystemTestOk(value: unknown): { ok: true } {
  return okSchema.parse(value);
}
