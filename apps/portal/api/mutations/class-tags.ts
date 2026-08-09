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

/* 整表重排，跟 reorderClassCatalog 同一套约定：带**完整**的 id 顺序上去，
   服务端按下标重写 sort_order 并把整张表回给我们。 */
export async function reorderClassTags(order: string[]): Promise<ClassTag[]> {
  return classTagSchema.array().parse(await apiRequest("/api/class-tags/reorder", {
    method: "PATCH",
    bodyJson: { order },
  }));
}

export function deleteClassTag(id: string): Promise<{ deleted: true }> {
  return apiRequest(`/api/class-tags/${encodeURIComponent(id)}`, { method: "DELETE" });
}
