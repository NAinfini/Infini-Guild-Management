import type { APIRequestContext, Locator, Page, Response } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test, type Flow } from "../../support/test";
import { imageVariantsUpload, webpUpload } from "../../support/files";
import { confirmDialog, dialogTitled, expectNoDialog, field } from "../../support/ui";

/*
 * 画廊的媒体控件：添加媒体弹窗（图片队列 / 视频表单）、卡片上的删除、批量删除、灯箱。
 *
 * 每条用例都要求「请求发出去 + 服务端真的变了 + 界面跟着变」三件事同时成立。
 * 上传尤其不能只看界面：库里多一行不等于两个 R2 变体都存在，所以上传用例会拿返回的
 * media_id 分别读取 /view 与 /full——任一取不回来就是半成功，
 * 这种状态在界面上和成功一模一样。
 *
 * 素材都在用例内部现造，并按 id 记进 createdIds 由 afterEach 统一清掉：
 * 删除类用例会把自己的素材删光，清理时按 404 也算清干净。
 */

const GALLERY = { method: "GET", path: /^\/api\/gallery$/ } as const;
const CREATE_VIDEO = { method: "POST", path: /^\/api\/gallery\/videos$/ } as const;
const UPLOAD_IMAGES = { method: "POST", path: /^\/api\/gallery\/images$/ } as const;
const DELETE_ITEM = { method: "DELETE", path: /^\/api\/gallery\/[^/]+$/ } as const;
const BATCH_DELETE = { method: "POST", path: /^\/api\/gallery\/batch-delete$/ } as const;

type Fixture = { id: string; caption: string };
type StoredItem = {
  id: string;
  type: string;
  media_id: string | null;
  url: string | null;
  caption: string | null;
  uploaded_by: string;
};

let stamp: number;
let createdIds: string[];

test.beforeEach(async ({ page }) => {
  stamp = Date.now();
  createdIds = [];

  await page.goto("/gallery");
  await expect(page.getByRole("list", { name: "Gallery items" })).toBeVisible();
});

test.afterEach(async ({ api }) => {
  for (const id of createdIds) {
    const response = await api.delete(`/api/gallery/${id}`);
    expect([200, 204, 404], `清理画廊条目 ${id} 返回 ${response.status()}`)
      .toContain(response.status());
  }
});

async function createVideo(api: APIRequestContext, name: string): Promise<Fixture> {
  const caption = `${SYSTEM_TEST_CONTENT_MARKER} ${name} ${stamp}`;
  const created = await readJson(
    await api.post("/api/gallery/videos", {
      data: { type: "video", url: `https://youtu.be/e2e-${name.toLowerCase()}-${stamp}`, caption },
    }),
    `创建视频 ${caption}`,
  ) as { id: string };
  createdIds.push(created.id);
  return { id: created.id, caption };
}

async function uploadImage(api: APIRequestContext, name: string): Promise<Fixture> {
  const caption = `${SYSTEM_TEST_CONTENT_MARKER} ${name} ${stamp}`;
  const uploaded = await readJson(
    await api.post("/api/gallery/images", {
      multipart: {
        ...imageVariantsUpload(`gallery-${name.toLowerCase()}-${stamp}.webp`),
        captions: caption,
      },
    }),
    `上传图片 ${caption}`,
  ) as { data: Array<{ id: string }> };
  const id = uploaded.data[0]?.id;
  expect(id, "上传接口必须回一条图片记录").toBeTruthy();
  createdIds.push(id as string);
  return { id: id as string, caption };
}

/** 服务端回读：界面显示对不等于数据对。搜索词服务端会自己 lower，原样传即可。 */
async function listGallery(api: APIRequestContext, term: string): Promise<StoredItem[]> {
  const body = await readJson(
    await api.get(`/api/gallery?limit=50&search=${encodeURIComponent(term)}`),
    `回读画廊 ${term}`,
  ) as { data: StoredItem[] };
  return body.data;
}

function items(page: Page): Locator {
  return page.locator(".gallery-grid__item");
}

