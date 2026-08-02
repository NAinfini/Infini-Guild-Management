import { classTagSchema, type ClassTag } from "@guild/shared";
import { apiRequest } from "../client";

export async function fetchClassTags(): Promise<ClassTag[]> {
  const response = await apiRequest<unknown>("/api/class-tags");
  return classTagSchema.array().parse(response);
}
