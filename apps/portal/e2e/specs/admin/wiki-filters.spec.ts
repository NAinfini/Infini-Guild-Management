import type { APIRequestContext, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { field, selectFilterOption } from "../../support/ui";
import { createWikiCategory as createCategory } from "../../support/wiki";

const ARTICLES = { method: "GET", path: /^\/api\/wiki\/articles$/ } as const;

type Article = { id: string; title: string; slug: string };

let stamp: number;
let categoryA: { id: string; name: string };
let categoryB: { id: string; name: string };
let alpha: Article;
let archived: Article;

test.beforeEach(async ({ page, api }) => {
  stamp = Date.now();
  categoryA = await createCategory(api, `${SYSTEM_TEST_CONTENT_MARKER} CatA ${stamp}`);
  categoryB = await createCategory(api, `${SYSTEM_TEST_CONTENT_MARKER} CatB ${stamp}`);
  alpha = await createArticle(api, `${SYSTEM_TEST_CONTENT_MARKER} Alpha ${stamp}`, categoryA.id);
  archived = await createArticle(api, `${SYSTEM_TEST_CONTENT_MARKER} Archived ${stamp}`, categoryB.id);
  const etag = await readArticleEtag(api, archived.slug);
  await readJson(
    await api.patch(`/api/wiki/articles/${archived.id}`, {
      headers: { "If-Match": etag },
      data: { archived_at: new Date().toISOString() },
    }),
    "归档筛选样本",
  );
  await page.goto("/wiki");
  await expect(page.locator(".wiki-catalog")).toBeVisible();
});

async function createArticle(api: APIRequestContext, title: string, categoryId: string): Promise<Article> {
  const data = await readJson(
    await api.post("/api/wiki/articles", {
      data: {
        title,
        category_id: categoryId,
        body_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
        pinned: false,
      },
    }),
    `创建文章 ${title}`,
  ) as { id: string; slug: string };
  return { id: data.id, title, slug: data.slug };
}

async function readArticleEtag(api: APIRequestContext, slug: string): Promise<string> {
  const response = await api.get(`/api/wiki/articles/${slug}`);
  await readJson(response, `读取文章 ${slug}`);
  const etag = response.headers().etag;
  if (!etag) throw new Error(`文章 ${slug} 缺少 ETag`);
  return etag;
}

function article(page: Page, title: string) {
  return page.getByRole("button", { name: `Open wiki article ${title}`, exact: true });
}

test("Wiki 搜索、分类和归档状态都由服务端结果驱动", async ({ page, flow }) => {
  await flow.act(() => field(page, "Search wiki articles").fill(String(stamp)), {
    ...ARTICLES, query: { search: String(stamp) },
  });
  await expect(article(page, alpha.title)).toBeVisible();
  await expect(article(page, archived.title)).toHaveCount(0);

  await flow.act(() => page.getByRole("button", { name: categoryA.name, exact: true }).click(), {
    ...ARTICLES, query: { search: String(stamp), category_id: categoryA.id },
  });
  await expect(article(page, alpha.title)).toBeVisible();
  await expect(article(page, archived.title)).toHaveCount(0);

  await flow.act(
    () => selectFilterOption(page, page.locator(".wiki-page-toolbar"), "Article status", "Archived"),
    { ...ARTICLES, query: { search: String(stamp), category_id: categoryA.id, archived: "true" } },
  );
  await expect(article(page, alpha.title)).toHaveCount(0);
  await expect(article(page, archived.title)).toHaveCount(0);

  await page.getByRole("button", { name: categoryB.name, exact: true }).click();
  await expect(article(page, archived.title)).toBeVisible();
});
