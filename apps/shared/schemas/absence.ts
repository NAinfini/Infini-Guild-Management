import { z } from "zod";
import { LIMITS } from "../config/limits";
import { roleIdSchema, roleMetadataSchema } from "./role";

const L = LIMITS.content;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export function inclusiveIsoDateSpanDays(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export const absenceWindowQuerySchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
}).strict()
  .refine(({ from, to }) => from <= to, {
    message: "to must not be before from",
    path: ["to"],
  })
  .refine(({ from, to }) => inclusiveIsoDateSpanDays(from, to) <= L.absenceSpanDays.max, {
    message: `Absence window cannot span more than ${L.absenceSpanDays.max} days`,
    path: ["to"],
  });

export const memberAbsenceSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  display_name: z.string().nullable(),
  role_id: roleIdSchema,
  start_date: isoDateSchema,
  end_date: isoDateSchema,
  note: z.string().max(L.absenceNote.max).nullable(),
  created_at: z.string(),
}).extend(roleMetadataSchema.shape);

export const redactedMemberAbsenceSchema = memberAbsenceSchema.extend({ note: z.null() });

export const createMemberAbsenceSchema = z
  .object({
    start_date: isoDateSchema,
    end_date: isoDateSchema,
    note: z.string().trim().max(L.absenceNote.max).nullable().optional(),
  })
  .refine((value) => value.start_date <= value.end_date, {
    message: "end_date must not be before start_date",
    path: ["end_date"],
  });

export type MemberAbsence = z.infer<typeof memberAbsenceSchema>;
export type CreateMemberAbsencePayload = z.input<typeof createMemberAbsenceSchema>;
