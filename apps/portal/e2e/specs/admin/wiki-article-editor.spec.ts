import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, expectNoDialog, field, selectOption } from "../../support/ui";

/*
 * Wiki 文章编辑器：进出编辑态、标题/分类/正文三个字段、置顶与归档两个「意图」按钮、
 * 保存、新建、退出（含丢弃确认）、删除。
 *
 * 这一页的编辑器有个容易被测漏的设计：置顶和归档不是点了就生效，
 * 而是先在前端记成 intent，等按保存时才一起进 PATCH（useWikiArticleEditor.ts:192-203）。
 * 所以每个 intent 按钮都要验两次：点的时候不许发请求，保存之后服务端字段真的变了。
 * 只断言按钮变色就等于什么都没验——它本来就只是个前端状态。
 *
 * 所有「保存成功」的判定一律回读服务端，不看提示条：提示是前端自己弹的，
 * 接口 200 但没落库的话，提示照样是绿的。
 */

const CREATE_ARTICLE = { method: "POST", path: /^\/api\/wiki\/articles$/ } as const;
const UPDATE_ARTICLE = { method: "PATCH", path: /^\/api\/wiki\/articles\/[^/]+$/ } as const;
const DELETE_ARTICLE = { method: "DELETE", path: /^\/api\/wiki\/articles\/[^/]+\/permanent$/ } as const;

type ArticleDetail = {
  id: string;
  title: string;
  slug: string;
  category_id: string;
  body_json: string;
  pinned: boolean;
  archived_at: string | null;
};

let stamp: number;
let categoryA: { id: string; name: string };
let categoryB: { id: string; name: string };
let article: { id: string; title: string; slug: string };

test.beforeEach(async ({ api }) => {
  stamp = Date.now();

  categoryA = await createCategory(api, `${SYSTEM_TEST_CONTENT_MARKER} CatA ${stamp}`);
  categoryB = await createCategory(api, `${SYSTEM_TEST_CONTENT_MARKER} CatB ${stamp}`);

  const created = await readJson(
    await api.post("/api/wiki/articles", {
      data: {
        title: `${SYSTEM_TEST_CONTENT_MARKER} Article ${stamp}`,
        category_id: categoryA.id,
        body_json: bodyJson("original body"),
      },
    }),
    "创建被编辑的文章",
  ) as ArticleDetail;
  article = { id: created.id, title: created.title, slug: created.slug };
});

function bodyJson(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

async function createCategory(api: APIRequestContext, name: string): Promise<{ id: string; name: string }> {
  const created = await readJson(
    await api.post("/api/wiki/categories", { data: { name } }),
    `创建分类 ${name}`,
  ) as { id: string };
  return { id: created.id, name };
}

async function readArticle(api: APIRequestContext, slug: string): Promise<ArticleDetail> {
  return await readJson(
    await api.get(`/api/wiki/articles/${slug}`),
    `回读文章 ${slug}`,
  ) as ArticleDetail;
}

/** 直接按 slug 进页面：省掉「先在列表里找到它」这段与本用例无关的操作。 */
async function openArticle(page: Page): Promise<void> {
  await page.goto(`/wiki/${article.slug}`);
  await expect(page.locator(".wiki-article-reader-title")).toHaveText(article.title);
}

async function openEditor(page: Page): Promise<void> {
  await openArticle(page);
  await page.getByRole("button", { name: "Edit Wiki", exact: true }).click();
  await expect(page.locator(".wiki-article-editor-card")).toBeVisible();
}

function titleField(page: Page): Locator {
  return field(page, "Wiki article title");
}

function bodyField(page: Page): Locator {
  return field(page, "Article body");
}

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: "Save", exact: true });
}

/**
 * 点控件，并要求它一个写请求都不发。
 *
 * 这里没有用 flow.clickWithoutApi（那条要求「一个 /api/ 请求都没有」）：
 * 文章列表和详情两个查询会因为窗口聚焦等原因在后台自己重取，那是 React Query 的行为，
 * 和被点的按钮无关，拿它当判据只会把用例变成随机红。
 * 这几个按钮真正的契约是「只记前端意图，不写服务端」，所以只盯写方法；
 * 服务端确实没变，紧接着还会被回读断言再钉一次。
 */
