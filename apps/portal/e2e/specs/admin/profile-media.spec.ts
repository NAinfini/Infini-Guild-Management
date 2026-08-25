import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, readJson, test, type Flow } from "../../support/test";
import { imageVariantsUpload, wavUpload, webpUpload } from "../../support/files";
import { confirmDialog, expectNoDialog, field } from "../../support/ui";

/*
 * 个人资料页「主页」屏的媒体卡：相册 / 视频 / 音乐 三组，收在一条内嵌切换里；
 * 头像不在这张卡上——它的换/删入口长在顶上概览条的头像本身。
 *
 * 这几组走的不是同一条链路，用例的收尾方式也因此不同：
 *   - 相册、音乐、头像：控件直接调接口（上传 POST、删除 DELETE），点完就落库，
 *     不经过右下角的保存条。所以断言是「请求发出去 → 回读服务端，媒体 ID 真的多/少了一个」。
 *   - 视频：加/删/换序全是改本地草稿，只有保存按钮会写库。所以断言是
 *     「点的时候不碰网络 → 保存 → 回读服务端，顺序和内容都对得上」。
 * 只断言「点了没报错」在这两条链路上都验不出任何东西。
 *
 * 被测的是 admin 自己的资料。每条用例保存当前资料，新增媒体由 afterEach 删除，
 * 相册与视频两列再用一次 PATCH 整体写回，避免依赖种子数量或中途失败留下残留。
 */

const IMAGES_API = /^\/api\/users\/[^/]+\/media\/images$/;
const AUDIO_API = /^\/api\/users\/[^/]+\/media\/audio$/;
const AVATAR_API = /^\/api\/users\/[^/]+\/media\/avatar$/;
const SAVE_PROFILE = { method: "PATCH", path: /^\/api\/users\/[^/]+\/profile$/ } as const;

type Profile = {
  power: number;
  classes: string[];
  title_html: string | null;
  bio: string | null;
  images: string[];
  video_urls: string[];
  availability: Record<string, unknown> | null;
  avatar_media_id: string | null;
  audio_media_id: string | null;
  audio_name: string | null;
};

let userId: string;
let original: Profile;

test.beforeEach(async ({ page, api }) => {
  const listed = await readJson(await api.get("/api/users?page=1&limit=500"), "读取名单") as {
    data: Array<{ user: { id: string; display_name: string } }>;
  };
  const admin = listed.data.find((entry) => entry.user.display_name === "admin");
  expect(admin, "种子里必须有 admin，这一页编辑的就是当前会话本人").toBeTruthy();
  userId = admin!.user.id;
  original = await readProfile(api);

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Media", exact: true })).toBeVisible();
});

test.afterEach(async ({ api }) => {
  /* 头像和音乐不在 PATCH 的可写字段里，只能按各自的 DELETE 收尾；
     种子里两者都是 null，所以「当前有、原来没有」就一定是这条用例传上去的。 */
  const current = await readProfile(api);
  if (current.avatar_media_id && !original.avatar_media_id) {
    const response = await api.delete(`/api/users/${userId}/media/avatar`);
    expect(response.ok(), `清理头像返回 ${response.status()}: ${await response.text()}`).toBe(true);
  }
  if (current.audio_media_id && !original.audio_media_id) {
    const response = await api.delete(`/api/users/${userId}/media/audio`);
    expect(response.ok(), `清理音乐返回 ${response.status()}: ${await response.text()}`).toBe(true);
  }
  /* 相册里多出来的媒体要先删掉再改顺序：只把 images 写回种子值的话，
     对象还在桶里，run 结束时的站点指纹就对不上了。 */
  const leftovers = current.images.filter((mediaId) => !original.images.includes(mediaId));
  if (leftovers.length > 0) {
    const response = await api.delete(`/api/users/${userId}/media/images`, { data: { media_ids: leftovers } });
    expect(response.ok(), `清理相册返回 ${response.status()}: ${await response.text()}`).toBe(true);
  }

  const restored = await api.patch(`/api/users/${userId}/profile`, {
    data: {
      power: original.power,
      classes: original.classes,
      title_html: original.title_html,
      bio: original.bio,
      images: original.images,
      video_urls: original.video_urls,
      availability: original.availability,
    },
  });
  expect(restored.ok(), `还原资料返回 ${restored.status()}: ${await restored.text()}`).toBe(true);
});

