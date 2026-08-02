import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, dialogTitled, expectNoDialog } from "../../support/ui";

/*
 * Wiki 版本历史弹窗：版本列表、选版本、比较档（对当前 / 对上一版）、恢复。
 *
 * 版本号怎么来的必须先讲清，否则下面的期望值看着像凭空写的：
 * 建文章时落 r1；之后每次内容变化，服务端把「保存后的内容」再记一条
 * （WikiService.snapshotContentChange）。所以造三版正文就得到 r1/r2/r3，
 * 且 r3 的内容和当前文章完全一致——这正是「恢复」按钮该禁用的那种情况，
 * 服务端也会拒绝恢复一个和现状相同的版本（WikiService.ts:398）。
 *
 * 恢复是否成功一律回读服务端正文，不看提示条：接口 200 但没落库的话提示照样是绿的。
 *
 * 三版正文为什么是 kiwi/melon/papaya 这种怪词：差异区是逐行比完再对改动行做
 * diffChars（useWikiHistory.buildDiffBlocks），单行正文永远落进「modified」块，
 * 按字符拆成红绿片段拼在一起渲染。只要两版共用字符，旧文就不再是一段连续文本，
 * toContainText 会莫名其妙地找不到。这三个词两两之间一个字符都不重合，
 * diffChars 只能整段删、整段加，断言才对得上肉眼看到的东西。带 stamp 的编号
 * 也不能加进正文——数字是两版共用的，同样会把词切碎。
 */

const REVISIONS = { method: "GET", path: /^\/api\/wiki\/articles\/[^/]+\/revisions$/ } as const;
const REVISION_DETAIL = { method: "GET", path: /^\/api\/wiki\/articles\/[^/]+\/revisions\/\d+$/ } as const;
const RESTORE = { method: "POST", path: /^\/api\/wiki\/articles\/[^/]+\/revisions\/\d+\/restore$/ } as const;

type ArticleDetail = { id: string; title: string; slug: string; body_json: string };

const v1 = "kiwi";
const v2 = "melon";
const v3 = "papaya";

let stamp: number;
let category: { id: string; name: string };
let article: ArticleDetail;

test.beforeEach(async ({ api, page }) => {
  stamp = Date.now();

  category = await createCategory(api, `${SYSTEM_TEST_CONTENT_MARKER} Cat ${stamp}`);
  article = await readJson(
    await api.post("/api/wiki/articles", {
      data: {
        title: `${SYSTEM_TEST_CONTENT_MARKER} History ${stamp}`,
        category_id: category.id,
        body_json: bodyJson(v1),
      },
    }),
    "创建带历史的文章",
  ) as ArticleDetail;

  for (const text of [v2, v3]) {
    await readJson(
      await api.patch(`/api/wiki/articles/${article.id}`, { data: { body_json: bodyJson(text) } }),
      `写入版本 ${text}`,
    );
  }

  const revisions = await readRevisions(api);
  expect(revisions.map((revision) => revision.revision), "前置条件：应当正好有 r1/r2/r3 三版")
    .toEqual([3, 2, 1]);

  await page.goto(`/wiki/${article.slug}`);
  await expect(page.locator(".wiki-article-reader-title")).toHaveText(article.title);
});

