import { expect, test } from "@playwright/test";
import { expectDemo, expectNoSidewaysScroll, watchForErrors } from "./support";

test.describe("carteiras", () => {
  test("lists the accounts and switches to the cards without a reload", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/demo/wallets");
    await expectDemo(page);

    await expect(page.getByText("Conta corrente").first()).toBeVisible();
    await expect(page.getByText("Reserva").first()).toBeVisible();
    await expectNoSidewaysScroll(page);

    await page.getByRole("button", { name: "Cartões" }).click();
    await expect(page).toHaveURL(/\/demo\/wallets\?tab=cartoes$/);
    await expect(page.getByText("Gold").first()).toBeVisible();
    await expectNoSidewaysScroll(page);

    await page.getByRole("button", { name: "Contas" }).click();
    await expect(page).toHaveURL(/\/demo\/wallets$/);
    await expect(page.getByText("Conta corrente").first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("opens straight on the cards when the link says so", async ({ page }) => {
    await page.goto("/demo/wallets?tab=cartoes");
    await expect(page.getByText("Black").first()).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});