async function readProfile(api: APIRequestContext): Promise<Profile> {
  const detail = await readJson(await api.get(`/api/users/${userId}`), "回读资料") as { profile: Profile };
  return detail.profile;
}

/*
 * 三组各自是一个 fieldset，legend 就是它的无障碍名（相册和视频的名字里带计数，
 * 所以按正则取）。「Add」「Delete」这类通用文案在三组之间重名，凡是组内的控件都
 * 要限定在自己这一组里取，否则按角色取会撞成 strict mode violation。
 */
function mediaGroup(page: Page, legend: RegExp): Locator {
  return page.locator(".profile-media__groups").getByRole("group", { name: legend });
}

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: "Save Profile", exact: true });
}

/** 点保存并等服务端确认；回读留给调用方，因为每条用例关心的字段不同。 */
async function save(page: Page, flow: Flow): Promise<void> {
  await expect(saveButton(page), "有未保存改动时才会出现保存条").toBeVisible();
  await flow.click(saveButton(page), SAVE_PROFILE);
  await expect(saveButton(page), "存完之后提示条必须收起来").toHaveCount(0);
}

function imageTiles(page: Page): Locator {
  return page.locator(".my-profile-split__editor [role='listitem']");
}

function videoRows(page: Page): Locator {
  return page.locator(".profile-video-row");
}

test("媒体卡：三组同时摊开，各自的计数就写在组名上", async ({ page }) => {
  /* 相册和视频的数量不点开就能读到，音乐挂没挂由那一行的曲名直接说清。 */
  await expect(mediaGroup(page, /^Gallery/)).toContainText(`Gallery ${original.images.length}`);
  await expect(imageTiles(page)).toHaveCount(original.images.length);

  await expect(mediaGroup(page, /^Videos/)).toContainText(`Videos ${original.video_urls.length}`);
  await expect(videoRows(page)).toHaveCount(original.video_urls.length);

  const music = mediaGroup(page, /^Music$/);
  await expect(music.getByRole("button", { name: "Select file", exact: true })).toBeVisible();
  await expect(music, "种子里没挂曲子，这一行要说明是空的而不是整行消失")
    .toContainText("No audio selected");

  await expect(
    mediaGroup(page, /^Avatar/),
    "头像的入口在概览条的头像上，这张卡里不该再有第二个",
  ).toHaveCount(0);
});

test("相册：上传一张真的多一张，取消删除不动手，确认删除才少一张", async ({ page, flow, api }) => {
  const fileName = `e2e-profile-${Date.now()}.webp`;
  await mediaGroup(page, /^Gallery/).locator("input[type='file']").setInputFiles(webpUpload(fileName));
  await expect(page.getByText("1 file selected")).toBeVisible();

  const uploaded = await flow.click(
    page.getByRole("button", { name: "Upload", exact: true }),
    { method: "POST", path: IMAGES_API },
  ) as { media_ids: string[] };
  const mediaId = uploaded.media_ids[0];
  expect(mediaId, "上传接口必须把新媒体 ID 回给前端").toMatch(/^[A-Za-z0-9_-]{21}$/);

  await expect(imageTiles(page), "上传成功后网格里要多一格").toHaveCount(original.images.length + 1);
  const afterUpload = await readProfile(api);
  expect(afterUpload.images, "新媒体 ID 要挂到资料上，而不是只存进桶里")
    .toEqual([...original.images, mediaId]);
  for (const variant of ["view", "full"] as const) {
    expect((await api.get(`/api/media/${mediaId}/${variant}`)).status(), `${variant} 必须可读`).toBe(200);
  }

  /* 删除是即时接口调用，不经过保存条；先验一遍「取消」真的什么都没做。 */
  const tile = page.locator(`[role='listitem'][aria-label="${mediaId}"]`);
  await tile.getByRole("button", { name: `Delete ${mediaId}`, exact: true }).click();
  const confirmRemove = await confirmDialog(page, "Remove image?");
  await flow.clickWithoutApi(confirmRemove.getByRole("button", { name: "Cancel", exact: true }));
  await expectNoDialog(page);
  await expect(imageTiles(page), "取消之后那一格还得在").toHaveCount(original.images.length + 1);

  await tile.getByRole("button", { name: `Delete ${mediaId}`, exact: true }).click();
  const confirmAgain = await confirmDialog(page, "Remove image?");
  await flow.click(
    confirmAgain.getByRole("button", { name: "Delete", exact: true }),
    { method: "DELETE", path: IMAGES_API },
  );

  await expect(imageTiles(page)).toHaveCount(original.images.length);
  expect((await readProfile(api)).images, "确认删除之后资料上的键也要跟着少一个")
    .toEqual(original.images);
});

