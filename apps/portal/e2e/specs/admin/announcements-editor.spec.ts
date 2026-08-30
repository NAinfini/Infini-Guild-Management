import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, expectNoDialog, field } from "../../support/ui";

/*
 * 公告详情卡的编辑器：进出编辑态、标题/正文、置顶、发布时间、
 * 发布 / 存草稿 / 定时发布三个收尾动作、删除、新建，以及脏着切换选中时的拦截。
 *
 * 这一页的收尾动作和 wiki 不一样：没有「保存」按钮，三个出口各自决定落库后的状态
 * （AnnouncementDetailCard.validateAndFinish → useAnnouncementsController.handleFinish）。
 * 所以每条用例都要回读服务端确认 status 真的变成了那一档——只看编辑器收起来了，
 * 等于把「前端关了个面板」当成了「后端存下了东西」。
 *
 * 置顶开关是纯前端意图：点了只改草稿，要等某个收尾动作才一起进 PATCH。
 * 因此它得验两次——点的时候不许写服务端，收尾之后服务端字段真的变了。
 *
 * 归档和永久删除都从打开编辑器时冻结同一份 ETag；确认框期间若远端已改动，
 * 服务端必须拒绝旧动作，不能用确认后的新快照替用户扩大授权。
 */

const CREATE = { method: "POST", path: /^\/api\/announcements$/ } as const;
const UPDATE = { method: "PATCH", path: /^\/api\/announcements\/[^/]+$/ } as const;
const ARCHIVE = { method: "DELETE", path: /^\/api\/announcements\/[^/]+$/ } as const;
const DELETE_PERMANENT = { method: "DELETE", path: /^\/api\/announcements\/[^/]+\/permanent$/ } as const;

type AnnouncementDetail = {
  id: string;
  title: string;
  category: "announcement" | "event" | "war" | "important";
  body_json: string;
  pinned: boolean;
  status: string;
  publish_at: string | null;
};

let stamp: number;
let target: AnnouncementDetail;
let other: AnnouncementDetail;
/** 用例自己新建的公告，afterEach 一并清掉。 */
let extraIds: string[];

test.beforeEach(async ({ api }) => {
  stamp = Date.now();
  extraIds = [];

  target = await createAnnouncement(api, `${SYSTEM_TEST_CONTENT_MARKER} Target ${stamp}`, "original body");
  other = await createAnnouncement(api, `${SYSTEM_TEST_CONTENT_MARKER} Other ${stamp}`, "other body");
});

test.afterEach(async ({ api }) => {
  for (const id of [target.id, other.id, ...extraIds]) {
    const detail = await api.get(`/api/announcements/${id}`);
    if (detail.status() === 404) continue;
    expect(detail.status(), `清理前回读公告 ${id}`).toBe(200);
    const etag = detail.headers().etag;
    expect(etag, `公告 ${id} 必须返回 ETag 供精确清理`).toBeTruthy();
    const response = await api.delete(`/api/announcements/${id}/permanent`, {
      headers: { "If-Match": etag as string },
    });
    expect([200, 204, 404], `清理公告 ${id} 返回 ${response.status()}`).toContain(response.status());
  }
});

