import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import type { APIRequestContext } from "@playwright/test";
import { readJson } from "./test";

export type TestStorage = {
  id: string;
  name: string;
  categories: Array<{ id: string; name: string }>;
};

let counter = 0;

/** Create the smallest storage tree a spec needs through the tracked API path. */
export async function createTestStorage(
  api: APIRequestContext,
  label: string,
  categoryLabels: string[] = [],
): Promise<TestStorage> {
  counter += 1;
  const suffix = `${Date.now().toString(36)}-${counter}`;
  const name = `${SYSTEM_TEST_CONTENT_MARKER} ${label} ${suffix}`;
  const storage = await readJson(
    await api.post("/api/storage/storages", { data: { name, description: null } }),
    `创建一次性仓库 ${name}`,
  ) as { id: string };

  const categories = [] as TestStorage["categories"];
  for (const categoryLabel of categoryLabels) {
    const categoryName = `${SYSTEM_TEST_CONTENT_MARKER} ${categoryLabel} ${suffix}`;
    const category = await readJson(
      await api.post(`/api/storage/storages/${storage.id}/categories`, {
        data: { name: categoryName },
      }),
      `创建一次性分类 ${categoryName}`,
    ) as { id: string };
    categories.push({ id: category.id, name: categoryName });
  }

  return { id: storage.id, name, categories };
}