test("相册拖拽换序：拖完出现保存条，保存后服务端的顺序跟着变", async ({ page, flow, api }) => {
  /* 用 canonical full/view 变体补到至少两张，换序不依赖种子相册当前有几张。 */
  const addedMediaIds: string[] = [];
  const needed = Math.max(0, 2 - original.images.length);
  for (let index = 0; index < needed; index += 1) {
    const uploaded = await readJson(
      await api.post(`/api/users/${userId}/media/images`, {
        multipart: imageVariantsUpload(`e2e-reorder-${Date.now()}-${index}.webp`),
      }),
      `补第 ${index + 1} 张图用于换序`,
    ) as { media_ids: string[] };
    const mediaId = uploaded.media_ids[0];
    expect(mediaId, "上传接口必须返回新增媒体 ID").toMatch(/^[A-Za-z0-9_-]{21}$/);
    addedMediaIds.push(mediaId!);
  }
  await page.reload();

  const before = [...original.images, ...addedMediaIds];
  expect(before.length, "补图后至少要有两格可供换序").toBeGreaterThanOrEqual(2);
  await expect(imageTiles(page)).toHaveCount(before.length);
  expect(await imageTiles(page).evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute("aria-label")),
  )).toEqual(before);

  const first = await imageTiles(page).first().boundingBox();
  const second = await imageTiles(page).nth(1).boundingBox();
  expect(first && second, "两格都要在视口里才拖得动").toBeTruthy();
  const firstCenter = { x: first!.x + first!.width / 2, y: first!.y + first!.height / 2 };
  const secondCenter = { x: second!.x + second!.width / 2, y: second!.y + second!.height / 2 };
  await page.mouse.move(firstCenter.x, firstCenter.y);
  await page.mouse.down();
  /* 分多步移动：motion 的 Reorder 靠指针位移驱动，一步跳到终点收不到中间的
     pointermove，换序不会发生。 */
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(
      firstCenter.x + ((secondCenter.x - firstCenter.x) * step) / 6,
      firstCenter.y + ((secondCenter.y - firstCenter.y) * step) / 6,
      { steps: 2 },
    );
  }
  await page.mouse.up();

  const after = [before[1]!, before[0]!, ...before.slice(2)];
  await expect
    .poll(
      () => imageTiles(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))),
      { message: "拖拽之后两格要换过来" },
    )
    .toEqual(after);

  await save(page, flow);
  expect((await readProfile(api)).images, "换序只改草稿，保存之后服务端才该跟着变")
    .toEqual(after);
});

test("视频：非白名单站点被挡下，回车能加，上移换序，删除后保存都落库", async ({ page, flow, api }) => {
  await expect(videoRows(page)).toHaveCount(original.video_urls.length);

  await field(page, "Videos").fill("https://example.com/not-a-video");
  await flow.clickWithoutApi(
    mediaGroup(page, /^Videos/).getByRole("button", { name: "Add", exact: true }),
  );
  /* 非白名单链接必须显示当前可操作错误，不能静默失败。 */
  await expect(
    page.getByText("Use a supported video link", { exact: true }),
    "站点不在白名单里就该说清楚，而不是静悄悄什么都不发生",
  ).toBeVisible();
  await expect(videoRows(page), "被挡下的链接不该进列表").toHaveCount(original.video_urls.length);
  await expect(saveButton(page), "什么都没改，就不该出现保存条").toHaveCount(0);

  const firstAdded = "https://www.youtube.com/watch?v=e2evid00001";
  const secondAdded = "https://www.youtube.com/watch?v=e2evid00002";
  for (const url of [firstAdded, secondAdded]) {
    await field(page, "Videos").fill(url);
    await field(page, "Videos").press("Enter");
  }
  await expect(videoRows(page)).toHaveCount(original.video_urls.length + 2);
  await expect(field(page, "Videos"), "加进列表之后输入框要清空").toHaveValue("");

  await save(page, flow);
  expect((await readProfile(api)).video_urls, "新链接按输入顺序排在原有链接后面")
    .toEqual([...original.video_urls, firstAdded, secondAdded]);

  /* 上移最后一条，只和前一条对调；不依赖开发种子预先放了几条视频。 */
  const lastRow = videoRows(page).nth(original.video_urls.length + 1);
  await flow.clickWithoutApi(lastRow.getByRole("button", { name: "Up", exact: true }));
  const swapped = [...original.video_urls, secondAdded, firstAdded];
  await expect(videoRows(page).nth(original.video_urls.length).locator(".profile-video-row__url"))
    .toHaveText(secondAdded);

  await save(page, flow);
  expect((await readProfile(api)).video_urls, "换序也要落库").toEqual(swapped);

  for (const url of [secondAdded, firstAdded]) {
    await flow.clickWithoutApi(
      videoRows(page).filter({ hasText: url }).getByRole("button", { name: "Delete", exact: true }),
    );
  }
  await expect(videoRows(page)).toHaveCount(original.video_urls.length);

  await save(page, flow);
  expect((await readProfile(api)).video_urls, "删掉的链接必须真的从库里消失")
    .toEqual(original.video_urls);
});

