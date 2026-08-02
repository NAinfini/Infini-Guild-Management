import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../support/test";
import { field, topDialog } from "../../support/ui";

/*
 * 工具页目前只有一张卡：骰子。整屏没有任何服务端状态——投掷结果算在浏览器里，
 * 历史存在 localStorage 的 tools.diceHistory 上，所以每个控件都按「不碰网络」验。
 *
 * 骰子的验收不能停在「出现了数字」：这是个随机工具，唯一能钉死的契约是
 *   骰位数量 = 骰数、每个点数落在 1..面数、总计 = 各点数之和、历史多一条且与本次一致。
 * 少了这几条，把 rollDice 的随机源换成常数 1 也照样绿。
 */

const ROLL_ANIMATION_MS = 1200;

function toolsDialog(page: Page): Locator {
  return topDialog(page);
}
function diceFaces(page: Page): Locator {
  return toolsDialog(page).locator(".dice__die");
}
function historyItems(page: Page): Locator {
  return toolsDialog(page).locator(".dice__history-item");
}
function rollButton(page: Page): Locator {
  return toolsDialog(page).locator(".dice__roll-btn");
}

/** 点投掷并等动画结束：按钮先禁用，恢复可点才算这一轮出了终值。 */
async function roll(page: Page): Promise<void> {
  await rollButton(page).click();
  await expect(rollButton(page), "投掷过程中按钮必须禁用，防止连点").toBeDisabled();
  await expect(rollButton(page)).toBeEnabled({ timeout: ROLL_ANIMATION_MS + 5_000 });
}

async function readFaces(page: Page): Promise<number[]> {
  const texts = await diceFaces(page).allInnerTexts();
  return texts.map((text) => {
    const value = Number.parseInt(text.trim(), 10);
    expect(Number.isInteger(value), `骰面读到的不是数字：${JSON.stringify(text)}`).toBe(true);
    return value;
  });
}

async function readHistoryStorage(page: Page): Promise<Array<{ count: number; sides: number; results: number[]; total: number }>> {
  const raw = await page.evaluate(() => localStorage.getItem("tools.diceHistory"));
  return raw ? JSON.parse(raw) : [];
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tools");
  await expect(page.getByRole("heading", { name: "Dice Roller", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
});

test("工具卡：点开骰子弹窗，关掉后回到卡片，全程不碰网络", async ({ page, flow }) => {
  await flow.clickWithoutApi(page.getByRole("heading", { name: "Dice Roller", exact: true }));
  await expect(toolsDialog(page), "卡片本身就是打开弹窗的按钮").toBeVisible();
  await expect(toolsDialog(page).getByText("No rolls yet. Hit Roll!")).toBeVisible();

  await toolsDialog(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("投掷：骰位数、点数范围、总计与历史四项互相对得上", async ({ page }) => {
  await page.getByRole("heading", { name: "Dice Roller", exact: true }).click();
  const dialog = toolsDialog(page);

  await field(dialog, "Number of Dice").fill("3");
  await field(dialog, "Sides per Die").fill("20");
  await expect(dialog.locator(".dice__notation"), "骰式要跟着两个输入走").toHaveText("3d20");
  await expect(diceFaces(page), "还没投时也先摆出对应数量的空骰位").toHaveCount(3);

  await roll(page);

  const faces = await readFaces(page);
  expect(faces, "3d20 就该出 3 个点数").toHaveLength(3);
  for (const value of faces) {
    expect(value, `点数 ${value} 超出了 1..20`).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(20);
  }
  const sum = faces.reduce((total, value) => total + value, 0);
  await expect(dialog.locator(".dice__total-value"), "总计必须等于各点数之和").toHaveText(String(sum));

  await expect(historyItems(page), "投一次就该多一条历史").toHaveCount(1);
  const entry = historyItems(page).first();
  await expect(entry.locator(".dice__history-notation")).toHaveText("3d20");
  await expect(entry.locator(".dice__history-total")).toHaveText(String(sum));

  const stored = await readHistoryStorage(page);
  expect(stored, "历史必须落盘，刷新后还要在").toHaveLength(1);
  expect(stored[0]).toMatchObject({ count: 3, sides: 20, results: faces, total: sum });
});

test("骰数与面数：超出上下限当场夹回区间，夹回后的值就是真正用来投的值", async ({ page }) => {
  await page.getByRole("heading", { name: "Dice Roller", exact: true }).click();
  const dialog = toolsDialog(page);
  const count = field(dialog, "Number of Dice");
  const sides = field(dialog, "Sides per Die");

  await count.fill("999");
  await expect(count, "骰数上限是 20").toHaveValue("20");
  await sides.fill("9999");
  await expect(sides, "面数上限是 1000").toHaveValue("1000");
  await expect(dialog.locator(".dice__notation")).toHaveText("20d1000");

  await count.fill("0");
  await expect(count, "骰数下限是 1").toHaveValue("1");
  await sides.fill("1");
  await expect(sides, "面数下限是 2").toHaveValue("2");

  await roll(page);
  const faces = await readFaces(page);
  expect(faces, "夹回后是 1d2，就该只投一颗").toHaveLength(1);
  expect(faces[0], "1d2 只可能是 1 或 2").toBeGreaterThanOrEqual(1);
  expect(faces[0]).toBeLessThanOrEqual(2);
});

test("历史：连投累积成多条，清空按钮把界面和落盘一起清掉", async ({ page }) => {
  await page.getByRole("heading", { name: "Dice Roller", exact: true }).click();
  const dialog = toolsDialog(page);

  await expect(dialog.getByRole("button", { name: "Clear", exact: true }), "没有历史时不该出现清空按钮")
    .toHaveCount(0);

  await roll(page);
  await roll(page);
  await expect(historyItems(page), "两次投掷各留一条").toHaveCount(2);
  expect(await readHistoryStorage(page)).toHaveLength(2);

  await dialog.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(historyItems(page)).toHaveCount(0);
  await expect(dialog.getByText("No rolls yet. Hit Roll!")).toBeVisible();
  expect(await readHistoryStorage(page), "清空必须连落盘一起清").toEqual([]);
});