function itemByCaption(page: Page, caption: string): Locator {
  return items(page).filter({ hasText: caption });
}

function selectCheckbox(page: Page, id: string): Locator {
  return page.getByRole("checkbox", { name: `Select gallery item ${id}`, exact: true });
}

/** 把列表筛到本用例造的素材，顺带确认它们真的进了列表。 */
async function searchThisRun(page: Page, flow: Flow, expected: number): Promise<void> {
  await flow.act(
    () => field(page, "Search gallery caption or uploader").fill(String(stamp)),
    GALLERY,
  );
  await expect(items(page), `本用例造了 ${expected} 件素材，列表里就该有这么多`).toHaveCount(expected);
}

async function openAddMedia(page: Page, tab?: string): Promise<Locator> {
  await page.getByRole("button", { name: "Add Media", exact: true }).click();
  const modal = dialogTitled(page, "Add Media");
  await expect(modal).toBeVisible();
  if (tab) {
    await modal.getByRole("tab", { name: tab, exact: true }).click();
  }
  return modal;
}

/**
 * 断言这一步不产生任何写请求。
 * 不用 flow.clickWithoutApi 是因为它连 GET 也算数：React Query 的后台重取
 * 随时可能落在这半秒里，那不是被测控件干的，会把用例洗成偶发红。
 */
async function clickWithoutWrite(page: Page, control: Locator, quietMs = 500): Promise<void> {
  const writes: string[] = [];
  const record = (response: Response): void => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && response.request().method() !== "GET") {
      writes.push(`${response.request().method()} ${url.pathname}`);
    }
  };
  page.on("response", record);
  try {
    await control.click();
    await page.waitForTimeout(quietMs);
  } finally {
    page.off("response", record);
  }
  expect(writes, "这一步本不该产生任何写请求").toEqual([]);
}

test("添加视频：链接与说明落到服务端，弹窗关闭且草稿清空", async ({ page, flow, api }) => {
  const caption = `${SYSTEM_TEST_CONTENT_MARKER} Video ${stamp}`;
  const url = `https://youtu.be/e2e-video-${stamp}`;

  const modal = await openAddMedia(page, "Add Video");
  const submit = modal.getByRole("button", { name: "Add Video", exact: true });
  await expect(submit, "URL 是空的时候不该能提交").toBeDisabled();

  await field(modal, "Gallery video URL").fill(url);
  await field(modal, "Gallery video caption").fill(caption);

  const created = await flow.click(submit, CREATE_VIDEO) as StoredItem;
  createdIds.push(created.id);
  expect(created.type).toBe("video");
  expect(created.url, "链接要原样存下来，转 embed 是渲染时的事").toBe(url);
  expect(created.caption).toBe(caption);

  const stored = await listGallery(api, String(stamp));
  expect(stored.map((item) => item.id), "服务端必须真的多出这一条").toEqual([created.id]);

  await expectNoDialog(page);
  await expect(page.getByText("Video created")).toBeVisible();
  await expect(itemByCaption(page, caption), "列表要立刻刷新出这条视频").toBeVisible();

  const reopened = await openAddMedia(page, "Add Video");
  await expect(
    field(reopened, "Gallery video URL"),
    "创建成功后草稿要清空，否则再点一次提交会建出第二条一模一样的",
  ).toHaveValue("");
  await expect(field(reopened, "Gallery video caption")).toHaveValue("");
});

test("视频站点白名单：不能嵌入的域名当场拦下，一个写请求也不发", async ({ page }) => {
  const modal = await openAddMedia(page, "Add Video");
  await field(modal, "Gallery video URL").fill(`https://example.com/clip-${stamp}.mp4`);

  await clickWithoutWrite(page, modal.getByRole("button", { name: "Add Video", exact: true }));

  await expect(
    page.getByText("Unsupported video host. Only YouTube, Bilibili, Vimeo and TikTok links can be embedded."),
    "拦下来必须说清原因，而不是把 i18n 键原样漏给用户",
  ).toBeVisible();
  await expect(modal, "被拦下时弹窗要留在原地，用户才有机会改链接").toBeVisible();
});