async function clickWithoutWrite(page: Page, action: () => Promise<void>): Promise<void> {
  const writes: string[] = [];
  const record = (request: Request): void => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/") && request.method() !== "GET") {
      writes.push(`${request.method()} ${pathname}`);
    }
  };
  page.on("request", record);
  try {
    await action();
  } finally {
    page.off("request", record);
  }
  expect(writes, "这个控件本应只改前端状态，却写了服务端").toEqual([]);
}

/** 把正文整段换成 text——TipTap 是 contenteditable，只能靠选中再输入。 */
async function replaceBody(page: Page, text: string): Promise<void> {
  await bodyField(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await expect(bodyField(page)).toContainText(text);
}

test("进出编辑态：铅笔进、退出回到阅读态，两个方向都不写服务端", async ({ page }) => {
  await openArticle(page);

  await clickWithoutWrite(page, async () => {
    await page.getByRole("button", { name: "Edit Wiki", exact: true }).click();
    await expect(page.locator(".wiki-article-editor-card")).toBeVisible();
  });
  await expect(titleField(page), "进编辑态时要把当前文章填进表单").toHaveValue(article.title);

  await clickWithoutWrite(page, async () => {
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(page.locator(".wiki-article-editor-card")).toHaveCount(0);
    await expect(page.locator(".wiki-article-reader-title")).toHaveText(article.title);
  });
});

test("保存：标题、分类、正文三处改动一起写回服务端", async ({ page, flow, api }) => {
  await openEditor(page);

  const nextTitle = `${SYSTEM_TEST_CONTENT_MARKER} Renamed ${stamp}`;
  await titleField(page).fill(nextTitle);
  await selectOption(page, "Wiki article category", categoryB.name);
  await replaceBody(page, `rewritten ${stamp}`);

  await flow.click(saveButton(page), UPDATE_ARTICLE);

  const saved = await readArticle(api, article.slug);
  expect(saved.title, "标题没写回服务端").toBe(nextTitle);
  expect(saved.category_id, "分类没写回服务端").toBe(categoryB.id);
  expect(saved.body_json, "正文没写回服务端").toContain(`rewritten ${stamp}`);
  expect(saved.body_json, "旧正文应当被整段替换掉").not.toContain("original body");
});

test("保存：标题清空时挡在前端，不写服务端", async ({ page, api }) => {
  await openEditor(page);
  await titleField(page).fill("   ");

  await clickWithoutWrite(page, async () => {
    await saveButton(page).click();
    await expect(page.locator(".mantine-Notification-description").filter({ hasText: "Article title is required." }))
      .toBeVisible();
  });

  const untouched = await readArticle(api, article.slug);
  expect(untouched.title, "被挡下的保存不该动到服务端").toBe(article.title);
});

test("置顶：点按钮只记意图，保存之后服务端才真的置顶", async ({ page, flow, api }) => {
  await openEditor(page);

  const pin = page.getByRole("button", { name: "Pin", exact: true });
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  const queued = page.getByRole("button", { name: "Pin (pending save)", exact: true });
  await clickWithoutWrite(page, async () => {
    await pin.click();
    await expect(queued, "意图要写在按钮上，否则用户不知道还没保存").toHaveAttribute("aria-pressed", "true");
  });
  expect((await readArticle(api, article.slug)).pinned, "还没保存，服务端不该有变化").toBe(false);

  await flow.click(saveButton(page), UPDATE_ARTICLE);
  expect((await readArticle(api, article.slug)).pinned, "保存后服务端必须置顶").toBe(true);

  // 再点一次是撤销置顶：同样先记意图，保存才生效。
  await clickWithoutWrite(page, async () => {
    await page.getByRole("button", { name: "Unpin", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unpin (pending save)", exact: true }))
      .toHaveAttribute("aria-pressed", "false");
  });
  await flow.click(saveButton(page), UPDATE_ARTICLE);
  expect((await readArticle(api, article.slug)).pinned, "取消置顶同样要落库").toBe(false);
});

test("归档：意图按钮 + 保存，归档时间落到服务端", async ({ page, flow, api }) => {
  await openEditor(page);

  await clickWithoutWrite(page, async () => {
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByRole("button", { name: "Archive (pending save)", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
  });
  expect((await readArticle(api, article.slug)).archived_at, "还没保存就不该有归档时间").toBeNull();

  await flow.click(saveButton(page), UPDATE_ARTICLE);
  expect((await readArticle(api, article.slug)).archived_at, "保存后必须写上归档时间").not.toBeNull();

  await clickWithoutWrite(page, async () => {
    await page.getByRole("button", { name: "Unarchive", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unarchive (pending save)", exact: true }))
      .toHaveAttribute("aria-pressed", "false");
  });
  await flow.click(saveButton(page), UPDATE_ARTICLE);
  expect((await readArticle(api, article.slug)).archived_at, "取消归档要把时间清回 null").toBeNull();
});

test("退出：有未保存改动时先问，取消留在编辑态，确认丢弃改动", async ({ page, api }) => {
  await openEditor(page);
  await titleField(page).fill(`${SYSTEM_TEST_CONTENT_MARKER} Dirty ${stamp}`);

  await page.getByRole("button", { name: "Exit", exact: true }).click();
  const dialog = await confirmDialog(page, "Discard unsaved changes?");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectNoDialog(page);
  await expect(page.locator(".wiki-article-editor-card"), "取消之后必须还在编辑态").toBeVisible();

  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await (await confirmDialog(page, "Discard unsaved changes?"))
    .getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.locator(".wiki-article-editor-card")).toHaveCount(0);

  expect((await readArticle(api, article.slug)).title, "丢弃的改动不该落库").toBe(article.title);
});

test("新建文章：加号进创建态，创建按钮真的建出一篇并跳过去", async ({ page, flow, api }) => {
  await openArticle(page);

  /* 列表卡上的加号和编辑器里的创建按钮同名，只能按所在卡片区分。 */
  await clickWithoutWrite(page, async () => {
    await page.locator(".wiki-article-list-card").getByRole("button", { name: "Create Article", exact: true }).click();
    await expect(titleField(page), "创建态的标题应当是空的").toHaveValue("");
  });

  const newTitle = `${SYSTEM_TEST_CONTENT_MARKER} Created ${stamp}`;
  await titleField(page).fill(newTitle);
  await selectOption(page, "Wiki article category", categoryB.name);

  const created = await flow.click(
    page.locator(".wiki-article-editor-card").getByRole("button", { name: "Create Article", exact: true }),
    CREATE_ARTICLE,
  ) as ArticleDetail;
  expect(created.title).toBe(newTitle);
  expect(created.category_id, "创建时选的分类要一起送出去").toBe(categoryB.id);

  const readBack = await readArticle(api, created.slug);
  expect(readBack.id, "服务端必须真的多出这一篇").toBe(created.id);

  /*
   * 建完这一跳会经过未保存改动拦截器。草稿不清干净的话，用户点完「创建」
   * 立刻被问「有未保存的改动，确定离开吗」，选 Stay 还会让地址栏停在
   * ?selection=none、和列表里已经选中的新文章对不上——刷新就丢。
   * 这两条断言就是钉住这个修复（useWikiArticleEditor.ts 的 resetDraft）。
   */
  await expectNoDialog(page);
  await expect(page, "建完要跳到新文章的地址").toHaveURL(new RegExp(`/wiki/${created.slug}$`));
});

test("删除：确认框拦一道，确认后服务端和列表一起消失", async ({ page, flow, api }) => {
  await openEditor(page);

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = await confirmDialog(page, "Delete Article");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectNoDialog(page);
  expect((await readArticle(api, article.slug)).id, "取消删除不该动服务端").toBe(article.id);

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await flow.click(
    (await confirmDialog(page, "Delete Article")).getByRole("button", { name: "Delete", exact: true }),
    DELETE_ARTICLE,
  );

  const gone = await api.get(`/api/wiki/articles/${article.slug}`);
  expect(gone.status(), "删除之后按 slug 应当查不到了").toBe(404);
  await expect(
    page.getByRole("button", { name: `Open wiki article ${article.title}`, exact: true }),
    "列表里也不该再留着它",
  ).toHaveCount(0);
});
