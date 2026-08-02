import {
  classTagSchema,
  type ClassTag,
  type CreateClassTagInput,
  type UpdateClassTagInput,
} from "@guild/shared";
import { apiRequest } from "../client";

export async function createClassTag(input: CreateClassTagInput): Promise<ClassTag> {
  return classTagSchema.parse(await apiRequest("/api/class-tags", {
    method: "POST",
    bodyJson: input,
  }));
}

export async function updateClassTag(id: string, input: UpdateClassTagInput): Promise<ClassTag> {
  return classTagSchema.parse(await apiRequest(`/api/class-tags/${encodeURIComponent(id)}`, {
    method: "PATCH",
    bodyJson: input,
  }));
}

export function deleteClassTag(id: string): Promise<{ deleted: true }> {
  return apiRequest(`/api/class-tags/${encodeURIComponent(id)}`, { method: "DELETE" });
}