test("图片上传：说明随图提交，库里有行、R2 里也要有对象", async ({ page, flow, api }) => {
  const caption = `${SYSTEM_TEST_CONTENT_MARKER} Upload ${stamp}`;
  const fileName = `gallery-upload-${stamp}.webp`;

  const modal = await openAddMedia(page);
  const uploadButton = modal.getByRole("button", { name: "Upload Images", exact: true });
  const clearDone = modal.getByRole("button", { name: "Clear Done", exact: true });
  await expect(uploadButton, "队列空着的时候不该能上传").toBeDisabled();
  await expect(clearDone, "没有完成项时也不该能清理").toBeDisabled();

  await modal.locator("input[type='file']").setInputFiles(webpUpload(fileName));
  await expect(modal.getByText("Upload Queue"), "选完文件要先在本地排队").toBeVisible();
  await expect(modal.getByText(fileName, { exact: true })).toBeVisible();
  await expect(uploadButton).toBeEnabled();

  await field(modal, `Caption for ${fileName}`).fill(caption);

  const uploaded = await flow.click(uploadButton, UPLOAD_IMAGES) as { data: StoredItem[] };
  expect(uploaded.data, "上传接口必须回一条记录").toHaveLength(1);
  const item = uploaded.data[0] as StoredItem;
  createdIds.push(item.id);
  expect(item.caption, "队列里填的说明要跟着这张图一起提交").toBe(caption);
  expect(item.media_id, "图片条目必须关联统一媒体 id").toMatch(/^[A-Za-z0-9_-]{21}$/);
  expect(item.url, "图片不再把 R2 key 暴露成 URL").toBeNull();

  const stored = await listGallery(api, String(stamp));
  expect(stored.map((row) => row.id), "服务端必须真的多出这一行").toEqual([item.id]);

  for (const variant of ["view", "full"] as const) {
    const object = await api.get(`/api/media/${item.media_id}/${variant}`);
    expect(object.status(), `${variant} 字节必须真的取得回来`).toBe(200);
    expect(object.headers()["content-type"]).toContain("image/webp");
  }

  await expect(uploadButton, "队列里没有待传项了，按钮该重新变灰").toBeDisabled();
  await expect(clearDone).toBeEnabled();
  await clearDone.click();
  await expect(modal.getByText("Upload Queue"), "清掉完成项之后队列该整个收起来").toHaveCount(0);

  await page.keyboard.press("Escape");
  await expectNoDialog(page);
  await expect(itemByCaption(page, caption), "关掉弹窗后新图要出现在墙上").toBeVisible();
});

test("非图片文件：进队列就报错，不给上传也不给重试，能从队列里拿走", async ({ page }) => {
  const fileName = `notes-${stamp}.txt`;
  const modal = await openAddMedia(page);

  await modal.locator("input[type='file']").setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });

  await expect(
    modal.getByText(`Unsupported file type: ${fileName}. Choose an image.`),
    "本地就该说清楚是哪个文件、为什么不行",
  ).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Upload Images", exact: true }),
    "队列里只有非法文件时不该能上传",
  ).toBeDisabled();
  await expect(
    modal.getByRole("button", { name: "Retry", exact: true }),
    "本地校验就过不了的文件，重试多少次都是同一个结果，不该给这个入口",
  ).toHaveCount(0);

  await modal.getByRole("button", { name: "Remove from queue", exact: true }).click();
  await expect(modal.getByText("Upload Queue"), "拿走最后一项之后队列该收起来").toHaveCount(0);
});

