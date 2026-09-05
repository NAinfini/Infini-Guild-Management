import type { WikiCategoryCatalog } from "@guild/shared/schemas/wiki";
import type { APIRequestContext } from "@playwright/test";
import { readJson } from "./test";

export async function createWikiCategory(api: APIRequestContext, name: string): Promise<WikiCategoryCatalog["categories"][number]> {
  return await readJson(
    await api.post("/api/wiki/categories", { data: { name } }),
    `创建分类 ${name}`,
  ) as WikiCategoryCatalog["categories"][number];
}
