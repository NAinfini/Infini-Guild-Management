import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { pngUpload } from "../../support/files";
import { uniqueTag } from "../../support/members";
import { expect, readJson, test } from "../../support/test";
import { confirmDialog, expectNoDialog, field } from "../../support/ui";

/*
 * 后台「职业」页签：职业目录的增删改，以及图标来源开关（矢量图标库 / 自定义图片）。
 * 版式是左清单右编辑器的主从台（.admin-md，和角色、徽章共用），编辑器不再是弹窗，
 * 点左边的一行就等于「编辑这一条」。
 *
 * 靶子一律是本条用例自己建的职业。种子职业被成员档案引用着，改了不会被运行收尾还原，
 * 而收尾指纹只数行数——「行数没变、标签和颜色变了」这种污染一条都查不出来。
 * 自建职业走 POST /api/classes 会被登记进本次运行的清理注册表；上传的图标也一样，
 * 返回体里的 icon_key 会被登记成 r2_key，收尾时连同 R2 对象一起删掉。
 *
 * 图标上传这条链路要走到底：浏览器里先把图转成 WebP 再传（mutations/classes.ts），
 * 所以断言必须落到服务端存下来的 icon_type / icon_key 上，只看编辑器收起来了等于没验。
 */

const CREATE_CLASS = { method: "POST", path: /^\/api\/classes$/, status: 201 } as const;
const UPDATE_CLASS = { method: "PATCH", path: /^\/api\/classes\/[^/]+$/ } as const;
const DELETE_CLASS = { method: "DELETE", path: /^\/api\/classes\/[^/]+$/ } as const;
const REORDER_CLASSES = { method: "PATCH", path: /^\/api\/classes\/reorder$/ } as const;
const UPLOAD_ICON = { method: "POST", path: /^\/api\/classes\/[^/]+\/icon$/ } as const;
const REMOVE_ICON = { method: "DELETE", path: /^\/api\/classes\/[^/]+\/icon$/ } as const;

type ServerClass = {
  id: string;
  label: string;
  color: string;
  icon_type: "vector" | "image";
  vector_icon: string;
  icon_key: string | null;
  sort_order: number;
};

function master(page: Page): Locator {
  return page.locator(".admin-md__master");
}
/** 右栏：编辑器就地展开在这里，收起时这里只剩一句提示。 */
function editor(page: Page): Locator {
  return page.locator(".admin-md__detail");
}
function classItem(page: Page, label: string): Locator {
  return page.locator(".admin-md__item").filter({ hasText: label });
}
function iconOption(scope: Locator, name: string): Locator {
  return scope.getByRole("button", { name: `Select ${name} icon`, exact: true });
}
/* SegmentedControl 真正的 radio 是藏起来的，可点的是包着它的 label。 */
function sourceOption(scope: Locator, label: string): Locator {
  return scope.locator(".mantine-SegmentedControl-label").filter({ hasText: new RegExp(`^${label}$`) });
}
function saveButton(scope: Locator): Locator {
  return scope.getByRole("button", { name: "Save class", exact: true });
}
function cancelButton(scope: Locator): Locator {
  return scope.getByRole("button", { name: "Cancel", exact: true });
}
/** 编辑器收起来的样子：右栏回到那句提示。 */
async function expectEditorClosed(page: Page): Promise<void> {
  await expect(
    editor(page).getByText("Select a class to edit", { exact: true }),
    "编辑器该收起来了，右栏不能还停在一张表上",
  ).toBeVisible();
}

async function serverClasses(api: APIRequestContext): Promise<ServerClass[]> {
  return await readJson(await api.get("/api/classes"), "读取职业目录") as ServerClass[];
}

async function serverClass(api: APIRequestContext, id: string): Promise<ServerClass> {
  const found = (await serverClasses(api)).find((item) => item.id === id);
  expect(found, `服务端找不到职业 ${id}`).toBeTruthy();
  return found as ServerClass;
}

/** 直接建一个职业当靶子：建的过程另有用例专门验，这里只要有个能改的东西。 */
async function createServerClass(api: APIRequestContext, label: string): Promise<ServerClass> {
  return await readJson(
    await api.post("/api/classes", {
      data: { label, color: "#8594A8", vector_icon: "shield", sort_order: 900 },
    }),
    `创建职业 ${label}`,
  ) as ServerClass;
}

