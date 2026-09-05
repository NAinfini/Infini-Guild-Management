import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { imageVariantsUpload } from "../../support/files";
import { field, selectFilterOption } from "../../support/ui";

const GALLERY = { method: "GET", path: /^\/api\/gallery$/ } as const;

type Fixture = { id: string; title: string };

let stamp: number;
let video: Fixture;
let image: Fixture;

test.beforeEach(async ({ page, api }) => {
  stamp = Date.now();
  video = await createVideo(api, `${SYSTEM_TEST_CONTENT_MARKER} Video ${stamp}`);
  image = await createImage(api, `${SYSTEM_TEST_CONTENT_MARKER} Image ${stamp}`);
  await page.goto("/gallery");
  await expect(page.getByRole("list", { name: "Gallery items" })).toBeVisible();
});

test.afterEach(async ({ api }) => {
  const response = await api.post("/api/gallery/batch-delete", { data: { ids: [video.id, image.id] } });
  expect(response.status(), "清理画廊筛选样本必须成功").toBe(200);
});

async function createVideo(api: APIRequestContext, title: string): Promise<Fixture> {
  const data = await readJson(
    await api.post("/api/gallery/videos", {
      data: { type: "video", url: `https://youtu.be/filter-${stamp}`, title },
    }),
    `创建视频 ${title}`,
  ) as { id: string };
  return { id: data.id, title };
}

async function createImage(api: APIRequestContext, title: string): Promise<Fixture> {
  const data = await readJson(
    await api.post("/api/gallery/images", {
      multipart: { ...imageVariantsUpload(`gallery-filters-${stamp}.webp`), titles: title, descriptions: "" },
    }),
    `上传图片 ${title}`,
  ) as { data: Array<{ id: string }> };
  const id = data.data[0]?.id;
  expect(id).toBeTruthy();
  return { id: id!, title };
}

function cards(page: Page): Locator {
  return page.locator(".gallery-grid__item");
}

function card(page: Page, title: string): Locator {
  return cards(page).filter({ hasText: title });
}

test("画廊搜索和类型筛选走服务端，并在结果集变化时清掉批量选择", async ({ page, flow }) => {
  const search = field(page, "Search gallery title, description or uploader");
  await flow.act(() => search.fill(`  VIDEO ${stamp}  `), {
    ...GALLERY, query: { search: `video ${stamp}` },
  });
  await expect(search).toHaveValue(`  VIDEO ${stamp}  `);
  await expect(card(page, video.title)).toBeVisible();
  await expect(card(page, image.title)).toHaveCount(0);

  await flow.act(() => search.fill(String(stamp)), {
    ...GALLERY, query: { search: String(stamp) },
  });
  await expect(card(page, video.title)).toBeVisible();
  await expect(card(page, image.title)).toBeVisible();

  const selected = page.getByRole("checkbox", { name: `Select gallery item ${video.id}`, exact: true });
  await selected.check();
  const bulkDelete = page.getByRole("button", { name: "Delete Selected", exact: true });
  await expect(bulkDelete).toBeEnabled();

  await flow.act(
    () => selectFilterOption(page, page.locator(".gallery-filters"), "Filter gallery by type", "Image"),
    { ...GALLERY, query: { search: String(stamp), type: "image" } },
  );
  await expect(card(page, image.title)).toBeVisible();
  await expect(card(page, video.title)).toHaveCount(0);
  await expect(bulkDelete).toBeDisabled();
});