test.afterEach(async ({ api }) => {
  const removed = await api.delete(`/api/wiki/articles/${article.id}/permanent`);
  expect([200, 204, 404], `清理文章返回 ${removed.status()}`).toContain(removed.status());
  const removedCategory = await api.delete(`/api/wiki/categories/${category.id}`);
  expect([200, 204, 404], `清理分类返回 ${removedCategory.status()}`).toContain(removedCategory.status());
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

async function readRevisions(api: APIRequestContext): Promise<Array<{ revision: number; restored_from: number | null }>> {
  return await readJson(
    await api.get(`/api/wiki/articles/${article.id}/revisions`),
    "回读版本列表",
  ) as Array<{ revision: number; restored_from: number | null }>;
}

async function readBody(api: APIRequestContext): Promise<string> {
  const detail = await readJson(
    await api.get(`/api/wiki/articles/${article.slug}`),
    "回读文章正文",
  ) as ArticleDetail;
  return detail.body_json;
}

function modal(page: Page): Locator {
  return dialogTitled(page, "Version History");
}

function revisionRows(page: Page): Locator {
  return page.locator(".wiki-history-revision-row");
}

/*
 * 行文本是「Revision 3」「Latest」「By … at …」拼起来的一整串，中间没有分隔符，
 * 所以不能用 \b 收尾——「3」和后面的「L」都是单词字符，压根不构成边界，
 * 正则会一条都匹配不上，报出来却是「元素不存在」。用「后面不是数字」来收尾。
 */
function revisionRow(page: Page, revision: number): Locator {
  return revisionRows(page).filter({ hasText: new RegExp(`^Revision ${revision}(?!\\d)`) });
}

/*
 * 红绿片段没有类名，只有内联样式（WikiHistoryModal 的 ADDED_STYLE / REMOVED_STYLE），
 * 只能按 style 属性挑。删除段认删除线，新增段认绿色底——这两条是差异区的全部语义，
 * 不这么分就只能断言「文字都在」，那连红绿画反了都测不出来。
 */
function removedParts(page: Page): Locator {
  return modal(page).locator('span[style*="line-through"]');
}

function addedParts(page: Page): Locator {
  return modal(page).locator('span[style*="green"]');
}

function restoreButton(page: Page): Locator {
  return modal(page).getByRole("button", { name: "Restore this revision", exact: true });
}

function compareSegment(page: Page, label: string): Locator {
  return modal(page).locator("label.mantine-SegmentedControl-label")
    .filter({ hasText: new RegExp(`^${label}$`) });
}

async function openHistory(page: Page, flow: { click: (control: Locator, expected: typeof REVISIONS) => Promise<unknown> }): Promise<void> {
  await flow.click(page.getByRole("button", { name: "Version history", exact: true }), REVISIONS);
  await expect(modal(page)).toBeVisible();
  await expect(revisionRows(page)).toHaveCount(3);
}

test("打开历史：三版按新到旧列出，默认停在最新的一版", async ({ page, flow }) => {
  await openHistory(page, flow);

  await expect(revisionRows(page).nth(0), "最新的一版排在最上面").toContainText("Revision 3");
  await expect(revisionRows(page).nth(0)).toContainText("Latest");
  await expect(revisionRows(page).nth(2)).toContainText("Revision 1");
  await expect(
    revisionRow(page, 3),
    "默认应当选中最新的一版，否则一打开看到的差异不知道是谁跟谁比",
  ).toHaveClass(/wiki-history-revision-row--selected/);

  await expect(
    restoreButton(page),
    "最新版和当前文章一模一样，恢复它是空操作，服务端也会拒绝，按钮必须禁用",
  ).toBeDisabled();
});

test("选旧版本：拉这一版的快照，差异区同时给出删掉的旧文和现在的新文", async ({ page, flow }) => {
  await openHistory(page, flow);

  await flow.click(revisionRow(page, 1), REVISION_DETAIL);
  await expect(revisionRow(page, 1)).toHaveClass(/wiki-history-revision-row--selected/);

  await expect(removedParts(page), "r1 的旧正文要标成删除").toHaveText([v1]);
  await expect(addedParts(page), "当前正文要标成新增，作为对照一起显示").toHaveText([v3]);
  await expect(restoreButton(page), "内容和当前不同，才轮到恢复可用").toBeEnabled();
});

test("比较档：最老的一版没有上一版可比，中间版本切档后比的是相邻两版", async ({ page, flow }) => {
  await openHistory(page, flow);

  await flow.click(revisionRow(page, 1), REVISION_DETAIL);
  await expect(
    compareSegment(page, "Compare to previous"),
    "r1 前面没有版本了，这一档必须禁用而不是给个空白差异",
  ).toHaveAttribute("data-disabled", "true");

  await flow.click(revisionRow(page, 2), REVISION_DETAIL);
  /*
   * 切档不发请求：要比的上一版是 r1，上面那次点击已经把它取回来并留在查询缓存里，
   * 这一档只是换个对照对象重算差异。
   *
   * 原来这里写的是 flow.click(..., REVISION_DETAIL)，要求它必须发一发请求。
   * 它在本地一直是绿的，但绿得不对：REVISION_DETAIL 匹配任意 /revisions/<数字>，
   * 等到的其实是上一行那次点击迟到的响应，被算到了这个控件头上。CI 上时序一挪，
   * 这里没有请求可等，就挂成一条 45 秒超时——看着像页面卡住，实际是断言写错了。
   */
  await flow.clickWithoutApi(compareSegment(page, "Compare to previous"));

  await expect(modal(page), "比的是 r1 → r2，r1 的正文要在").toContainText(v1);
  await expect(modal(page), "r2 的正文要在").toContainText(v2);
  await expect(modal(page), "这一档不该把当前版本的正文混进来").not.toContainText(v3);
});

test("恢复：取消什么都不做，确认后正文回到旧版并多记一条来源", async ({ page, flow, api }) => {
  await openHistory(page, flow);
  await flow.click(revisionRow(page, 1), REVISION_DETAIL);

  await restoreButton(page).click();
  const dialog = await confirmDialog(page, "Restore Revision");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await readBody(api), "取消恢复不该动服务端").toContain(v3);
  await expect(modal(page), "取消之后历史弹窗要留着").toBeVisible();

  await restoreButton(page).click();
  await flow.click(
    (await confirmDialog(page, "Restore Revision")).getByRole("button", { name: "Restore this revision", exact: true }),
    RESTORE,
  );

  const restored = await readBody(api);
  expect(restored, "恢复之后正文必须真的换回 r1").toContain(v1);
  expect(restored, "旧正文不该还留着").not.toContain(v3);

  await expectNoDialog(page);
  await expect(
    page.locator(".wiki-article-reader-title"),
    "恢复完弹窗关掉，回到阅读态",
  ).toHaveText(article.title);

  const revisions = await readRevisions(api);
  expect(revisions[0]?.revision, "恢复本身要记成新的一版").toBe(4);
  expect(revisions[0]?.restored_from, "新版本要记下它是从哪一版恢复来的").toBe(1);
});
