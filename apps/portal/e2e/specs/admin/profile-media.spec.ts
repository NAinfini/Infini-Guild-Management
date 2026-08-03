import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, readJson, test, type Flow } from "../../support/test";
import { wavUpload, webpUpload } from "../../support/files";
import { confirmDialog, expectNoDialog, field } from "../../support/ui";

/*
 * 个人资料页「主页」屏的媒体卡：相册 / 视频 / 音乐 / 头像 四组，收在一条内嵌切换里。
 *
 * 这四组走的不是同一条链路，用例的收尾方式也因此不同：
 *   - 相册、音乐、头像：控件直接调接口（上传 POST、删除 DELETE），点完就落库，
 *     不经过右下角的保存条。所以断言是「请求发出去 → 回读服务端，键真的多/少了一个」。
 *   - 视频：加/删/换序全是改本地草稿，只有保存按钮会写库。所以断言是
 *     「点的时候不碰网络 → 保存 → 回读服务端，顺序和内容都对得上」。
 * 只断言「点了没报错」在这两条链路上都验不出任何东西。
 *
 * 被测的是 admin 自己的资料。种子里 admin 的 avatar_key 与 audio_key 都是 null、
 * 相册只有一张（seed.ts:393 起），所以上传后删干净就能回到起点；相册与视频两列
 * 由 afterEach 用一次 PATCH 整体写回，避免中途失败留下残留。
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
  avatar_key: string | null;
  audio_key: string | null;
};

let userId: string;
let original: Profile;

test.beforeEach(async ({ page, api }) => {
  const listed = await readJson(await api.get("/api/users?page=1&limit=500"), "读取名单") as {
    data: Array<{ user: { id: string; username: string } }>;
  };
  const admin = listed.data.find((entry) => entry.user.username === "admin");
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
  if (current.avatar_key && !original.avatar_key) {
    const response = await api.delete(`/api/users/${userId}/media/avatar`);
    expect(response.ok(), `清理头像返回 ${response.status()}: ${await response.text()}`).toBe(true);
  }
  if (current.audio_key && !original.audio_key) {
    const response = await api.delete(`/api/users/${userId}/media/audio`);
    expect(response.ok(), `清理音乐返回 ${response.status()}: ${await response.text()}`).toBe(true);
  }
  /* 相册里多出来的键要先从 R2 删掉再改指针：只把 images 写回种子值的话，
     对象还在桶里，run 结束时的站点指纹就对不上了。 */
  const leftovers = current.images.filter((key) => !original.images.includes(key));
  if (leftovers.length > 0) {
    const response = await api.delete(`/api/users/${userId}/media/images`, { data: { keys: leftovers } });
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

/** 媒体卡的分组切换：Mantine 把 input 藏成 0×0，能点的是 label。 */
function sectionTab(page: Page, text: string): Locator {
  return page.locator(".profile-media__switch label").filter({ hasText: text });
}

function sectionInput(page: Page, value: string): Locator {
  return page.locator(`.profile-media__switch input[value="${value}"]`);
}

async function openSection(page: Page, text: string, value: string): Promise<void> {
  await sectionTab(page, text).click();
  await expect(sectionInput(page, value)).toBeChecked();
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

/*
 * 媒体卡的卡体。视频那一组的「Add」和身份卡里职业编辑器的「＋ Add」无障碍名
 * 一模一样，同屏共存，按角色取会直接撞成 strict mode violation——凡是这一卡内
 * 的通用文案控件，一律限定在这个作用域里取。
 */
function mediaBody(page: Page): Locator {
  return page.locator(".profile-media__body");
}

function imageTiles(page: Page): Locator {
  return page.locator(".my-profile-split__editor [role='listitem']");
}

function videoRows(page: Page): Locator {
  return page.locator(".profile-video-row");
}

test("分组切换：四组各自换内容，全程不碰网络", async ({ page, flow }) => {
  await expect(sectionInput(page, "images"), "默认停在相册").toBeChecked();
  await expect(imageTiles(page)).toHaveCount(original.images.length);

  await flow.clickWithoutApi(sectionTab(page, "Videos"));
  await expect(sectionInput(page, "videos")).toBeChecked();
  await expect(videoRows(page)).toHaveCount(original.video_urls.length);
  await expect(imageTiles(page), "切走之后相册那一组要收起来").toHaveCount(0);

  await flow.clickWithoutApi(sectionTab(page, "Music"));
  await expect(sectionInput(page, "audio")).toBeChecked();
  await expect(page.getByRole("button", { name: "Select file", exact: true })).toBeVisible();

  await flow.clickWithoutApi(sectionTab(page, "Avatar"));
  await expect(sectionInput(page, "avatar")).toBeChecked();
  await expect(page.getByRole("button", { name: "Upload avatar", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove avatar", exact: true }),
    "种子里没有头像，就不该出现「移除头像」",
  ).toHaveCount(0);
});

test("相册：上传一张真的多一张，取消删除不动手，确认删除才少一张", async ({ page, flow, api }) => {
  const fileName = `e2e-profile-${Date.now()}.webp`;
  await page.locator(".my-profile-split__editor input[type='file']").setInputFiles(webpUpload(fileName));
  await expect(page.getByText("1 file(s) selected")).toBeVisible();

  const uploaded = await flow.click(
    page.getByRole("button", { name: "Upload", exact: true }),
    { method: "POST", path: IMAGES_API },
  ) as { keys: string[] };
  const key = uploaded.keys[0];
  expect(key, "上传接口必须把新对象的键回给前端").toBeTruthy();

  await expect(imageTiles(page), "上传成功后网格里要多一格").toHaveCount(original.images.length + 1);
  const afterUpload = await readProfile(api);
  expect(afterUpload.images, "新键要挂到资料上，而不是只存进桶里")
    .toEqual([...original.images, key]);

  /* 删除是即时接口调用，不经过保存条；先验一遍「取消」真的什么都没做。 */
  const tile = page.locator(`[role='listitem'][aria-label="${key}"]`);
  await tile.getByRole("button", { name: `Delete ${key}`, exact: true }).click();
  const confirmRemove = await confirmDialog(page, "Remove image?");
  await flow.clickWithoutApi(confirmRemove.getByRole("button", { name: "Cancel", exact: true }));
  await expectNoDialog(page);
  await expect(imageTiles(page), "取消之后那一格还得在").toHaveCount(original.images.length + 1);

  await tile.getByRole("button", { name: `Delete ${key}`, exact: true }).click();
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
  /* 种子只给 admin 一张图，换序至少要两张。这一张走接口传，省下界面上的一轮等待；
     它和界面上传是同一个接口，链路本身由上一条用例负责验。 */
  const uploaded = await readJson(
    await api.post(`/api/users/${userId}/media/images`, {
      multipart: { files: webpUpload(`e2e-reorder-${Date.now()}.webp`) },
    }),
    "补一张图用于换序",
  ) as { keys: string[] };
  const addedKey = uploaded.keys[0]!;
  await page.reload();

  const before = [...original.images, addedKey];
  await expect(imageTiles(page)).toHaveCount(before.length);
  expect(await imageTiles(page).evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute("aria-label")),
  )).toEqual(before);

  const first = await imageTiles(page).first().boundingBox();
  const second = await imageTiles(page).nth(1).boundingBox();
  expect(first && second, "两格都要在视口里才拖得动").toBeTruthy();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  /* 分多步移动：motion 的 Reorder 靠指针位移驱动，一步跳到终点收不到中间的
     pointermove，换序不会发生。 */
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(
      first!.x + first!.width / 2 + ((second!.x - first!.x) * step) / 6,
      first!.y + first!.height / 2,
      { steps: 2 },
    );
  }
  await page.mouse.up();

  const after = [before[1], before[0]];
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
  await openSection(page, "Videos", "videos");
  await expect(videoRows(page)).toHaveCount(original.video_urls.length);

  await field(page, "Videos").fill("https://example.com/not-a-video");
  await flow.clickWithoutApi(mediaBody(page).getByRole("button", { name: "Add", exact: true }));
  /*
   * 弹出来的是 "Unsupported video host"，不是那句列了白名单的
   * message.videoHostAllowedOnly——后者是以「兜底文案」传进 showError 的，
   * 而 presentAppError 只在 ZodError / 接口错误时才用兜底，普通 Error 走的是
   * error.message（useAppError.ts:50）。这里按现状断言，那句更有用的文案
   * 目前谁也看不到，已记在问题清单里。
   */
  await expect(
    page.getByText("Unsupported video host"),
    "站点不在白名单里就该说清楚，而不是静悄悄什么都不发生",
  ).toBeVisible();
  await expect(videoRows(page), "被挡下的链接不该进列表").toHaveCount(original.video_urls.length);
  await expect(saveButton(page), "什么都没改，就不该出现保存条").toHaveCount(0);

  const added = "https://www.youtube.com/watch?v=e2e-profile-video";
  await field(page, "Videos").fill(added);
  await field(page, "Videos").press("Enter");
  await expect(videoRows(page)).toHaveCount(original.video_urls.length + 1);
  await expect(field(page, "Videos"), "加进列表之后输入框要清空").toHaveValue("");

  await save(page, flow);
  expect((await readProfile(api)).video_urls, "新链接排在原有的后面")
    .toEqual([...original.video_urls, added]);

  /* 上移：新加的那条排在最后，点它的「上」应当和前一条对调。 */
  const lastRow = videoRows(page).nth(original.video_urls.length);
  await flow.clickWithoutApi(lastRow.getByRole("button", { name: "Up", exact: true }));
  const swapped = [added, ...original.video_urls];
  await expect(videoRows(page).first().locator(".profile-video-row__url")).toHaveText(swapped[0]!);

  await save(page, flow);
  expect((await readProfile(api)).video_urls, "换序也要落库").toEqual(swapped);

  await flow.clickWithoutApi(
    videoRows(page).first().getByRole("button", { name: "Delete", exact: true }),
  );
  await expect(videoRows(page)).toHaveCount(original.video_urls.length);

  await save(page, flow);
  expect((await readProfile(api)).video_urls, "删掉的链接必须真的从库里消失")
    .toEqual(original.video_urls);
});

test("音乐：WAV 上传前先在浏览器里转成 Opus，删除后键回到空", async ({ page, flow, api }) => {
  await openSection(page, "Music", "audio");
  expect(original.audio_key, "种子里 admin 没有音乐，这条用例从空开始").toBeNull();

  /* 选完就传，跟头像那一组一样，没有第二颗「上传」按钮可点。 */
  const uploaded = await flow.act(
    () => page.locator(".my-profile-split__editor input[type='file']")
      .setInputFiles(wavUpload(`e2e-music-${Date.now()}.wav`)),
    { method: "POST", path: AUDIO_API },
  ) as { key: string };
  /*
   * 送上去的是 WAV，落库的键却是 .ogg：转码发生在浏览器里（convertAudioToOpus）。
   * 容器写死成 Ogg，不再按浏览器支持的格式协商，所以这里能钉一个确切的后缀——
   * 以前得写成 /\.(webm|ogg)$/ 来同时容纳 Chromium 和 Firefox。
   * 这一条同时钉住「音乐上传必须先转 Opus」这个契约。
   */
  expect(uploaded.key, "服务端存的不该还是 WAV").toMatch(/\.ogg$/);

  const afterUpload = await readProfile(api);
  expect(afterUpload.audio_key, "上传成功后资料上要挂上键").toBe(uploaded.key);
  await expect(sectionInput(page, "audio").locator("xpath=following-sibling::label[1]"), "切换条上的状态要跟着变")
    .toHaveText("Music ✓");

  await page.locator(".profile-media-chip-row").getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = await confirmDialog(page, "Remove audio?");
  await flow.click(
    confirm.getByRole("button", { name: "Delete", exact: true }),
    { method: "DELETE", path: AUDIO_API },
  );

  await expect(page.locator(".profile-media-chip-row")).toHaveCount(0);
  expect((await readProfile(api)).audio_key, "删除之后键必须回到空").toBeNull();
});

test("头像：上传后落库，移除后回到空", async ({ page, flow, api }) => {
  await openSection(page, "Avatar", "avatar");
  expect(original.avatar_key, "种子里 admin 没有头像，这条用例从空开始").toBeNull();

  const uploaded = await flow.act(
    () => page.locator(".my-profile-split__editor input[type='file']")
      .setInputFiles(webpUpload(`e2e-avatar-${Date.now()}.webp`)),
    { method: "POST", path: AVATAR_API },
  ) as { key: string };

  expect((await readProfile(api)).avatar_key, "上传成功后资料上要挂上头像键").toBe(uploaded.key);
  const removeAvatar = page.getByRole("button", { name: "Remove avatar", exact: true });
  await expect(removeAvatar, "有头像之后才该出现「移除头像」").toBeVisible();

  await removeAvatar.click();
  const confirm = await confirmDialog(page, "Remove avatar?");
  await flow.click(
    confirm.getByRole("button", { name: "Delete", exact: true }),
    { method: "DELETE", path: AVATAR_API },
  );

  await expect(removeAvatar, "移除之后这个按钮要跟着消失").toHaveCount(0);
  expect((await readProfile(api)).avatar_key, "移除之后键必须回到空").toBeNull();
});
