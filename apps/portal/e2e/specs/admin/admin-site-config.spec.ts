import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, readJson, test } from "../../support/test";
import { field } from "../../support/ui";

/*
 * 后台「站点配置」页签。
 *
 * 这一页和别的页签有个本质区别：它改的是唯一一行全站配置，不是新增一条记录。
 * 收尾的清理注册表只认「本次运行创建出来的东西」，指纹又只数行数——
 * 改坏了的站点名、被关掉的功能开关，两道防线一条都拦不住，会安静地留到下一轮。
 * 所以每条会写入的用例都必须自己先存快照，afterEach 无论成败都原样写回去。
 *
 * 站点标志由独立媒体接口管理，不属于通用 PATCH；这组会还原配置的用例不改它。
 */

const UPDATE_CONFIG = { method: "PATCH", path: /^\/api\/admin\/site-config$/ } as const;

type SiteConfig = {
  site_name: string;
  site_logo_media_id: string | null;
  features: Record<string, boolean>;
  media_policy: {
    max_file_size_bytes: Record<string, number>;
    quotas: Record<string, number>;
  };
  storage_policy: { images_per_item: number };
  absence_policy: { max_span_days: number; max_entries_per_user: number };
};

/** 本条用例开跑前的全站配置。afterEach 拿它原样写回去。 */
let baseline: SiteConfig | null = null;

async function readConfig(api: APIRequestContext): Promise<SiteConfig> {
  const body = await readJson(await api.get("/api/admin/site-config"), "读取站点配置") as { site: SiteConfig };
  return body.site;
}

/** 存快照。凡是会点保存的用例，第一句就得是它。 */
async function snapshot(api: APIRequestContext): Promise<SiteConfig> {
  baseline = await readConfig(api);
  return baseline;
}

test.afterEach(async ({ api }) => {
  if (!baseline) return;
  const previous = baseline;
  baseline = null;
  await readJson(
    await api.patch("/api/admin/site-config", {
      data: {
        site_name: previous.site_name,
        features: previous.features,
        media_policy: previous.media_policy,
        storage_policy: previous.storage_policy,
        absence_policy: previous.absence_policy,
      },
    }),
    "把站点配置还原成用例开跑前的样子",
  );
});

function featuresCard(page: Page): Locator {
  return page.locator("#site-config-features");
}
function limitsCard(page: Page): Locator {
  return page.locator("#site-config-limits");
}
/*
 * 保存条是条件渲染的：没有未保存改动时整块不在 DOM 里。
 * 所以「不能存」这件事在这一页有两种形态，用例必须分开断言：
 * 没改动 → 保存条整块不存在（toHaveCount(0)）；
 * 改了但存不了（名字空白） → 保存条在、按钮 disabled。
 */
function saveBar(page: Page): Locator {
  return page.locator(".site-config-savebar");
}
function saveButton(page: Page): Locator {
  return saveBar(page).getByRole("button", { name: "Save Site Config", exact: true });
}
/*
 * 功能开关要点在 track 上，不能点 input。
 * Mantine 的 Switch 把 input 和 track 一起塞进同一个 <label>（Switch.mjs 的 bodyElement），
 * track 覆盖在 input 上方并吃掉指针事件——直接点 input 会被判定成「被别的元素挡住」，
 * 一路重试到超时。track 才是用户真正点的那块，点它走的也是同一条 label→input 的路径。
 */
function featureSwitch(page: Page, label: string): Locator {
  return featuresCard(page).locator(`label:has(> input[aria-label="${label}"]) .mantine-Switch-track`);
}
function navItem(page: Page, label: string): Locator {
  return page.locator(".app-sider").getByRole("button", { name: label, exact: true });
}

async function openSiteConfig(page: Page): Promise<void> {
  await page.goto("/admin?tab=siteConfig");
  await expect(page.getByRole("tab", { name: /Site Config/ })).toHaveAttribute("aria-selected", "true");
  /* 三张卡片单列排开，没有二级导航；顺带钉住「不再有跳锚点的链接」这条。 */
  await expect(page.locator(".site-config > .site-config-card")).toHaveCount(3);
  await expect(featuresCard(page)).toBeVisible();
  await expect(page.locator('a[href^="#site-config-"]')).toHaveCount(0);
  await page.waitForLoadState("networkidle");
}

/** 功能卡片标题栏里那句「N/M features enabled」里的 N。 */
async function enabledCount(page: Page): Promise<number> {
  const text = await featuresCard(page).getByText(/^\d+\/\d+ features enabled$/).innerText();
  const value = Number.parseInt(text, 10);
  expect(Number.isInteger(value), `功能计数读到的是 ${JSON.stringify(text)}`).toBe(true);
  return value;
}

/*
 * NumberInput 底下是 react-number-format，带后缀（「8 MB」）时直接 fill 会把后缀一起当成输入。
 * 全选再逐字符敲，走的才是控件自己的格式化路径。
 */
