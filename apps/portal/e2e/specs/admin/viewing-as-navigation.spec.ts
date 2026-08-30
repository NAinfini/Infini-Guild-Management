import type { Page } from "@playwright/test";
import { expect, test } from "../../support/test";

async function chooseView(page: Page, label: string): Promise<void> {
  const selector = page.getByRole("combobox", { name: "Viewing As", exact: true });
  await selector.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(selector).toContainText(label);
}

test("the selected preview role survives portal navigation", async ({ page }) => {
  await page.goto("/");

  const selector = page.getByRole("combobox", { name: "Viewing As", exact: true });
  await chooseView(page, "Member");
  await page.getByRole("button", { name: "Events", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(selector).toContainText("Member");
  await expect(page.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);

  await page.goto("/events?view=month");
  await chooseView(page, "External view");
  await expect(page).toHaveURL((url) =>
    url.pathname === "/events"
    && url.searchParams.get("view") === "month"
    && url.searchParams.get("preview") === "external",
  );
  await page.getByRole("button", { name: "Roster", exact: true }).click();
  await expect(page).toHaveURL((url) =>
    url.pathname === "/roster" && url.searchParams.get("preview") === "external",
  );
  await expect(selector).toContainText("External view");
});