function bodyJson(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

async function createAnnouncement(
  api: APIRequestContext,
  title: string,
  body: string,
): Promise<AnnouncementDetail> {
  return await readJson(
    await api.post("/api/announcements", {
      data: {
        title,
        category: "announcement",
        body_json: bodyJson(body),
        pinned: false,
        status: "draft",
      },
    }),
    `创建公告 ${title}`,
  ) as AnnouncementDetail;
}

async function readAnnouncement(api: APIRequestContext, id: string): Promise<AnnouncementDetail> {
  return await readJson(await api.get(`/api/announcements/${id}`), `回读公告 ${id}`) as AnnouncementDetail;
}

/** 直接按 id 进页面：省掉「先在列表里找到它」这段与本用例无关的操作。 */
async function openAnnouncement(page: Page, announcement: AnnouncementDetail): Promise<void> {
  await page.goto(`/announcements/${announcement.id}`);
  await expect(page.locator(".announcement-reader-title")).toHaveText(announcement.title);
}

async function openEditor(page: Page, announcement: AnnouncementDetail = target): Promise<void> {
  await openAnnouncement(page, announcement);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(titleField(page)).toHaveValue(announcement.title);
}

function titleField(page: Page): Locator {
  return field(page, "Announcement title");
}

function bodyField(page: Page): Locator {
  return field(page, "Body");
}

function publishButton(page: Page): Locator {
  return page.getByRole("button", { name: "Publish", exact: true });
}

/** 发布操作菜单给两个分支提供了明确的组合无障碍名。 */
function finishMenuTrigger(page: Page): Locator {
  return page.getByRole("button", { name: "Save as Draft / Schedule post", exact: true });
}

async function chooseFinish(page: Page, item: string): Promise<Locator> {
  await finishMenuTrigger(page).click();
  return page.getByRole("menuitem", { name: item, exact: true });
}

function items(page: Page): Locator {
  return page.locator(".announcements-catalog .content-preview-card--announcements");
}

function item(page: Page, title: string): Locator {
  return items(page).filter({ has: page.getByText(title, { exact: true }) });
}

/**
 * 点控件，并要求它一个写请求都不发。
 *
 * 没有用 flow.clickWithoutApi（那条要求「一个 /api/ 请求都没有」）：列表和详情两个查询
 * 会因为窗口聚焦等原因在后台自己重取，那是 React Query 的行为，和被点的按钮无关，
 * 拿它当判据只会把用例变成随机红。这几个控件真正的契约是「只改前端草稿，不写服务端」，
 * 所以只盯写方法；服务端确实没变，紧接着还会被回读断言再钉一次。
 */
async function clickWithoutWrite(page: Page, control: Locator): Promise<void> {
  const writes: string[] = [];
  const record = (request: Request): void => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/") && request.method() !== "GET") {
      writes.push(`${request.method()} ${pathname}`);
    }
  };
  page.on("request", record);
  try {
    await control.click();
    await page.waitForTimeout(500);
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

/**
 * 造一个 datetime-local 能接受的值（yyyy-MM-ddTHH:mm），偏移量按分钟给。
 *
 * 必须在浏览器里算，不能在 Node 里算：判断「是不是未来」的那段代码跑在页面上，
 * 用的是浏览器的本地时区（AnnouncementDetailCard.validateAndFinish）。
 * 跑用例的 Node 进程时区和浏览器不一定一致——本机就差了三小时，
 * 在 Node 里算出来的「一小时后」送进去正好是浏览器眼里的过去，用例会莫名其妙地红。
 */
function localDateTimeValue(page: Page, offsetMinutes: number): Promise<string> {
  return page.evaluate((offset) => {
    const at = new Date(Date.now() + offset * 60_000);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }, offsetMinutes);
}

test("进出编辑态：Edit 进、Cancel 出，改到一半的标题被还原，两个方向都不写服务端", async ({ page, api }) => {
  await openAnnouncement(page, target);

  await clickWithoutWrite(page, page.getByRole("button", { name: "Edit", exact: true }));
  await expect(titleField(page), "进编辑态要把当前公告填进表单").toHaveValue(target.title);
  await expect(page.getByText("Saved", { exact: true }), "还没动过，徽章应当是已保存").toBeVisible();

  await titleField(page).fill(`${SYSTEM_TEST_CONTENT_MARKER} Abandoned ${stamp}`);
  await expect(page.getByText("Unsaved", { exact: true }), "改了就要提示还没保存").toBeVisible();

  await clickWithoutWrite(page, page.getByRole("button", { name: "Cancel", exact: true }));
  await expect(page.locator(".announcement-reader-title"), "取消要回到阅读态").toHaveText(target.title);
  expect((await readAnnouncement(api, target.id)).title, "取消掉的改动不该落库").toBe(target.title);
});

test("发布：标题和正文一起写回，状态从草稿变成已发布", async ({ page, flow, api }) => {
  await openEditor(page);

  const nextTitle = `${SYSTEM_TEST_CONTENT_MARKER} Renamed ${stamp}`;
  await titleField(page).fill(nextTitle);
  await replaceBody(page, `rewritten ${stamp}`);

  await flow.click(publishButton(page), UPDATE);

  const saved = await readAnnouncement(api, target.id);
  expect(saved.title, "标题没写回服务端").toBe(nextTitle);
  expect(saved.body_json, "正文没写回服务端").toContain(`rewritten ${stamp}`);
  expect(saved.body_json, "旧正文应当被整段替换掉").not.toContain("original body");
  expect(saved.status, "发布必须把状态改成已发布").toBe("published");
  expect(saved.publish_at, "已发布的公告必须带上发布时间").not.toBeNull();

  await expect(page.locator(".announcement-reader-title"), "发布完要收起编辑器回到阅读态")
    .toHaveText(nextTitle);
});

test("未就绪：标题或正文空着时不给发布，三个出口一起禁用", async ({ page, api }) => {
  await openEditor(page);

  await titleField(page).fill("   ");
  await expect(publishButton(page), "标题空着不该能发布").toBeDisabled();
  await expect(finishMenuTrigger(page), "下拉里的另外两个出口同样要挡住").toBeDisabled();

  await titleField(page).fill(target.title);
  await expect(publishButton(page), "标题填回来就该放行").toBeEnabled();

  await replaceBody(page, " ");
  await expect(publishButton(page), "正文空着同样不该能发布").toBeDisabled();

  expect((await readAnnouncement(api, target.id)).status, "被挡住的这一路不该动服务端").toBe("draft");
});

test("置顶：点图标只改草稿，发布之后服务端才真的置顶", async ({ page, flow, api }) => {
  await openEditor(page);

  const pin = page.getByRole("switch", { name: "Pin", exact: true });
  await expect(pin).not.toBeChecked();
  await clickWithoutWrite(page, pin);

  await expect(pin, "开关要自报当前草稿是置顶态，否则用户不知道点没点上").toBeChecked();
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
  expect((await readAnnouncement(api, target.id)).pinned, "还没收尾，服务端不该有变化").toBe(false);

  await flow.click(publishButton(page), UPDATE);
  expect((await readAnnouncement(api, target.id)).pinned, "发布之后必须落库成置顶").toBe(true);

  // 再点一次是撤销置顶：同样先改草稿，收尾才生效。
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await clickWithoutWrite(page, page.getByRole("switch", { name: "Pin", exact: true }));
  await flow.click(publishButton(page), UPDATE);
  expect((await readAnnouncement(api, target.id)).pinned, "取消置顶同样要落库").toBe(false);
});

test("存草稿：菜单里的 Save as Draft 把内容存下但不发布", async ({ page, flow, api }) => {
  await openEditor(page);

  const nextTitle = `${SYSTEM_TEST_CONTENT_MARKER} Drafted ${stamp}`;
  await titleField(page).fill(nextTitle);

  await flow.click(await chooseFinish(page, "Save as Draft"), UPDATE);

  const saved = await readAnnouncement(api, target.id);
  expect(saved.title, "存草稿也要把改动落库").toBe(nextTitle);
  expect(saved.status, "存草稿不能顺手把公告发出去").toBe("draft");
});

test("定时发布：未来时间进 scheduled，过去时间被前端挡住", async ({ page, flow, api }) => {
  await openEditor(page);

  const publishAt = field(page, "Announcement release time");
  await publishAt.fill(await localDateTimeValue(page, -24 * 60));
  await clickWithoutWrite(page, await chooseFinish(page, "Schedule post"));
  await expect(
    page.getByRole("alert").getByText("Scheduled publish time must be in the future.", { exact: true }),
    "过去的时间要当场说清楚为什么不行",
  ).toBeVisible();
  expect((await readAnnouncement(api, target.id)).status, "被挡住的定时发布不该动服务端").toBe("draft");

  await publishAt.fill(await localDateTimeValue(page, 24 * 60));
  await flow.click(await chooseFinish(page, "Schedule post"), UPDATE);

  const saved = await readAnnouncement(api, target.id);
  expect(saved.status, "定时发布要把状态写成 scheduled").toBe("scheduled");
  expect(saved.publish_at, "定时发布必须把时间一起送上去").not.toBeNull();
  expect(
    Date.parse(saved.publish_at as string) > Date.now(),
    `落库的发布时间应当在未来，实际是 ${saved.publish_at}`,
  ).toBe(true);
});

test("删除：确认框拦一道，取消不写，确认后服务端和列表一起消失", async ({ page, flow, api }) => {
  await openEditor(page);

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = await confirmDialog(page, "Delete Announcement");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectNoDialog(page);
  expect((await readAnnouncement(api, target.id)).id, "取消删除不该动服务端").toBe(target.id);

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await flow.click(
    (await confirmDialog(page, "Delete Announcement")).getByRole("button", { name: "Delete", exact: true }),
    DELETE_PERMANENT,
  );

  const gone = await api.get(`/api/announcements/${target.id}`);
  expect(gone.status(), "删除之后按 id 应当查不到了").toBe(404);
  await expect(item(page, target.title), "列表里也不该再留着它").toHaveCount(0);
});

test("归档：确认框拦一道，确认后写入 archived 并返回目录", async ({ page, flow, api }) => {
  await openEditor(page);

  await page.getByRole("switch", { name: "Archive", exact: true }).click();
  const dialog = await confirmDialog(page, "Archive Announcement");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectNoDialog(page);
  expect((await readAnnouncement(api, target.id)).status, "取消归档不该动服务端").toBe("draft");

  await page.getByRole("switch", { name: "Archive", exact: true }).click();
  await flow.click(
    (await confirmDialog(page, "Archive Announcement"))
      .getByRole("button", { name: "Archive", exact: true }),
    ARCHIVE,
  );

  expect((await readAnnouncement(api, target.id)).status, "确认归档必须落库").toBe("archived");
  await expect(page.locator(".announcements-catalog"), "归档完成后要回到目录").toBeVisible();
});

test("新建：独立创建路由发布后跳到新公告详情", async ({ page, flow, api }) => {
  await page.goto("/announcements/new");
  await expect(titleField(page), "创建态的标题应当是空的").toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
    "还没建出来，删除按钮不该出现",
  ).toHaveCount(0);

  const newTitle = `${SYSTEM_TEST_CONTENT_MARKER} Created ${stamp}`;
  await titleField(page).fill(newTitle);
  await replaceBody(page, `created body ${stamp}`);

  const created = await flow.click(publishButton(page), CREATE) as AnnouncementDetail;
  extraIds.push(created.id);

  expect(created.title).toBe(newTitle);
  expect(created.status, "从创建态点发布，建出来的就该是已发布").toBe("published");

  const readBack = await readAnnouncement(api, created.id);
  expect(readBack.body_json, "正文要跟着一起建出来").toContain(`created body ${stamp}`);

  /*
   * 建完这一跳会经过未保存改动拦截器。创建态的草稿不清干净的话，用户点完「发布」
   * 立刻被问「有未保存的改动，确定离开吗」；选 Stay 更糟——公告已经建出来了，
   * 地址栏却停在创建路由。这两条断言钉的就是这个修复
   * （useAnnouncementsController 的 discardCreateDraft）。
   */
  await expectNoDialog(page);
  await expect(page, "建完要跳到新公告的独立地址")
    .toHaveURL(new RegExp(`/announcements/${created.id}$`));
  await expect(page.locator(".announcement-reader-title")).toHaveText(newTitle);
});

