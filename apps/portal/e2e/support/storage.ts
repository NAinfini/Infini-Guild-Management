import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import type { APIRequestContext } from "@playwright/test";
import { readJson } from "./test";

export type TestStorage = {
  id: string;
  name: string;
  structureRevision: number;
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
  ) as { id: string; structure_revision: number };

  const categories = [] as TestStorage["categories"];
  let structureRevision = storage.structure_revision;
  for (const categoryLabel of categoryLabels) {
    const categoryName = `${SYSTEM_TEST_CONTENT_MARKER} ${categoryLabel} ${suffix}`;
    const category = await readJson(
      await api.post(`/api/storage/storages/${storage.id}/categories`, {
        data: { name: categoryName, expected_structure_revision: structureRevision },
      }),
      `创建一次性分类 ${categoryName}`,
    ) as { category: { id: string; name: string }; structure_revision: number };
    categories.push({ id: category.category.id, name: category.category.name });
    structureRevision = category.structure_revision;
  }

  return { id: storage.id, name, structureRevision, categories };
}
