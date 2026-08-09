import { classCatalogItemSchema, type ClassCatalogItem } from "@guild/shared";
import { apiRequest } from "../client";

export async function fetchClassCatalog(): Promise<ClassCatalogItem[]> {
  const response = await apiRequest<unknown>("/api/classes");
  return classCatalogItemSchema.array().parse(response);
}
