import { z } from "zod";
import { LIMITS } from "../config/limits";

const L = LIMITS.content;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const memberAbsenceSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  username: z.string().nullable(),
  start_date: isoDateSchema,
  end_date: isoDateSchema,
  note: z.string().max(L.absenceNote.max).nullable(),
  created_at: z.string(),
});

export const createMemberAbsenceSchema = z
  .object({
    start_date: isoDateSchema,
    end_date: isoDateSchema,
    note: z.string().trim().max(L.absenceNote.max).nullable().optional(),
  })
  .refine((value) => value.start_date <= value.end_date, {
    message: "end_date must not be before start_date",
    path: ["end_date"],
  })
  .refine(
    (value) => {
      const span = Date.parse(`${value.end_date}T00:00:00Z`) - Date.parse(`${value.start_date}T00:00:00Z`);
      return span <= L.absenceSpanDays.max * 24 * 60 * 60 * 1000;
    },
    { message: `Absence cannot span more than ${L.absenceSpanDays.max} days`, path: ["end_date"] },
  );

export type MemberAbsence = z.infer<typeof memberAbsenceSchema>;
export type CreateMemberAbsencePayload = z.input<typeof createMemberAbsenceSchema>;