async function openClasses(page: Page): Promise<void> {
  await page.goto("/admin?tab=classes");
  await expect(page.getByRole("tab", { name: /Classes/ })).toHaveAttribute("aria-selected", "true");
  await expect(master(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** 清单顶上的计数：它是「这一页有没有加载全」的唯一提示，必须和真实条数一致。 */
async function shownCount(page: Page): Promise<number> {
  const text = await master(page).getByText(/^\d+ classes$/).innerText();
  const value = Number.parseInt(text, 10);
  expect(Number.isInteger(value), `计数读到的是 ${JSON.stringify(text)}`).toBe(true);
  return value;
}

async function expectNotified(page: Page, text: string): Promise<void> {
  await expect(
    page.locator(".mantine-Notification-description").filter({ hasText: text }),
    `没有弹出通知「${text}」`,
  ).toBeVisible();
}

/*
 * ColorInput 一获得焦点就把取色浮层弹出来，浮层压在下半张表单上，
 * 后面点保存会点在浮层上。填完颜色顺手点一下预览区把它收回去。
 */
async function fillColor(scope: Locator, value: string): Promise<void> {
  await field(scope, "Class color").fill(value);
  await scope.getByText("Live preview", { exact: true }).click();
}

test("新建职业：没名字存不了；填完之后颜色、图标、顺序原样落库，清单和计数一起更新", async ({ page, api, flow }) => {
  const label = `E2E ${uniqueTag("cls")}`;
  await openClasses(page);
  const before = await shownCount(page);
  await expectEditorClosed(page);

  await master(page).getByRole("button", { name: "New class", exact: true }).click();
  const form = editor(page);
  await expect(form.getByText("Create class", { exact: true })).toBeVisible();

  await expect(saveButton(form), "名字为空时保存就该是禁用的").toBeDisabled();

  await field(form, "Class name").fill(label);
  await fillColor(form, "#A78BFA");
  await field(form, "Display order").fill("777");
  await iconOption(form, "Crown").click();
  await expect(iconOption(form, "Crown"), "选中的图标要标出来").toHaveAttribute("aria-pressed", "true");
  await expect(
    form.getByText(label, { exact: true }),
    "左边的实时预览要跟着填的名字走，否则存下来长什么样全靠猜",
  ).toBeVisible();
  await expect(form.getByText("#A78BFA", { exact: true }), "预览里要如实回显色值").toBeVisible();

  await expect(saveButton(form)).toBeEnabled();
  const created = await flow.click(saveButton(form), CREATE_CLASS) as ServerClass;
  await expectNotified(page, "Class saved");
  await expectEditorClosed(page);

  const saved = await serverClass(api, created.id);
  expect(saved.label).toBe(label);
  expect(saved.color, "颜色一律按大写存").toBe("#A78BFA");
  expect(saved.vector_icon, "选的是皇冠").toBe("crown");
  expect(saved.icon_type, "没传图片就该是矢量图标").toBe("vector");
  expect(saved.icon_key, "矢量图标不该在 R2 上留下对象").toBeNull();
  expect(saved.sort_order).toBe(777);

  const row = classItem(page, label);
  await expect(row, "建完必须直接出现在清单里").toBeVisible();
  await expect(row, "清单上要标出这一条用的是哪种图标来源").toContainText("Vector");
  expect(await shownCount(page), "计数要跟着加一").toBe(before + 1);
});

test("编辑职业：点清单选中，改名和改顺序都落到服务端，取消则一个字都不改", async ({ page, api, flow }) => {
  const item = await createServerClass(api, `E2E ${uniqueTag("edit")}`);
  const renamed = `${item.label} v2`;
  await openClasses(page);

  /* 先验取消：改了一半点取消，不该发请求，服务端也得毫发无损。 */
  await classItem(page, item.label).click();
  const form = editor(page);
  await expect(form.getByText("Edit class", { exact: true })).toBeVisible();
  await field(form, "Class name").fill("throwaway");
  await flow.clickWithoutApi(cancelButton(form));
  await expectEditorClosed(page);
  expect((await serverClass(api, item.id)).label, "取消之后名字不能变").toBe(item.label);

  await classItem(page, item.label).click();
  await expect(
    field(form, "Class name"),
    "点开一行要带出这一条现在的值，而不是一张空表",
  ).toHaveValue(item.label);
  await expect(field(form, "Display order")).toHaveValue(String(item.sort_order));
  await expect(
    classItem(page, item.label),
    "正在编辑的那一行要标出来，否则右边这张表是谁的全靠记",
  ).toHaveClass(/admin-md__item--active/);

  await field(form, "Class name").fill(renamed);
  await field(form, "Display order").fill("880");
  await flow.click(saveButton(form), UPDATE_CLASS);
  await expectNotified(page, "Class saved");
  await expectEditorClosed(page);

  const saved = await serverClass(api, item.id);
  expect(saved.label).toBe(renamed);
  expect(saved.sort_order).toBe(880);
  expect(saved.color, "没碰的字段不能被顺手改掉").toBe(item.color);
  await expect(classItem(page, renamed), "清单要跟着刷新").toBeVisible();
});

test("自定义图标：不选图存不了；传完落到 R2 且取得回来；再切回矢量会把图删干净", async ({ page, api, flow }) => {
  const item = await createServerClass(api, `E2E ${uniqueTag("icon")}`);
  await openClasses(page);
  await expect(classItem(page, item.label)).toContainText("Vector");

  await classItem(page, item.label).click();
  const form = editor(page);
  await sourceOption(form, "Custom image").click();

  await expect(
    saveButton(form),
    "选了图片来源却没给图，存下去就是一个没有图标的图片型职业，这时必须存不了",
  ).toBeDisabled();

  await form.locator("input[type='file']").setInputFiles(pngUpload("class-icon.png"));
  await expect(form.getByText("class-icon.png", { exact: true }), "选完要显示文件名").toBeVisible();
  await expect(saveButton(form)).toBeEnabled();

  /* 保存是两个请求：先更新这一行，再把图传上去。等的是后一个。 */
  const uploaded = await flow.click(saveButton(form), UPLOAD_ICON) as ServerClass;
  await expectNotified(page, "Class saved");
  await expectEditorClosed(page);

  expect(uploaded.icon_type).toBe("image");
  const withIcon = await serverClass(api, item.id);
  expect(withIcon.icon_type, "服务端要记住这一条现在用的是自定义图").toBe("image");
  expect(withIcon.icon_key, "R2 上必须真的有这个对象，否则清单只能显示裂图").toBeTruthy();
  await expect(classItem(page, item.label)).toContainText("Custom image");

  /* 只断言库里存了个键是不够的——取不回来照样是坏的。 */
  const iconUrl = `/api/classes/icon?key=${encodeURIComponent(withIcon.icon_key ?? "")}`;
  const fetched = await api.get(iconUrl);
  expect(fetched.status(), "按 key 取图标应当能取到").toBe(200);
  expect(fetched.headers()["content-type"], "上传前浏览器已把图转成 WebP").toContain("image/webp");

  /* 切回矢量：那张图没人用了，必须一并删掉，不能在 R2 上留孤儿。 */
  await classItem(page, item.label).click();
  await sourceOption(form, "Vector").click();
  await flow.click(saveButton(form), REMOVE_ICON);
  await expectEditorClosed(page);

  const cleared = await serverClass(api, item.id);
  expect(cleared.icon_type).toBe("vector");
  expect(cleared.icon_key, "切回矢量之后不该再挂着一个用不上的对象键").toBeNull();
  await expect(classItem(page, item.label)).toContainText("Vector");
  expect((await api.get(iconUrl)).status(), "对象本身也该取不到了").toBe(404);
});

/*
 * 拖拽排序走的是整表重排接口：请求体带的是**完整**的职业 id 顺序，不是被拖的那一个。
 *
 * 这里用键盘（空格拿起 → 方向键移动 → 空格放下）而不是指针拖拽，两个原因：
 * 一是指针拖 dnd-kit 在 CI 上出了名的会漏帧（见 guild-war-active-board 那条），
 * 二是手柄本来就该能用键盘操作，顺手把这条可访问性一起钉住。
 *
 * 收尾必须把顺序放回去：重排会改到种子职业的 sort_order，而运行收尾的指纹只数行数，
 * 这种「行数没变、顺序变了」的污染一条都查不出来，会一路影响后面的用例。
 */
test("拖拽排序：整张目录一次提交，顺序按下标重新发号落库；残缺的顺序一律回 409", async ({ page, api, flow }) => {
  const before = (await serverClasses(api)).map((item) => item.id);
  expect(before.length, "目录里至少要有两条才谈得上排序").toBeGreaterThan(1);
  const expected = [before[1] as string, before[0] as string, ...before.slice(2)];

  try {
    await openClasses(page);
    const rows = master(page).locator(".admin-classes__row");
    await expect(rows).toHaveCount(before.length);

    /*
     * 每按一次键都要等界面把上一步落实，不能连着敲。
     * aria-pressed 是拿起来的第一个信号，但那时 dnd-kit 还没把文档级键盘监听装上，
     * 这个空档里按下去的方向键会被直接丢掉（丢了不会报错，只是原地不动）。
     * 真正代表「拖拽上下文活了」的是各行拿到了 inline transform，就等这个。
     */
    const firstRow = rows.first();
    const transformOf = (row: Locator) => (
      () => row.evaluate((el) => (el as HTMLElement).style.transform)
    );
    const handle = firstRow.locator(".admin-classes__grip");

    await handle.focus();
    await page.keyboard.press("Space");
    await expect(handle, "空格该把这一行拿起来").toHaveAttribute("aria-pressed", "true");
    await expect.poll(transformOf(firstRow), "拖拽上下文该接管这一行的位移了").not.toBe("");

    await page.keyboard.press("ArrowDown");
    /*
     * 等的是**第二行**被顶开，不是第一行动了。
     * 第一行的位移只说明按键收到了；第二行反向位移才说明 dnd-kit 已经认定
     * 「悬停在第二行上」（over 有值）。只等第一行的话，会在 over 还没定下来时
     * 就按下放手键，那一次 onDragEnd 的 over 是空的，什么请求都不会发。
     */
    await expect
      .poll(transformOf(rows.nth(1)), "第二行该被顶开，这才说明悬停目标定下来了")
      .not.toMatch(/translate3d\(0px, 0px/);

    const sent = await flow.act(
      () => page.keyboard.press("Space"),
      REORDER_CLASSES,
    ) as ServerClass[];
    await expect(handle, "再按一次空格该放下").not.toHaveAttribute("aria-pressed", "true");

    expect(
      sent.map((item) => item.id),
      "响应体要按新顺序回整张目录，前端就是拿它当真相刷新的",
    ).toEqual(expected);
    expect(
      sent.map((item) => item.sort_order),
      "重排后按下标 * 10 重新发号，中间留出手工插值的空位",
    ).toEqual(expected.map((_, index) => index * 10));

    const saved = await serverClasses(api);
    expect(saved.map((item) => item.id), "刷新回来顺序还得是新的，不能只在内存里对").toEqual(expected);

    /* 界面上第一行确实换人了——只验网络不验界面等于没验拖拽。 */
    const firstLabel = saved[0]?.label as string;
    await expect(rows.first()).toContainText(firstLabel);

    /* 少一个 id 的重排必须被拒：否则没提交的那些会停在旧号段上，和新号段交错。 */
    const partial = await api.patch("/api/classes/reorder", { data: { order: expected.slice(1) } });
    expect(partial.status(), "残缺的顺序要回 409，不能悄悄写进去").toBe(409);
    expect(
      (await serverClasses(api)).map((item) => item.id),
      "被拒的那次不能改动任何一行",
    ).toEqual(expected);
  } finally {
    await api.patch("/api/classes/reorder", { data: { order: before } });
  }
});

test("删除职业：确认框取消什么都不做；确认之后清单、计数和服务端一起少一个", async ({ page, api, flow }) => {
  const item = await createServerClass(api, `E2E ${uniqueTag("del")}`);
  await openClasses(page);
  const before = await shownCount(page);

  /* 删除只在右栏露出来：先点开这一条，才谈得上删它。 */
  await classItem(page, item.label).click();
  const form = editor(page);
  await form.getByRole("button", { name: "Delete class", exact: true }).click();
  const dialog = await confirmDialog(page, "Delete this class?");
  await expect(dialog, "确认框要点名删的是哪一个").toContainText(item.label);

  await flow.clickWithoutApi(cancelButton(dialog));
  await expectNoDialog(page);
  await expect(classItem(page, item.label), "取消之后这一行必须还在").toBeVisible();
  await expect(field(form, "Class name"), "取消删除不该顺手把编辑器也关了").toHaveValue(item.label);

  await form.getByRole("button", { name: "Delete class", exact: true }).click();
  const again = await confirmDialog(page, "Delete this class?");
  await flow.click(again.getByRole("button", { name: "Delete class", exact: true }), DELETE_CLASS);
  await expectNotified(page, "Class deleted");

  await expect(classItem(page, item.label)).toHaveCount(0);
  await expectEditorClosed(page);
  expect(await shownCount(page), "计数要跟着减一").toBe(before - 1);
  expect(
    (await serverClasses(api)).some((row) => row.id === item.id),
    "服务端也不能再查到它",
  ).toBe(false);
});
