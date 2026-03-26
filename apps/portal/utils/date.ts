import { format, formatISO } from "date-fns";

export function toLocalDateTime(utcIso: string): string {
  return format(new Date(utcIso), "yyyy-MM-dd HH:mm");
}

export function toUtcIso(date: Date): string {
  return formatISO(date);
}