async function setNumber(input: Locator, value: string): Promise<void> {
  await input.click();
  await input.press("ControlOrMeta+a");
  await input.pressSequentially(value);
}

async function expectNotified(page: Page, text: string): Promise<void> {
  await expect(
    page.locator(".mantine-Notification-description").filter({ hasText: text }),
    `没有弹出通知「${text}」`,
  ).toBeVisible();
}

test("保存条的出现条件：没改动时整块不在；名字空着时在但不让存；改回原样又收起来", async ({ page, api, flow }) => {
  const current = await readConfig(api);
  await openSiteConfig(page);

  await expect(saveBar(page), "刚打开时一个字都没改，保存条不该出现").toHaveCount(0);

  const name = field(page, "Guild Name");
  await name.fill(`${current.site_name} X`);
  await expect(saveButton(page)).toBeEnabled();

  await name.fill("   ");
  await expect(saveBar(page), "有改动就得留着保存条，否则「改了但存不了」看起来和「没改」一模一样").toBeVisible();
  await expect(saveButton(page), "全是空格的站点名存下去，全站顶栏就空了").toBeDisabled();

  await name.fill(current.site_name);
  await expect(saveBar(page), "改回原值就等于没改，保存条要收起来").toHaveCount(0);

  /* 开关是纯前端状态，扳一下不该有任何请求，扳回去同样要回到「没改动」。 */
  const toolsSwitch = featureSwitch(page, "Tools");
  const before = await enabledCount(page);
  await flow.clickWithoutApi(toolsSwitch);
  expect(await enabledCount(page), "标题栏的计数要跟着开关走").toBe(before - 1);
  await expect(saveButton(page)).toBeEnabled();
  await flow.clickWithoutApi(toolsSwitch);
  expect(await enabledCount(page)).toBe(before);
  await expect(saveBar(page)).toHaveCount(0);
});

test("改站点名：保存后落库，侧栏品牌名和浏览器标签页标题当场跟着变", async ({ page, api, flow }) => {
  const current = await snapshot(api);
  const renamed = `${current.site_name} E2E`;
  await openSiteConfig(page);

  await field(page, "Guild Name").fill(renamed);
  await flow.click(saveButton(page), UPDATE_CONFIG);
  await expectNotified(page, "Site config saved");

  expect((await readConfig(api)).site_name, "服务端得真的存下新名字").toBe(renamed);
  await expect(
    page.locator(".app-brand-title"),
    "站点名是全站品牌，存完就该当场生效，而不是等下次刷新",
  ).toHaveText(renamed);
  await expect(page).toHaveTitle(renamed);
  await expect(saveBar(page), "存完之后保存条要收起来，否则会重复提交").toHaveCount(0);
});

test("功能开关：关掉工具页并保存后，服务端和左侧导航同时少掉这一项；开回来又都回来", async ({ page, api, flow }) => {
  const current = await snapshot(api);
  expect(current.features.tools, "这条用例的前提是工具页原本开着").toBe(true);
  await openSiteConfig(page);
  await expect(navItem(page, "Tools"), "关掉之前左侧应当有工具页入口").toBeVisible();

  await flow.clickWithoutApi(featureSwitch(page, "Tools"));
  await flow.click(saveButton(page), UPDATE_CONFIG);
  await expectNotified(page, "Site config saved");

  expect((await readConfig(api)).features.tools, "开关要真的落库").toBe(false);
  await expect(
    navItem(page, "Tools"),
    "关掉的功能必须当场从导航里消失，否则成员点进去只会撞上一个空页面",
  ).toHaveCount(0);
  expect(
    (await readConfig(api)).features.wiki,
    "只扳了工具页这一个开关，别的功能不能被顺手改掉",
  ).toBe(current.features.wiki);

  await flow.clickWithoutApi(featureSwitch(page, "Tools"));
  await flow.click(saveButton(page), UPDATE_CONFIG);
  expect((await readConfig(api)).features.tools).toBe(true);
  await expect(navItem(page, "Tools"), "开回来导航项也要回来").toBeVisible();
});

test("上传上限与配额：MB 输入框按字节落库，配额和每件物品图片数一并生效", async ({ page, api, flow }) => {
  await snapshot(api);
  await openSiteConfig(page);

  await setNumber(field(limitsCard(page), "Profile image"), "8");
  await expect(field(limitsCard(page), "Profile image"), "单位后缀要留在输入框里").toHaveValue("8 MB");
  await setNumber(field(limitsCard(page), "Gallery quota"), "12");
  await setNumber(field(limitsCard(page), "Images per item"), "3");

  await flow.click(saveButton(page), UPDATE_CONFIG);
  await expectNotified(page, "Site config saved");

  const saved = await readConfig(api);
  expect(saved.media_policy.max_file_size_bytes.profile_image, "界面上填的是 MB，存下去必须是字节").toBe(8 * 1024 * 1024);
  expect(saved.media_policy.quotas.gallery).toBe(12);
  expect(saved.storage_policy.images_per_item).toBe(3);
  await expect(saveBar(page)).toHaveCount(0);
});
