import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, readJson, test, type Flow } from "../../support/test";
import { field, topDialog } from "../../support/ui";

/*
 * 个人资料页「主页」屏的身份卡：战力、称号（纯文本 / 样式沙盒 / 清除）、
 * 职业编辑器、简介，以及右下角那条未保存提示里的保存按钮。
 *
 * 这一屏的所有编辑都只改本地草稿，只有保存按钮会写库
 * （useProfileMutations.ts:34，PATCH /api/users/:id/profile 一次提交七个字段）。
 * 所以每条用例都按同一个契约收尾：点保存 → 请求发出去且 2xx → 回读服务端确认
 * 那一项真的变了 → 提示条自己消失（isDirty 归零）。少任何一步都不算验过。
 *
 * 被测的是 admin 自己的资料——这一页只能编辑当前会话的人。改完必须还原，
 * 否则后面的用例会读到被改过的战力和职业。afterEach 用同一个 PATCH 把七个
 * 可写字段整体写回种子值；只写回改动过的那一个的话，中途失败的用例会留下残留。
 */

const SAVE_PROFILE = { method: "PATCH", path: /^\/api\/users\/[^/]+\/profile$/ } as const;

type Profile = {
  power: number;
  classes: string[];
  title_html: string | null;
  bio: string | null;
  images: string[];
  video_urls: string[];
  availability: Record<string, unknown> | null;
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
  await expect(page.getByRole("heading", { name: "Identity", exact: true })).toBeVisible();
});

test.afterEach(async ({ api }) => {
  const response = await api.patch(`/api/users/${userId}/profile`, {
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
  expect(response.ok(), `还原资料返回 ${response.status()}: ${await response.text()}`).toBe(true);
});

async function readProfile(api: APIRequestContext): Promise<Profile> {
  const detail = await readJson(await api.get(`/api/users/${userId}`), "回读资料") as { profile: Profile };
  return detail.profile;
}

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: "Save Profile", exact: true });
}

/** 点保存并等服务端确认；回读留给调用方，因为每条用例关心的字段不同。 */
async function save(page: Page, flow: Flow): Promise<void> {
  await expect(saveButton(page), "有未保存改动时才会出现保存条").toBeVisible();
  await flow.click(saveButton(page), SAVE_PROFILE);
  await expect(
    saveButton(page),
    "存完之后草稿和服务端已经一致，提示条必须收起来——否则用户永远不知道存没存上",
  ).toHaveCount(0);
}

function titleRender(page: Page): Locator {
  return page.locator(".profile-title__render");
}

function classPills(page: Page): Locator {
  return page.locator(".profile-class__pill");
}

test("战力与简介：改完出现保存条，一次提交两个字段都落库", async ({ page, flow, api }) => {
  await expect(saveButton(page), "刚进来没有任何改动，不该有保存条").toHaveCount(0);

  const nextPower = original.power + 1234;
  const nextBio = `E2E bio ${Date.now()}`;
  await field(page, "Power").fill(String(nextPower));
  await field(page, "Bio").fill(nextBio);

  await save(page, flow);

  const saved = await readProfile(api);
  expect(saved.power, "战力必须真的落库；只弹一个成功提示不算存上").toBe(nextPower);
  expect(saved.bio, "同一次提交里的另一个字段也要落库").toBe(nextBio);
});

test("称号：清除、纯文本输入、沙盒生成样式，三条路都能落库", async ({ page, flow, api }) => {
  /*
   * 起点显式设成「带样式」，不拿种子当前提：种子写的是 <p>Guild Leader</p>，
   * 而服务端的白名单清洗只留 span/b/strong/i/em/u/br，任何一次保存都会把 <p>
   * 削掉。于是这一栏的起始形态取决于这条用例之前谁存过一次，不可依赖。
   */
  const seeded = `E2E Seed ${Date.now()}`;
  const prepared = await api.patch(`/api/users/${userId}/profile`, {
    data: { title_html: `<span style="font-weight: 700">${seeded}</span>` },
  });
  expect(prepared.ok(), `预置带样式称号返回 ${prepared.status()}`).toBe(true);
  await page.reload();
  await expect(titleRender(page), "带标签的称号只给预览，不给当文本改").toContainText(seeded);

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(titleRender(page), "清掉标签之后应当换成可以直接改的输入框").toHaveCount(0);
  await expect(field(page, "Title"), "清除按钮要把内容一起清空").toHaveValue("");

  /*
   * 清空之后再开沙盒，验的是「从零开始」这条路：这时文本框里该是样例文案，
   * 控件也从默认值起步。带着现有称号进去是另一回事——那时文本和样式都会被读回
   * 控件（LabelStyleModal.tsx 的 readLabelSeed），由组件单测盯着。
   */
  await page.getByRole("button", { name: "Set title", exact: true }).click();
  const sandbox = topDialog(page);
  await expect(sandbox.getByRole("heading", { name: "HTML Title Sandbox", exact: true })).toBeVisible();

  const styledText = `E2E Styled ${Date.now()}`;
  await field(sandbox, "Label text input").fill(styledText);
  await sandbox.getByRole("button", { name: "Toggle italic", exact: true }).click();
  await sandbox.getByRole("button", { name: "Apply to my title", exact: true }).click();

  await expect(page.getByRole("dialog"), "应用之后弹窗该自己关掉").toHaveCount(0);
  await expect(titleRender(page), "应用回来的是带样式的称号，所以这一栏又变回预览").toContainText(styledText);

  await save(page, flow);
  const styled = await readProfile(api);
  expect(styled.title_html, "沙盒生成的 HTML 要整段落库").toContain(styledText);
  expect(styled.title_html, "斜体是在沙盒里选的，落库的 HTML 里必须带着它").toMatch(/font-style:\s*italic/i);

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  const plainTitle = `E2E Plain ${Date.now()}`;
  await field(page, "Title").fill(plainTitle);
  await save(page, flow);
  expect((await readProfile(api)).title_html, "纯文本称号要原样存下来，不该被包上标签").toBe(plainTitle);
});

test("职业编辑器：添加一个再删掉，两次保存的结果都对得上服务端", async ({ page, flow, api }) => {
  const catalog = await readJson(await api.get("/api/classes"), "读取职业目录") as Array<{ id: string; label: string }>;
  const addition = catalog.find((item) => !original.classes.includes(item.id));
  expect(addition, "目录里得有一个 admin 还没挂上的职业").toBeTruthy();

  await expect(classPills(page)).toHaveCount(original.classes.length);
  await page.locator("button.profile-class__add").click();
  /* 选中即添加：这个下拉没有确认按钮，onChange 里直接就把职业挂上去了。 */
  await field(page, "Select class").click();
  await page.getByRole("option", { name: addition!.label, exact: true }).click();
  await expect(classPills(page)).toHaveCount(original.classes.length + 1);

  await save(page, flow);
  const afterAdd = await readProfile(api);
  expect(afterAdd.classes, "新职业要落库，且原有的不能被顶掉")
    .toEqual([...original.classes, addition!.id]);

  await classPills(page)
    .filter({ hasText: addition!.label })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(classPills(page)).toHaveCount(original.classes.length);

  await save(page, flow);
  expect((await readProfile(api)).classes, "删掉的职业必须真的从库里消失").toEqual(original.classes);
});