test("新建后取消：草稿直接丢掉，不该再多问一句有没有未保存的改动", async ({ page, api }) => {
  await page.goto("/announcements/new");
  await titleField(page).fill(`${SYSTEM_TEST_CONTENT_MARKER} Abandoned ${stamp}`);

  await clickWithoutWrite(page, page.getByRole("button", { name: "Cancel", exact: true }));

  // 「取消」本身就是在说要丢掉草稿，再弹一次拦截器就是同一件事问两遍。
  await expectNoDialog(page);
  await expect(page.locator(".announcements-catalog"), "取消之后要回到公告目录")
    .toBeVisible();

  const list = await readJson(
    await api.get(`/api/announcements?page=1&limit=50&search=${stamp}`),
    "回读本用例的公告",
  ) as { data: Array<{ title: string }> };
  expect(
    list.data.map((row) => row.title).sort(),
    "取消掉的草稿不该在服务端留下任何东西",
  ).toEqual([target.title, other.title].sort());
});

test("脏着返回目录：先问一句，取消留在原处，确认才离开", async ({ page, api }) => {
  await openEditor(page);
  await titleField(page).fill(`${SYSTEM_TEST_CONTENT_MARKER} Dirty ${stamp}`);

  const back = page.getByRole("button", { name: "Back to announcements", exact: true });
  await back.click();
  const dialog = await confirmDialog(page, "Discard unsaved changes?");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectNoDialog(page);
  await expect(
    titleField(page),
    "取消之后必须留在原来那条上，改了一半的内容还在",
  ).toHaveValue(`${SYSTEM_TEST_CONTENT_MARKER} Dirty ${stamp}`);

  await back.click();
  await (await confirmDialog(page, "Discard unsaved changes?"))
    .getByRole("button", { name: "Discard", exact: true }).click();

  await expect(page.locator(".announcements-catalog"), "确认丢弃之后要回到目录").toBeVisible();
  await item(page, other.title).click();
  await expect(page.locator(".announcement-reader-title")).toHaveText(other.title);
  expect((await readAnnouncement(api, target.id)).title, "丢弃的改动不该落库").toBe(target.title);
});