test("音乐：WAV 上传前先在浏览器里转成 Opus，删除后媒体 ID 回到空", async ({ page, flow, api }) => {
  expect(original.audio_media_id, "种子里 admin 没有音乐，这条用例从空开始").toBeNull();

  /* 选完就传，没有第二颗「上传」按钮可点。 */
  const uploaded = await flow.act(
    () => mediaGroup(page, /^Music$/).locator("input[type='file']")
      .setInputFiles(wavUpload(`e2e-music-${Date.now()}.wav`)),
    { method: "POST", path: AUDIO_API },
  ) as { media_id: string };
  expect(uploaded.media_id, "上传接口必须返回统一媒体 ID").toMatch(/^[A-Za-z0-9_-]{21}$/);

  const afterUpload = await readProfile(api);
  expect(afterUpload.audio_media_id, "上传成功后资料上要挂上媒体 ID").toBe(uploaded.media_id);
  expect(afterUpload.audio_name, "曲名由 D1 的显式字段保存，不能从对象路径猜").toMatch(/\.ogg$/);
  const audio = await api.get(`/api/media/${uploaded.media_id}/full`);
  expect(audio.status(), "音频 full 变体必须可读").toBe(200);
  expect(audio.headers()["content-type"]).toContain("audio/ogg");
  await expect(page.locator(".profile-media-chip-row"), "曲名要换成刚传上去的这一首")
    .toContainText(afterUpload.audio_name!);

  await page.locator(".profile-media-chip-row").getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = await confirmDialog(page, "Remove audio?");
  await flow.click(
    confirm.getByRole("button", { name: "Delete", exact: true }),
    { method: "DELETE", path: AUDIO_API },
  );

  await expect(page.locator(".profile-media-chip-row"), "删完这一行还在，只是回到空态")
    .toContainText("No audio selected");
  expect((await readProfile(api)).audio_media_id, "删除之后媒体 ID 必须回到空").toBeNull();
});

test("头像：概览条上的入口上传后落库，移除后回到空", async ({ page, flow, api }) => {
  expect(original.avatar_media_id, "种子里 admin 没有头像，这条用例从空开始").toBeNull();

  /* 入口长在概览条的头像上，平时收在 opacity:0 的一层里，鼠标移上去才显出来。 */
  const avatar = page.locator(".profile-overview__avatar");
  await avatar.hover();

  const uploaded = await flow.act(
    () => avatar.locator("input[type='file']")
      .setInputFiles(webpUpload(`e2e-avatar-${Date.now()}.webp`)),
    { method: "POST", path: AVATAR_API },
  ) as { media_id: string };

  expect((await readProfile(api)).avatar_media_id, "上传成功后资料上要挂上头像媒体 ID").toBe(uploaded.media_id);
  for (const variant of ["view", "full"] as const) {
    expect((await api.get(`/api/media/${uploaded.media_id}/${variant}`)).status(), `头像 ${variant} 必须可读`).toBe(200);
  }
  const removeAvatar = avatar.getByRole("button", { name: "Remove avatar", exact: true });
  await expect(removeAvatar, "有头像之后才该出现「移除头像」").toHaveCount(1);

  await avatar.hover();
  await removeAvatar.click();
  const confirm = await confirmDialog(page, "Remove avatar?");
  await flow.click(
    confirm.getByRole("button", { name: "Delete", exact: true }),
    { method: "DELETE", path: AVATAR_API },
  );

  await expect(removeAvatar, "移除之后这个按钮要跟着消失").toHaveCount(0);
  expect((await readProfile(api)).avatar_media_id, "移除之后媒体 ID 必须回到空").toBeNull();
});
