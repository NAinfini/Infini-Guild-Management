import { jsonObjectSchema, type JsonObject } from "@guild/shared";

export function serializeJsonObject(value: JsonObject | null | undefined): string | null {
  return value == null ? null : JSON.stringify(jsonObjectSchema.parse(value)) as string;
}

export function parseJsonObject(value: string | null): JsonObject | null {
  return value === null ? null : jsonObjectSchema.parse(JSON.parse(value) as unknown);
}