test("单条删除：确认之后服务端查不到，墙上也不该还留着", async ({ page, flow, api }) => {
  const doomed = await createVideo(api, "Doomed");
  const keeper = await createVideo(api, "Keeper");
  await searchThisRun(page, flow, 2);

  await itemByCaption(page, doomed.caption)
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  const dialog = await confirmDialog(page, "Delete this item?");
  await flow.click(dialog.getByRole("button", { name: "Delete", exact: true }), DELETE_ITEM);

  await expect(itemByCaption(page, doomed.caption)).toHaveCount(0);
  await expect(itemByCaption(page, keeper.caption), "只该删掉点中的那一条").toBeVisible();

  const stored = await listGallery(api, String(stamp));
  expect(stored.map((item) => item.id), "服务端只该剩另一条").toEqual([keeper.id]);
});

test("批量删除：勾几条就删几条，服务端报的条数要对得上", async ({ page, flow, api }) => {
  const first = await createVideo(api, "First");
  const second = await createVideo(api, "Second");
  const spared = await createVideo(api, "Spared");
  await searchThisRun(page, flow, 3);

  await selectCheckbox(page, first.id).check();
  await selectCheckbox(page, second.id).check();

  await page.getByRole("button", { name: "Delete Selected", exact: true }).click();
  const dialog = await confirmDialog(page, "Delete selected items?");
  await expect(
    dialog.getByText("Delete 2 selected gallery items? This action cannot be undone."),
    "确认框要把条数说出来，用户才知道自己勾了多少",
  ).toBeVisible();

  const result = await flow.click(
    dialog.getByRole("button", { name: "Confirm", exact: true }),
    BATCH_DELETE,
  ) as { deleted: number };
  expect(result.deleted, "服务端报的删除条数必须和勾选数一致").toBe(2);

  await expect(page.getByText("Deleted 2 gallery items.")).toBeVisible();
  await expect(items(page), "没勾的那一条要留下").toHaveCount(1);
  await expect(itemByCaption(page, spared.caption)).toBeVisible();

  const stored = await listGallery(api, String(stamp));
  expect(stored.map((item) => item.id), "服务端也只该剩没勾的那一条").toEqual([spared.id]);
});

test("灯箱：前后翻页、方向键、双击缩放、关闭", async ({ page, flow, api }) => {
  const older = await uploadImage(api, "Older");
  const newer = await uploadImage(api, "Newer");
  await searchThisRun(page, flow, 2);

  await itemByCaption(page, newer.caption)
    .getByRole("button", { name: /^Open image / })
    .click();

  const lightbox = page.locator(".gallery-lb");
  await expect(lightbox).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Gallery preview" }),
    "全屏预览必须被读屏当成有名字的对话框，否则打开后无从知道自己在哪",
  ).toBeVisible();

  const counter = lightbox.locator(".gallery-lb__count");
  await expect(counter).toHaveText("1 / 2");
  await expect(lightbox.locator(".gallery-lb__caption")).toHaveText(newer.caption);

  await lightbox.getByRole("button", { name: "Next item", exact: true }).click();
  await expect(counter).toHaveText("2 / 2");
  await expect(lightbox.locator(".gallery-lb__caption")).toHaveText(older.caption);

  await page.keyboard.press("ArrowRight");
  await expect(counter, "走到末尾再往后要绕回第一张").toHaveText("1 / 2");
  await page.keyboard.press("ArrowLeft");
  await expect(counter, "在第一张往前要绕到最后一张").toHaveText("2 / 2");

  await lightbox.getByRole("button", { name: "Previous item", exact: true }).click();
  await expect(counter).toHaveText("1 / 2");

  const image = lightbox.locator(".gallery-lb__img");
  await expect(image, "刚打开时是原始比例").toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await lightbox.locator(".gallery-lb__img-wrap").dblclick();
  await expect(image, "双击要放大").toHaveCSS("transform", "matrix(2.2, 0, 0, 2.2, 0, 0)");
  await lightbox.locator(".gallery-lb__img-wrap").dblclick();
  await expect(image, "再双击要复原").toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

  await lightbox.getByRole("button", { name: "Close", exact: true }).click();
  await expectNoDialog(page);
  await expect(itemByCaption(page, newer.caption), "关掉灯箱之后还该停在原来的列表上").toBeVisible();
});
